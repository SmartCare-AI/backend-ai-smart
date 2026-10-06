import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  CareLinkStatus,
  ConsentStatus,
  ConsentType,
  Prisma,
  ProfileStatus,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * THE rule for touching patient data (SEC-002 RBAC + SEC-003 consent). Every
 * service that reads or writes a patient's medical information calls
 * assertCanAccessPatient() first — controllers know WHO is asking, this
 * service decides MAY THEY.
 *
 * Access matrix:
 *  - ADMIN                → always
 *  - the patient themself → always
 *  - DOCTOR               → only with a CURRENT treating relationship: a
 *                            confirmed or completed appointment within the
 *                            care window (12 months). Cancelled or pending
 *                            bookings and long-past care grant nothing, and a
 *                            suspended doctor loses access.
 *  - CAREGIVER            → only with an active, unexpired PatientCaregiver
 *                            link (BR-003) whose permission level — or an
 *                            extra Consent the patient granted on top of it —
 *                            covers the needed type
 */
/** How long a confirmed/completed appointment keeps a doctor "treating". */
export const CARE_WINDOW_MONTHS = 12;

/** Appointment states that prove the doctor accepted the patient. */
const TREATING_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
];

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The single definition of "treating doctor" — used by the access gate,
   * the care circle (alert/emergency recipients), chat and the alert center.
   */
  treatingAppointmentWhere(): Prisma.AppointmentWhereInput {
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - CARE_WINDOW_MONTHS);
    return {
      status: { in: TREATING_APPOINTMENT_STATUSES },
      startTime: { gte: windowStart },
    };
  }

  /** Does this doctor (by user id) currently treat this patient profile? */
  async isTreatingDoctor(
    doctorUserId: number,
    patientProfileId: number,
  ): Promise<boolean> {
    const treating = await this.prisma.doctorProfile.findFirst({
      where: {
        userId: doctorUserId,
        status: ProfileStatus.ACTIVE,
        appointments: {
          some: {
            patientId: patientProfileId,
            ...this.treatingAppointmentWhere(),
          },
        },
      },
      select: { id: true },
    });
    return !!treating;
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

  /** Patient profile ids this doctor (by profile id) currently treats. */
  treatedPatientsWhere(
    doctorProfileId: number,
  ): Prisma.PatientProfileWhereInput {
    return {
      appointments: {
        some: { doctorId: doctorProfileId, ...this.treatingAppointmentWhere() },
      },
    };
  }

  async assertCanAccessPatient(
    requester: Pick<AuthenticatedUser, 'id' | 'role'>,
    patientProfileId: number,
    required: ConsentType,
  ): Promise<void> {
    if (requester.role === Role.ADMIN) return;

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientProfileId },
      select: { id: true, userId: true },
    });
    if (!patient) throw new NotFoundException('Patient not found.');

    if (patient.userId === requester.id) return;

    if (requester.role === Role.DOCTOR) {
      if (await this.isTreatingDoctor(requester.id, patient.id)) return;
      throw new ForbiddenException(
        'You are not a treating doctor for this patient.',
      );
    }

    if (requester.role === Role.CAREGIVER) {
      const allowed = await this.hasCaregiverAccess(
        requester.id,
        patient.id,
        required,
      );
      if (allowed) return;
      throw new ForbiddenException(
        'The patient has not granted you this permission.',
      );
    }

    // HOSPITAL_ADMIN gets aggregate dashboards, not record access.
    throw new ForbiddenException('You do not have access to this patient.');
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
          status: ProfileStatus.ACTIVE,
          appointments: {
            some: { patientId, ...this.treatingAppointmentWhere() },
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
