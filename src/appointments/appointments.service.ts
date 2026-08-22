import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  ConsentType,
  NotificationType,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';
import {
  CreateAppointmentDto,
  ListAppointmentsDto,
} from './dto/appointment.dtos';

const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(requester: AuthenticatedUser, dto: CreateAppointmentDto) {
    // Booking for someone else requires MANAGE_APPOINTMENTS (caregiver flow).
    await this.consent.assertCanAccessPatient(
      requester,
      dto.patientId,
      ConsentType.MANAGE_APPOINTMENTS,
    );

    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: dto.doctorId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!doctor || !doctor.isVerified) {
      throw new NotFoundException('Doctor not found or not verified.');
    }

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) {
      throw new BadRequestException('Appointment must be in the future.');
    }
    const endsAt = new Date(
      scheduledAt.getTime() + (dto.durationMinutes ?? 30) * 60_000,
    );

    // No double-booking: any pending/confirmed appointment overlapping
    // [scheduledAt, endsAt) for this doctor blocks the slot.
    const clash = await this.prisma.appointment.findFirst({
      where: {
        doctorId: dto.doctorId,
        status: { in: BLOCKING_STATUSES },
        scheduledAt: { lt: endsAt },
        endsAt: { gt: scheduledAt },
      },
      select: { id: true, scheduledAt: true },
    });
    if (clash) {
      throw new ConflictException(
        'The doctor already has an appointment in this time slot.',
      );
    }

    const appointment = await this.prisma.appointment.create({
      data: {
        patientId: dto.patientId,
        doctorId: dto.doctorId,
        bookedById: requester.id,
        scheduledAt,
        endsAt,
        type: dto.type,
        reason: dto.reason,
      },
    });

    await this.notifications.notify(doctor.user.id, {
      type: NotificationType.APPOINTMENT,
      title: 'New appointment request',
      body: `New ${appointment.type.toLowerCase().replace('_', '-')} appointment on ${scheduledAt.toISOString()}.`,
      data: { screen: 'appointments', id: String(appointment.id) },
    });
    return appointment;
  }

  /** Role-aware listing: patients see their own, doctors see their own. */
  async listMine(requester: AuthenticatedUser, query: ListAppointmentsDto) {
    let where: Record<string, unknown>;
    if (requester.role === Role.DOCTOR) {
      const doctor = await this.profiles.getDoctorByUserId(requester.id);
      where = { doctorId: doctor.id };
    } else {
      const patient = await this.profiles.getPatientByUserId(requester.id);
      where = { patientId: patient.id };
    }
    if (query.status) where.status = query.status;
    if (query.upcoming) where.scheduledAt = { gte: new Date() };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** Busy slots of a doctor on a given day — the app renders free slots. */
  async doctorSchedule(doctorId: number, date: string) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const busy = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        status: { in: BLOCKING_STATUSES },
        scheduledAt: { gte: dayStart, lt: dayEnd },
      },
      select: { scheduledAt: true, endsAt: true },
      orderBy: { scheduledAt: 'asc' },
    });
    return { doctorId, date, busy };
  }

  async confirm(requester: AuthenticatedUser, id: number) {
    const appointment = await this.getOrThrow(id);
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    if (appointment.doctorId !== doctor.id) {
      throw new ForbiddenException('This appointment is not yours to confirm.');
    }
    if (appointment.status !== AppointmentStatus.PENDING) {
      throw new BadRequestException(`Cannot confirm a ${appointment.status} appointment.`);
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    await this.notifyPatient(
      updated.patientId,
      'Appointment confirmed',
      `Your appointment on ${updated.scheduledAt.toISOString()} was confirmed.`,
      updated.id,
    );
    return updated;
  }

  async cancel(requester: AuthenticatedUser, id: number, reason?: string) {
    const appointment = await this.getOrThrow(id);
    if (
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.COMPLETED
    ) {
      throw new BadRequestException(`Appointment is already ${appointment.status}.`);
    }

    // Who may cancel: the treating doctor, or whoever may manage the
    // patient's appointments (patient/caregiver/admin).
    if (requester.role === Role.DOCTOR) {
      const doctor = await this.profiles.getDoctorByUserId(requester.id);
      if (appointment.doctorId !== doctor.id) {
        throw new ForbiddenException('This appointment is not yours to cancel.');
      }
    } else {
      await this.consent.assertCanAccessPatient(
        requester,
        appointment.patientId,
        ConsentType.MANAGE_APPOINTMENTS,
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
        notes: reason ? `Cancelled: ${reason}` : appointment.notes,
      },
    });

    // Tell the other side.
    if (requester.role === Role.DOCTOR) {
      await this.notifyPatient(
        updated.patientId,
        'Appointment cancelled',
        `Your appointment on ${updated.scheduledAt.toISOString()} was cancelled by the doctor.`,
        updated.id,
      );
    } else {
      const doctor = await this.prisma.doctorProfile.findUnique({
        where: { id: updated.doctorId },
        select: { userId: true },
      });
      if (doctor) {
        await this.notifications.notify(doctor.userId, {
          type: NotificationType.APPOINTMENT,
          title: 'Appointment cancelled',
          body: `The appointment on ${updated.scheduledAt.toISOString()} was cancelled by the patient.`,
          data: { screen: 'appointments', id: String(updated.id) },
        });
      }
    }
    return updated;
  }

  // -------------------------------------------------------------------------

  private async getOrThrow(id: number) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    return appointment;
  }

  private async notifyPatient(
    patientProfileId: number,
    title: string,
    body: string,
    appointmentId: number,
  ) {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientProfileId },
      select: { userId: true },
    });
    if (!patient) return;
    await this.notifications.notify(patient.userId, {
      type: NotificationType.APPOINTMENT,
      title,
      body,
      data: { screen: 'appointments', id: String(appointmentId) },
    });
  }
}
