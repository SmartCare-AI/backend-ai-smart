import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppointmentStatus,
  AppointmentType,
  NotificationType,
  OnlineVisitStatus,
  OnlineVisitType,
  Role,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { fullName } from '../common/utils/user-name.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOnlineVisitDto,
  EndOnlineVisitDto,
  ListOnlineVisitsDto,
} from './dto/online-visit.dtos';

/** Appointment types that are conducted remotely. */
const REMOTE_TYPES: AppointmentType[] = [
  AppointmentType.VIDEO,
  AppointmentType.CHAT,
];

/**
 * ERD #26 OnlineVisit — the telemedicine session.
 *
 * BR-011 / TR-001: an online visit always hangs off an appointment (1:0..1),
 * so remote appointments provision one automatically at booking time and the
 * app joins it through `meetingLink`. Live audio/video signalling itself runs
 * over the Socket.IO gateway (`call:*` events); this entity is the record of
 * the session: when it started, when it ended, and its clinical notes.
 */
@Injectable()
export class TelemedicineService {
  private readonly logger = new Logger(TelemedicineService.name);
  private readonly roomBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {
    this.roomBaseUrl = this.config
      .get<string>('TELEMEDICINE_BASE_URL', 'https://call.shifaa.app')
      .replace(/\/+$/, '');
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Creates the session for a remote appointment. Idempotent — called by the
   * booking flow, so a re-book or a retry returns the existing row.
   */
  async ensureForAppointment(
    appointmentId: number,
    type?: OnlineVisitType,
  ): Promise<void> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { onlineVisit: { select: { id: true } } },
    });
    if (!appointment || appointment.onlineVisit) return;
    if (!REMOTE_TYPES.includes(appointment.type)) return;

    await this.prisma.onlineVisit.create({
      data: {
        appointmentId,
        startTime: appointment.startTime,
        type: type ?? this.defaultTypeFor(appointment.type),
        meetingLink: this.generateMeetingLink(),
      },
    });
    this.logger.log(`Online visit provisioned for appointment ${appointmentId}.`);
  }

  /** Explicit creation (e.g. turning an in-person slot into a remote one). */
  async create(requester: AuthenticatedUser, dto: CreateOnlineVisitDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: dto.appointmentId },
      include: { onlineVisit: true },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    if (appointment.onlineVisit) {
      throw new BadRequestException(
        'This appointment already has an online visit.',
      );
    }
    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot open an online visit for a cancelled appointment.',
      );
    }
    await this.assertParticipant(requester, dto.appointmentId);

    return this.prisma.onlineVisit.create({
      data: {
        appointmentId: dto.appointmentId,
        startTime: appointment.startTime,
        type: dto.type ?? this.defaultTypeFor(appointment.type),
        meetingLink: dto.meetingLink ?? this.generateMeetingLink(),
        notes: dto.notes,
      },
    });
  }

  /** The doctor opens the room — the patient gets a "join now" push. */
  async start(requester: AuthenticatedUser, id: number) {
    const session = await this.getOrThrow(id);
    await this.assertParticipant(requester, session.appointmentId);
    if (session.status !== OnlineVisitStatus.SCHEDULED) {
      throw new BadRequestException(`Session is already ${session.status}.`);
    }

    const updated = await this.prisma.onlineVisit.update({
      where: { id },
      data: { status: OnlineVisitStatus.ACTIVE, startTime: new Date() },
    });

    const appointment = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: session.appointmentId },
      include: {
        patient: { select: { userId: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
    });
    await this.notifications.notify(appointment.patient.userId, {
      type: NotificationType.APPOINTMENT,
      title: 'Your online consultation is ready',
      message: `Dr. ${fullName(appointment.doctor)} has opened the session. Tap to join.`,
      data: {
        screen: 'online-visit',
        id: String(updated.id),
        meetingLink: updated.meetingLink,
      },
    });
    return updated;
  }

  /** Ends the session and completes the appointment. */
  async end(requester: AuthenticatedUser, id: number, dto: EndOnlineVisitDto) {
    const session = await this.getOrThrow(id);
    await this.assertParticipant(requester, session.appointmentId);
    if (session.status === OnlineVisitStatus.COMPLETED) {
      throw new BadRequestException('Session is already completed.');
    }
    if (session.status === OnlineVisitStatus.CANCELLED) {
      throw new BadRequestException('Session was cancelled.');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.onlineVisit.update({
        where: { id },
        data: {
          status: OnlineVisitStatus.COMPLETED,
          endTime: new Date(),
          notes: dto.notes ?? session.notes,
        },
      }),
      this.prisma.appointment.update({
        where: { id: session.appointmentId },
        data: { status: AppointmentStatus.COMPLETED },
      }),
    ]);
    return updated;
  }

  async cancel(requester: AuthenticatedUser, id: number) {
    const session = await this.getOrThrow(id);
    await this.assertParticipant(requester, session.appointmentId);
    if (session.status === OnlineVisitStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed session.');
    }
    return this.prisma.onlineVisit.update({
      where: { id },
      data: { status: OnlineVisitStatus.CANCELLED },
    });
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findOne(requester: AuthenticatedUser, id: number) {
    const session = await this.prisma.onlineVisit.findUnique({
      where: { id },
      include: {
        appointment: {
          select: {
            id: true,
            startTime: true,
            type: true,
            status: true,
            patient: {
              select: { id: true, firstName: true, lastName: true, userId: true },
            },
            doctor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                specialization: true,
                userId: true,
              },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Online visit not found.');
    await this.assertParticipant(requester, session.appointmentId);
    return session;
  }

  /** Role-aware listing: patients see their sessions, doctors see theirs. */
  async listMine(requester: AuthenticatedUser, query: ListOnlineVisitsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const appointmentFilter =
      requester.role === Role.DOCTOR
        ? { doctor: { userId: requester.id } }
        : { patient: { userId: requester.id } };
    const where = {
      appointment: appointmentFilter,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.onlineVisit.findMany({
        where,
        include: {
          appointment: {
            select: {
              id: true,
              startTime: true,
              patient: { select: { id: true, firstName: true, lastName: true } },
              doctor: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  specialization: true,
                },
              },
            },
          },
        },
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.onlineVisit.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  // -------------------------------------------------------------------------

  private async getOrThrow(id: number) {
    const session = await this.prisma.onlineVisit.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Online visit not found.');
    return session;
  }

  /**
   * TR-006: only the appointment's own patient and doctor (or an admin) may
   * touch the session.
   */
  private async assertParticipant(
    requester: AuthenticatedUser,
    appointmentId: number,
  ): Promise<void> {
    if (requester.role === Role.ADMIN) return;
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        patient: { select: { userId: true } },
        doctor: { select: { userId: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    if (
      appointment.patient.userId === requester.id ||
      appointment.doctor.userId === requester.id
    ) {
      return;
    }
    throw new ForbiddenException('You are not a participant of this session.');
  }

  private defaultTypeFor(appointmentType: AppointmentType): OnlineVisitType {
    return appointmentType === AppointmentType.CHAT
      ? OnlineVisitType.CHAT
      : OnlineVisitType.VIDEO;
  }

  private generateMeetingLink(): string {
    return `${this.roomBaseUrl}/room/${randomUUID()}`;
  }
}
