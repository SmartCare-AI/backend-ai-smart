import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Alert,
  AlertStatus,
  ConsentType,
  EmergencyType,
  NotificationType,
  RiskLevel,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';

export interface RaiseAlertInput {
  patientId: number;
  title: string;
  description?: string;
  severity: RiskLevel;
  /** What produced it: "vital_threshold" | "adherence" | "ai_anomaly" */
  source: string;
  vitalSignId?: number;
  /**
   * Suppress duplicates: skip if an ACTIVE alert with the same source exists
   * for this patient within the window. Default 1h.
   */
  cooldownHours?: number;
  /** Escalate to an EmergencyEvent. Defaults to severity === CRITICAL. */
  emergency?: boolean;
  emergencyType?: EmergencyType;
}

/**
 * Central alarm bell. Anything that detects a problem (vital thresholds,
 * adherence jobs, future AI anomaly detection) calls raise() — it creates
 * the Alert, notifies the treating doctors and authorized caregivers, and
 * escalates CRITICAL findings to an EmergencyEvent.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async raise(input: RaiseAlertInput): Promise<Alert | null> {
    // Cooldown: one active alert per source per window — no alarm spam.
    const cooldownMs = (input.cooldownHours ?? 1) * 60 * 60 * 1000;
    const duplicate = await this.prisma.alert.findFirst({
      where: {
        patientId: input.patientId,
        source: input.source,
        status: AlertStatus.ACTIVE,
        createdAt: { gte: new Date(Date.now() - cooldownMs) },
      },
      select: { id: true },
    });
    if (duplicate) return null;

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: input.patientId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!patient) return null;
    const patientName = `${patient.user.firstName} ${patient.user.lastName}`;

    const alert = await this.prisma.alert.create({
      data: {
        patientId: input.patientId,
        title: input.title,
        description: input.description,
        severity: input.severity,
        source: input.source,
        vitalSignId: input.vitalSignId ?? null,
      },
    });

    const isEmergency = input.emergency ?? input.severity === RiskLevel.CRITICAL;
    if (isEmergency) {
      await this.prisma.emergencyEvent.create({
        data: {
          patientId: input.patientId,
          type: input.emergencyType ?? EmergencyType.VITAL_ANOMALY,
          alertId: alert.id,
          description: input.title,
        },
      });
    }

    const notificationType = isEmergency
      ? NotificationType.EMERGENCY
      : NotificationType.ALERT;
    const title = isEmergency
      ? `EMERGENCY — ${patientName}`
      : `Alert — ${patientName}`;
    const recipients = new Set<number>([
      ...(await this.treatingDoctorUserIds(input.patientId)),
      ...(await this.caregiverUserIds(input.patientId)),
    ]);
    await this.notifications.notifyMany([...recipients], {
      type: notificationType,
      title,
      body: input.description ?? input.title,
      data: { screen: 'alerts', id: String(alert.id) },
      alertId: alert.id,
    });

    this.logger.log(
      `Alert ${alert.id} (${input.severity}) raised for patient ${input.patientId}: ${input.title}`,
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

  /** Doctor's Smart Alert Center: active alerts across all their patients. */
  async listForDoctor(requester: AuthenticatedUser, page: number, limit: number) {
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    const where = {
      status: AlertStatus.ACTIVE,
      patient: {
        OR: [
          { appointments: { some: { doctorId: doctor.id } } },
          { visits: { some: { doctorId: doctor.id } } },
        ],
      },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              medicalRecordNo: true,
              user: { select: { firstName: true, lastName: true } },
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
    if (requester.role !== 'ADMIN') {
      const doctor = await this.profiles.getDoctorByUserId(requester.id);
      const treating = await this.prisma.patientProfile.findFirst({
        where: {
          id: alert.patientId,
          OR: [
            { appointments: { some: { doctorId: doctor.id } } },
            { visits: { some: { doctorId: doctor.id } } },
          ],
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

  // -------------------------------------------------------------------------

  private async treatingDoctorUserIds(patientId: number): Promise<number[]> {
    const doctors = await this.prisma.doctorProfile.findMany({
      where: {
        OR: [
          { appointments: { some: { patientId } } },
          { visits: { some: { patientId } } },
        ],
      },
      select: { userId: true },
    });
    return doctors.map((d) => d.userId);
  }

  private async caregiverUserIds(patientId: number): Promise<number[]> {
    const links = await this.prisma.patientCaregiver.findMany({
      where: {
        patientId,
        isActive: true,
        permission: { in: [ConsentType.RECEIVE_ALERTS, ConsentType.FULL_ACCESS] },
        OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      },
      select: { caregiver: { select: { userId: true } } },
    });
    return links.map((l) => l.caregiver.userId);
  }
}
