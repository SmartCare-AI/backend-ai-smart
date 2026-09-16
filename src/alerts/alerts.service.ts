import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Alert,
  AlertStatus,
  AlertType,
  ConsentType,
  EmergencyType,
  NotificationType,
  Prisma,
  RiskLevel,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { fullName } from '../common/utils/user-name.util';
import { ConsentService } from '../consent/consent.service';
import { EmergencyService } from '../emergency/emergency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';

export interface RaiseAlertInput {
  patientId: number;
  /** ERD Alert.Type — the alert classification. */
  type: AlertType;
  title: string;
  /** ERD Alert.Description is mandatory; defaults to the title when omitted. */
  description?: string;
  severity: RiskLevel;
  /** Dedupe key: "vital_threshold:<VITAL>" | "adherence" | "ai_risk" */
  source: string;
  vitalSignId?: number;
  /**
   * Suppress duplicates: skip if an unresolved alert with the same source
   * exists for this patient within the window. Default 1h.
   */
  cooldownHours?: number;
  /** Escalate to an EmergencyEvent. Defaults to severity === CRITICAL. */
  emergency?: boolean;
  emergencyType?: EmergencyType;
}

/** An alert that still needs attention (ERD: New or Acknowledged). */
const OPEN_STATUSES: AlertStatus[] = [
  AlertStatus.NEW,
  AlertStatus.ACKNOWLEDGED,
];

/**
 * Central alarm bell (ERD #24, FR-024/FR-025). Anything that detects a
 * problem — vital thresholds, adherence jobs, AI anomaly detection — calls
 * raise(): it creates the Alert, notifies the treating doctors and authorized
 * caregivers, and escalates CRITICAL findings to an EmergencyEvent.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
    private readonly emergency: EmergencyService,
  ) {}

  async raise(input: RaiseAlertInput): Promise<Alert | null> {
    // Cooldown: one open alert per source per window — no alarm spam.
    const cooldownMs = (input.cooldownHours ?? 1) * 60 * 60 * 1000;
    const duplicate = await this.prisma.alert.findFirst({
      where: {
        patientId: input.patientId,
        source: input.source,
        status: AlertStatus.NEW,
        createdAt: { gte: new Date(Date.now() - cooldownMs) },
      },
      select: { id: true },
    });
    if (duplicate) return null;

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: input.patientId },
      select: { firstName: true, lastName: true },
    });
    if (!patient) return null;
    const patientName = fullName(patient);

    const alert = await this.prisma.alert.create({
      data: {
        patientId: input.patientId,
        type: input.type,
        title: input.title,
        description: input.description ?? input.title,
        severity: input.severity,
        source: input.source,
        vitalSignId: input.vitalSignId ?? null,
      },
    });

    const isEmergency =
      input.emergency ?? input.severity === RiskLevel.CRITICAL;
    if (isEmergency) {
      // Emergency engine owns the fan-out + SMS escalation timer.
      await this.emergency.openEvent({
        patientId: input.patientId,
        type: input.emergencyType ?? EmergencyType.VITAL_ANOMALY,
        alertId: alert.id,
        description: input.title,
      });
    } else {
      const circle = await this.consent.patientCircleUserIds(input.patientId);
      await this.notifications.notifyMany(circle, {
        type: NotificationType.ALERT,
        title: `Alert — ${patientName}`,
        message: alert.description,
        data: { screen: 'alerts', id: String(alert.id) },
        alertId: alert.id,
      });
    }

    this.logger.log(
      `Alert ${alert.id} (${input.severity}/${input.type}) raised for patient ${input.patientId}: ${input.title}`,
    );
    return alert;
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  async listForPatient(
    requester: AuthenticatedUser,
    patientId: number,
    status: AlertStatus | undefined,
    page: number,
    limit: number,
  ) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.RECEIVE_ALERTS,
    );
    const where = { patientId, ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.alert.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** Doctor's Smart Alert Center: open alerts across all their patients. */
  async listForDoctor(
    requester: AuthenticatedUser,
    page: number,
    limit: number,
  ) {
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    const where: Prisma.AlertWhereInput = {
      status: { in: OPEN_STATUSES },
      patient: { appointments: { some: { doctorId: doctor.id } } },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
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
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.alert.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async updateStatus(
    requester: AuthenticatedUser,
    id: number,
    status: AlertStatus,
  ) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found.');

    // Only a treating doctor (or admin) manages alert lifecycle.
    if (requester.role !== Role.ADMIN) {
      const doctor = await this.profiles.getDoctorByUserId(requester.id);
      const treating = await this.prisma.patientProfile.findFirst({
        where: {
          id: alert.patientId,
          appointments: { some: { doctorId: doctor.id } },
        },
        select: { id: true },
      });
      if (!treating) {
        throw new ForbiddenException('You are not treating this patient.');
      }
    }

    return this.prisma.alert.update({
      where: { id },
      data: {
        status,
        resolvedAt:
          status === AlertStatus.RESOLVED || status === AlertStatus.DISMISSED
            ? new Date()
            : null,
      },
    });
  }
}
