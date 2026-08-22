import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConsentType,
  EmergencyEvent,
  EmergencyStatus,
  EmergencyType,
  NotificationType,
} from '@prisma/client';
import type { Job } from 'bullmq';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { ProfilesService } from '../users/profiles.service';
import {
  CreateEmergencyContactDto,
  ListEmergencyDto,
  SosDto,
  UpdateEmergencyContactDto,
} from './dto/emergency.dtos';
import { SMS_PROVIDER } from './sms/sms-provider.interface';
import type { SmsProvider } from './sms/sms-provider.interface';

const MAX_EMERGENCY_CONTACTS = 5;
/** Repeated SOS presses within this window reuse the active event. */
const SOS_DEDUP_MS = 10 * 60 * 1000;

export interface OpenEmergencyInput {
  patientId: number;
  type: EmergencyType;
  description?: string;
  alertId?: number;
  latitude?: number;
  longitude?: number;
}

/**
 * The Emergency Hub engine (File.md §3).
 *
 * Escalation chain: openEvent() → immediate EMERGENCY push to the patient's
 * circle → delayed job (default 2 min) → still unacknowledged? → SMS to the
 * EmergencyContact list in priority order. Acknowledging cancels the chain.
 *
 * The delayed job runs on the BullMQ 'escalations' queue when Redis is
 * available, otherwise an in-process timer (fine for dev/single instance).
 */
@Injectable()
export class EmergencyService implements OnModuleInit {
  private readonly logger = new Logger(EmergencyService.name);
  private readonly escalationDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
    private readonly queues: QueueService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {
    this.escalationDelayMs =
      this.config.get<number>('EMERGENCY_ESCALATION_MINUTES', 2) * 60_000;
  }

  onModuleInit() {
    this.queues.process(QUEUES.ESCALATIONS, (job: Job) =>
      this.escalate((job.data as { emergencyEventId: number }).emergencyEventId),
    );
  }

  // -------------------------------------------------------------------------
  // Event lifecycle
  // -------------------------------------------------------------------------

  /** Patient pressed the SOS button. */
  async sos(requester: AuthenticatedUser, dto: SosDto): Promise<EmergencyEvent> {
    const patient = await this.profiles.getPatientByUserId(requester.id);

    // Repeated presses (panic-tapping) reuse the active event.
    const active = await this.prisma.emergencyEvent.findFirst({
      where: {
        patientId: patient.id,
        type: EmergencyType.SOS_BUTTON,
        status: EmergencyStatus.ACTIVE,
        createdAt: { gte: new Date(Date.now() - SOS_DEDUP_MS) },
      },
    });
    if (active) return active;

    return this.openEvent({
      patientId: patient.id,
      type: EmergencyType.SOS_BUTTON,
      description: dto.description ?? 'SOS button pressed',
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
  }

  /**
   * Opens an emergency, notifies the circle, arms the escalation timer.
   * Also called by AlertsService when a CRITICAL alert fires.
   */
  async openEvent(input: OpenEmergencyInput): Promise<EmergencyEvent> {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: input.patientId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!patient) throw new NotFoundException('Patient not found.');

    const event = await this.prisma.emergencyEvent.create({
      data: {
        patientId: input.patientId,
        type: input.type,
        description: input.description,
        alertId: input.alertId ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      },
    });

    const patientName = `${patient.user.firstName} ${patient.user.lastName}`;
    const location =
      input.latitude != null && input.longitude != null
        ? ` Location: https://maps.google.com/?q=${input.latitude},${input.longitude}`
        : '';
    const circle = await this.consent.patientCircleUserIds(input.patientId);
    await this.notifications.notifyMany(circle, {
      type: NotificationType.EMERGENCY,
      title: `🚨 EMERGENCY — ${patientName}`,
      body: `${input.description ?? input.type}.${location} Open the app and tap "I'm on it".`,
      data: { screen: 'emergency', id: String(event.id) },
      alertId: input.alertId,
    });

    await this.scheduleEscalation(event.id);
    this.logger.warn(
      `Emergency ${event.id} (${input.type}) opened for patient ${input.patientId}; circle of ${circle.length} notified.`,
    );
    return event;
  }

  /** A caregiver/doctor confirms they are handling it — stops escalation. */
  async acknowledge(requester: AuthenticatedUser, id: number) {
    const event = await this.getOrThrow(id);
    await this.consent.assertCanAccessPatient(
      requester,
      event.patientId,
      ConsentType.RECEIVE_ALERTS,
    );
    if (event.status !== EmergencyStatus.ACTIVE) {
      throw new BadRequestException(`Emergency is already ${event.status}.`);
    }

    const updated = await this.prisma.emergencyEvent.update({
      where: { id },
      data: {
        status: EmergencyStatus.ACKNOWLEDGED,
        acknowledgedById: requester.id,
        acknowledgedAt: new Date(),
      },
    });

    // Reassure the patient.
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: event.patientId },
      select: { userId: true },
    });
    const responder = await this.prisma.user.findUnique({
      where: { id: requester.id },
      select: { firstName: true, lastName: true },
    });
    if (patient && responder) {
      await this.notifications.notify(patient.userId, {
        type: NotificationType.EMERGENCY,
        title: 'Help is on the way',
        body: `${responder.firstName} ${responder.lastName} has seen your emergency and is responding.`,
        data: { screen: 'emergency', id: String(id) },
      });
    }
    return updated;
  }

  async resolve(requester: AuthenticatedUser, id: number, falseAlarm: boolean) {
    const event = await this.getOrThrow(id);
    // The patient may resolve their own event; circle members too.
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: event.patientId },
      select: { userId: true },
    });
    if (patient?.userId !== requester.id) {
      await this.consent.assertCanAccessPatient(
        requester,
        event.patientId,
        ConsentType.RECEIVE_ALERTS,
      );
    }
    if (
      event.status === EmergencyStatus.RESOLVED ||
      event.status === EmergencyStatus.FALSE_ALARM
    ) {
      throw new BadRequestException(`Emergency is already ${event.status}.`);
    }
    return this.prisma.emergencyEvent.update({
      where: { id },
      data: {
        status: falseAlarm ? EmergencyStatus.FALSE_ALARM : EmergencyStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });
  }

  async list(requester: AuthenticatedUser, patientId: number, query: ListEmergencyDto) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.RECEIVE_ALERTS,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { patientId, ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.emergencyEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.emergencyEvent.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  // -------------------------------------------------------------------------
  // Escalation
  // -------------------------------------------------------------------------

  private async scheduleEscalation(emergencyEventId: number) {
    const queued = await this.queues.add(
      QUEUES.ESCALATIONS,
      'escalate',
      { emergencyEventId },
      { delay: this.escalationDelayMs },
    );
    if (!queued) {
      // Dev fallback without Redis: in-process timer.
      setTimeout(() => {
        void this.escalate(emergencyEventId).catch((err: Error) =>
          this.logger.error(`Escalation failed: ${err.message}`),
        );
      }, this.escalationDelayMs);
    }
  }

  /** Fires after the delay: still ACTIVE → SMS the emergency contacts. */
  private async escalate(emergencyEventId: number) {
    const event = await this.prisma.emergencyEvent.findUnique({
      where: { id: emergencyEventId },
      include: {
        patient: {
          include: {
            user: { select: { firstName: true, lastName: true } },
            emergencyContacts: { orderBy: { priority: 'asc' } },
          },
        },
      },
    });
    if (!event || event.status !== EmergencyStatus.ACTIVE) return;

    const name = `${event.patient.user.firstName} ${event.patient.user.lastName}`;
    const location =
      event.latitude != null && event.longitude != null
        ? ` Location: https://maps.google.com/?q=${event.latitude},${event.longitude}`
        : '';
    const message = `SmartCare EMERGENCY: ${name} needs help. ${event.description ?? ''}${location}`;

    for (const contact of event.patient.emergencyContacts) {
      try {
        await this.sms.send(contact.phone, message);
      } catch (err) {
        this.logger.error(
          `SMS to ${contact.name} failed: ${(err as Error).message}`,
        );
      }
    }

    // One more push wave to the circle: nobody responded in time.
    const circle = await this.consent.patientCircleUserIds(event.patientId);
    await this.notifications.notifyMany(circle, {
      type: NotificationType.EMERGENCY,
      title: `🚨 STILL UNANSWERED — ${name}`,
      body: `The emergency has not been acknowledged. SMS sent to ${event.patient.emergencyContacts.length} emergency contact(s).`,
      data: { screen: 'emergency', id: String(event.id) },
    });
    this.logger.warn(
      `Emergency ${event.id} escalated: ${event.patient.emergencyContacts.length} SMS sent.`,
    );
  }

  // -------------------------------------------------------------------------
  // Emergency contacts (patient-managed)
  // -------------------------------------------------------------------------

  async listContacts(requester: AuthenticatedUser) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    return this.prisma.emergencyContact.findMany({
      where: { patientId: patient.id },
      orderBy: { priority: 'asc' },
    });
  }

  async addContact(requester: AuthenticatedUser, dto: CreateEmergencyContactDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const count = await this.prisma.emergencyContact.count({
      where: { patientId: patient.id },
    });
    if (count >= MAX_EMERGENCY_CONTACTS) {
      throw new BadRequestException(
        `Maximum ${MAX_EMERGENCY_CONTACTS} emergency contacts allowed.`,
      );
    }
    return this.prisma.emergencyContact.create({
      data: { patientId: patient.id, ...dto },
    });
  }

  async updateContact(
    requester: AuthenticatedUser,
    contactId: number,
    dto: UpdateEmergencyContactDto,
  ) {
    await this.getOwnedContact(requester, contactId);
    return this.prisma.emergencyContact.update({
      where: { id: contactId },
      data: dto,
    });
  }

  async removeContact(requester: AuthenticatedUser, contactId: number) {
    await this.getOwnedContact(requester, contactId);
    await this.prisma.emergencyContact.delete({ where: { id: contactId } });
  }

  // -------------------------------------------------------------------------

  private async getOrThrow(id: number) {
    const event = await this.prisma.emergencyEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Emergency event not found.');
    return event;
  }

  private async getOwnedContact(requester: AuthenticatedUser, contactId: number) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const contact = await this.prisma.emergencyContact.findUnique({
      where: { id: contactId },
    });
    if (!contact || contact.patientId !== patient.id) {
      throw new ForbiddenException('This contact is not yours.');
    }
    return contact;
  }
}
