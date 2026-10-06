import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  CareLinkStatus,
  CareRelationshipStatus,
  ConsentStatus,
  ConsentType,
  Prisma,
  ProfileStatus,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * THE rule for touching patient data (SEC-002 RBAC + SEC-003 consent). Every
 * service that reads or writes a patient's medical information calls
 * assertCanAccessPatient() first — controllers know WHO is asking, this
 * service decides MAY THEY, and records the decision in the audit log so the
 * patient can see who opened their record (GET /patients/me/access-history).
 *
 * Access matrix:
 *  - ADMIN                → always (logged)
 *  - the patient themself → always
 *  - DOCTOR               → only with an ACTIVE, unexpired CareRelationship
 *                            and an ACTIVE doctor profile. The relationship is
 *                            created when the doctor confirms an appointment,
 *                            extended by visits, and revocable by the patient.
 *  - CAREGIVER            → only with an active, unexpired PatientCaregiver
 *                            link (BR-003) whose permission level — or an
 *                            extra Consent the patient granted on top of it —
 *                            covers the needed type
 */
/** How long a confirmed appointment / visit keeps a doctor "treating". */
export const CARE_WINDOW_MONTHS = 12;

/** Appointment states that prove the doctor accepted the patient. */
const TREATING_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
];

/** Repeated reads by the same person within this window log once. */
const ACCESS_LOG_THROTTLE_MS = 5 * 60_000;

export const ACCESS_AUDIT = {
  ENTITY: 'PatientRecord',
  ALLOWED: 'RECORD_ACCESS',
  DENIED: 'RECORD_ACCESS_DENIED',
} as const;

function plusCareWindow(from: Date): Date {
  const until = new Date(from);
  until.setMonth(until.getMonth() + CARE_WINDOW_MONTHS);
  return until;
}

@Injectable()
export class ConsentService {
  /** "userId:patientId:outcome" → last logged at (in-process throttle). */
  private readonly lastLogged = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Doctor ↔ patient care relationships
  // -------------------------------------------------------------------------

  /** A relationship that currently grants access. */
  activeRelationshipWhere(): Prisma.CareRelationshipWhereInput {
    return {
      status: CareRelationshipStatus.ACTIVE,
      expiresAt: { gt: new Date() },
      doctor: { status: ProfileStatus.ACTIVE },
    };
  }

  /** Does this doctor (by user id) currently treat this patient profile? */
  async isTreatingDoctor(
    doctorUserId: number,
    patientProfileId: number,
  ): Promise<boolean> {
    const relationship = await this.prisma.careRelationship.findFirst({
      where: {
        patientId: patientProfileId,
        doctor: { userId: doctorUserId },
        ...this.activeRelationshipWhere(),
      },
      select: { id: true },
    });
    return !!relationship;
  }

  /** Patients this doctor (by profile id) currently treats. */
  treatedPatientsWhere(
    doctorProfileId: number,
  ): Prisma.PatientProfileWhereInput {
    return {
      careRelationships: {
        some: { doctorId: doctorProfileId, ...this.activeRelationshipWhere() },
      },
    };
  }

  /**
   * The doctor accepted the patient (confirmed an appointment) or saw them
   * (opened a visit): start or extend the relationship to from + 12 months.
   * A booking is the patient's fresh consent, so this also re-activates a
   * relationship the patient had revoked.
   */
  async grantCare(
    patientId: number,
    doctorId: number,
    from: Date,
  ): Promise<void> {
    const until = plusCareWindow(from);
    const existing = await this.prisma.careRelationship.findUnique({
      where: { patientId_doctorId: { patientId, doctorId } },
    });
    const stillActive =
      existing?.status === CareRelationshipStatus.ACTIVE &&
      existing.expiresAt > new Date();
    await this.prisma.careRelationship.upsert({
      where: { patientId_doctorId: { patientId, doctorId } },
      create: { patientId, doctorId, expiresAt: until },
      update: {
        status: CareRelationshipStatus.ACTIVE,
        revokedAt: null,
        ...(!stillActive && { startsAt: new Date() }),
        expiresAt:
          stillActive && existing.expiresAt > until
            ? existing.expiresAt
            : until,
      },
    });
  }

  /**
   * After an appointment is cancelled, the relationship only lasts as long
   * as the remaining confirmed/completed appointments justify. A revoked
   * relationship stays revoked.
   */
  async recomputeCare(patientId: number, doctorId: number): Promise<void> {
    const existing = await this.prisma.careRelationship.findUnique({
      where: { patientId_doctorId: { patientId, doctorId } },
    });
    if (!existing || existing.status === CareRelationshipStatus.REVOKED) {
      return;
    }
    const latest = await this.prisma.appointment.findFirst({
      where: {
        patientId,
        doctorId,
        status: { in: TREATING_APPOINTMENT_STATUSES },
      },
      orderBy: { endTime: 'desc' },
      select: { endTime: true, visit: { select: { date: true } } },
    });
    const anchor = latest
      ? new Date(
          Math.max(latest.endTime.getTime(), latest.visit?.date.getTime() ?? 0),
        )
      : null;
    const expiresAt = anchor ? plusCareWindow(anchor) : new Date();
    await this.prisma.careRelationship.update({
      where: { id: existing.id },
      data: {
        expiresAt,
        status:
          expiresAt > new Date()
            ? CareRelationshipStatus.ACTIVE
            : CareRelationshipStatus.EXPIRED,
      },
    });
  }

  /** An ACTIVE caregiver link whose end date (if any) is still ahead. */
  activeCaregiverLinkWhere(): Prisma.PatientCaregiverWhereInput {
    return {
      status: CareLinkStatus.ACTIVE,
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    };
  }

  /** Does this caregiver (by user id) currently follow this patient? */
  async hasActiveCaregiverLink(
    caregiverUserId: number,
    patientProfileId: number,
  ): Promise<boolean> {
    const link = await this.prisma.patientCaregiver.findFirst({
      where: {
        patientId: patientProfileId,
        caregiver: { userId: caregiverUserId },
        ...this.activeCaregiverLinkWhere(),
      },
      select: { id: true },
    });
    return !!link;
  }

  async assertCanAccessPatient(
    requester: Pick<AuthenticatedUser, 'id' | 'role'>,
    patientProfileId: number,
    required: ConsentType,
  ): Promise<void> {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientProfileId },
      select: { id: true, userId: true },
    });
    if (!patient) throw new NotFoundException('Patient not found.');
    if (patient.userId === requester.id) return;

    let denial: string | null = null;
    if (requester.role === Role.DOCTOR) {
      if (!(await this.isTreatingDoctor(requester.id, patient.id))) {
        denial = 'You are not a treating doctor for this patient.';
      }
    } else if (requester.role === Role.CAREGIVER) {
      if (
        !(await this.hasCaregiverAccess(requester.id, patient.id, required))
      ) {
        denial = 'The patient has not granted you this permission.';
      }
    } else if (requester.role !== Role.ADMIN) {
      // HOSPITAL_ADMIN gets aggregate dashboards, not record access.
      denial = 'You do not have access to this patient.';
    }

    this.logAccess(requester, patient.id, required, denial === null);
    if (denial) throw new ForbiddenException(denial);
  }

  /**
   * Audit trail of record access by anyone other than the patient. Reads
   * are frequent (every screen of the doctor dashboard), so the same
   * person/patient/outcome is logged at most once per 5 minutes.
   */
  private logAccess(
    requester: Pick<AuthenticatedUser, 'id' | 'role'>,
    patientId: number,
    required: ConsentType,
    allowed: boolean,
  ): void {
    const key = `${requester.id}:${patientId}:${allowed ? 1 : 0}`;
    const now = Date.now();
    const last = this.lastLogged.get(key);
    if (last && now - last < ACCESS_LOG_THROTTLE_MS) return;
    if (this.lastLogged.size > 10_000) this.lastLogged.clear();
    this.lastLogged.set(key, now);
    this.audit.record({
      userId: requester.id,
      action: allowed ? ACCESS_AUDIT.ALLOWED : ACCESS_AUDIT.DENIED,
      entityName: ACCESS_AUDIT.ENTITY,
      entityId: String(patientId),
      description: `${requester.role}:${required}`,
    });
  }

  /**
   * The patient's care circle: user ids of treating doctors + caregivers
   * allowed to receive alerts. This is the recipient list for alerts and
   * emergencies.
   */
  async patientCircleUserIds(patientId: number): Promise<number[]> {
    const [doctors, links] = await Promise.all([
      this.prisma.doctorProfile.findMany({
        where: {
          careRelationships: {
            some: { patientId, ...this.activeRelationshipWhere() },
          },
        },
        select: { userId: true },
      }),
      this.prisma.patientCaregiver.findMany({
        where: {
          patientId,
          ...this.activeCaregiverLinkWhere(),
          // Alerts reach caregivers whose link OR an extra consent covers it.
          AND: [
            {
              OR: [
                {
                  permissionLevel: {
                    in: [ConsentType.RECEIVE_ALERTS, ConsentType.FULL_ACCESS],
                  },
                },
                {
                  caregiver: {
                    user: {
                      consentsReceived: {
                        some: {
                          patientId,
                          status: ConsentStatus.ACTIVE,
                          type: {
                            in: [
                              ConsentType.RECEIVE_ALERTS,
                              ConsentType.FULL_ACCESS,
                            ],
                          },
                          OR: [
                            { expiresAt: null },
                            { expiresAt: { gt: new Date() } },
                          ],
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
        select: { caregiver: { select: { userId: true } } },
      }),
    ]);
    return [
      ...new Set([
        ...doctors.map((d) => d.userId),
        ...links.map((l) => l.caregiver.userId),
      ]),
    ];
  }

  private async hasCaregiverAccess(
    requesterUserId: number,
    patientProfileId: number,
    required: ConsentType,
  ): Promise<boolean> {
    const acceptable = [required, ConsentType.FULL_ACCESS];

    const link = await this.prisma.patientCaregiver.findFirst({
      where: {
        patientId: patientProfileId,
        caregiver: { userId: requesterUserId },
        ...this.activeCaregiverLinkWhere(),
      },
      select: { permissionLevel: true },
    });
    // No active link = no access at all, whatever consents remain.
    if (!link) return false;
    if (acceptable.includes(link.permissionLevel)) return true;

    // Extra permissions the patient granted on top of the link level.
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId: patientProfileId,
        grantedToUserId: requesterUserId,
        status: ConsentStatus.ACTIVE,
        type: { in: acceptable },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    return !!consent;
  }
}
