import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  AppointmentType,
  ConsentType,
  NotificationType,
  Prisma,
  ProfileStatus,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelemedicineService } from '../telemedicine/telemedicine.service';
import { ProfilesService } from '../users/profiles.service';
import {
  CreateAppointmentDto,
  ListAppointmentsDto,
} from './dto/appointment.dtos';

const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

/** Appointment types conducted remotely — they get an Online Visit (TR-001). */
const REMOTE_TYPES: AppointmentType[] = [
  AppointmentType.VIDEO,
  AppointmentType.CHAT,
];

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
    private readonly telemedicine: TelemedicineService,
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
      select: { id: true, userId: true, isVerified: true, status: true },
    });
    if (
      !doctor ||
      !doctor.isVerified ||
      doctor.status !== ProfileStatus.ACTIVE
    ) {
      throw new NotFoundException('Doctor not found or not available.');
    }

    const startTime = new Date(dto.startTime);
    if (startTime <= new Date()) {
      throw new BadRequestException('Appointment must be in the future.');
    }
    const endTime = new Date(
      startTime.getTime() + (dto.durationMinutes ?? 30) * 60_000,
    );

    // No double-booking: any pending/confirmed appointment overlapping
    // [startTime, endTime) for this doctor blocks the slot.
    const clash = await this.prisma.appointment.findFirst({
      where: {
        doctorId: dto.doctorId,
        status: { in: BLOCKING_STATUSES },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'The doctor already has an appointment in this time slot.',
      );
    }

    const type = dto.type ?? AppointmentType.IN_PERSON;
    const appointment = await this.prisma.appointment.create({
      data: {
        patientId: dto.patientId,
        doctorId: dto.doctorId,
        bookedById: requester.id,
        date: this.calendarDay(startTime),
        startTime,
        endTime,
        type,
        reason: dto.reason,
        notes: dto.notes,
      },
    });

    // BR-011: remote appointments always carry a telemedicine session.
    if (REMOTE_TYPES.includes(type)) {
      await this.telemedicine.ensureForAppointment(appointment.id);
    }

    await this.notifications.notify(doctor.userId, {
      type: NotificationType.APPOINTMENT,
      title: 'New appointment request',
      message: `New ${type.toLowerCase().replace('_', '-')} appointment on ${startTime.toISOString()}.`,
      data: { screen: 'appointments', id: String(appointment.id) },
    });
    return appointment;
  }

  /** Role-aware listing: patients see their own, doctors see their own. */
  async listMine(requester: AuthenticatedUser, query: ListAppointmentsDto) {
    const where: Prisma.AppointmentWhereInput = {};
    if (requester.role === Role.DOCTOR) {
      const doctor = await this.profiles.getDoctorByUserId(requester.id);
      where.doctorId = doctor.id;
    } else {
      const patient = await this.profiles.getPatientByUserId(requester.id);
      where.patientId = patient.id;
    }
    if (query.status) where.status = query.status;
    if (query.upcoming) where.startTime = { gte: new Date() };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              medicalRecordNo: true,
            },
          },
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
          onlineVisit: {
            select: { id: true, status: true, meetingLink: true, type: true },
          },
          visit: { select: { id: true, status: true } },
        },
        orderBy: { startTime: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** Busy slots of a doctor on a given day — the app renders free slots. */
  async doctorSchedule(doctorId: number, date: string) {
    const day = new Date(`${date}T00:00:00.000Z`);
    const busy = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        status: { in: BLOCKING_STATUSES },
        date: day,
      },
      select: { startTime: true, endTime: true },
      orderBy: { startTime: 'asc' },
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
      throw new BadRequestException(
        `Cannot confirm a ${appointment.status} appointment.`,
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    if (REMOTE_TYPES.includes(updated.type)) {
      await this.telemedicine.ensureForAppointment(updated.id);
    }
    await this.notifyPatient(
      updated.patientId,
      'Appointment confirmed',
      `Your appointment on ${updated.startTime.toISOString()} was confirmed.`,
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
      throw new BadRequestException(
        `Appointment is already ${appointment.status}.`,
      );
    }

    // Who may cancel: the treating doctor, or whoever may manage the
    // patient's appointments (patient/caregiver/admin).
    if (requester.role === Role.DOCTOR) {
      const doctor = await this.profiles.getDoctorByUserId(requester.id);
      if (appointment.doctorId !== doctor.id) {
        throw new ForbiddenException(
          'This appointment is not yours to cancel.',
        );
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

    // A cancelled appointment must not leave a joinable session behind.
    await this.prisma.onlineVisit.updateMany({
      where: { appointmentId: id, status: { not: 'COMPLETED' } },
      data: { status: 'CANCELLED' },
    });

    // Tell the other side.
    if (requester.role === Role.DOCTOR) {
      await this.notifyPatient(
        updated.patientId,
        'Appointment cancelled',
        `Your appointment on ${updated.startTime.toISOString()} was cancelled by the doctor.`,
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
          message: `The appointment on ${updated.startTime.toISOString()} was cancelled by the patient.`,
          data: { screen: 'appointments', id: String(updated.id) },
        });
      }
    }
    return updated;
  }

  /** Full appointment record: participants, visit and telemedicine session. */
  async findOne(requester: AuthenticatedUser, id: number) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            medicalRecordNo: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
        visit: true,
        onlineVisit: true,
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    await this.consent.assertCanAccessPatient(
      requester,
      appointment.patientId,
      ConsentType.VIEW_RECORDS,
    );
    return appointment;
  }

  // -------------------------------------------------------------------------

  /** ERD Appointment.Date — the UTC calendar day of the slot. */
  private calendarDay(startTime: Date): Date {
    return new Date(
      Date.UTC(
        startTime.getUTCFullYear(),
        startTime.getUTCMonth(),
        startTime.getUTCDate(),
      ),
    );
  }

  private async getOrThrow(id: number) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    return appointment;
  }

  private async notifyPatient(
    patientProfileId: number,
    title: string,
    message: string,
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
      message,
      data: { screen: 'appointments', id: String(appointmentId) },
    });
  }
}
