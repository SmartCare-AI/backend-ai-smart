import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConsentStatus, ConsentType, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * THE rule for touching patient data. Every service that reads or writes a
 * patient's medical information calls assertCanAccessPatient() first —
 * controllers know WHO is asking, this service decides MAY THEY.
 *
 * Access matrix:
 *  - ADMIN                → always
 *  - the patient themself → always
 *  - DOCTOR              → only with a treating relationship
 *                           (appointment or visit with this patient)
 *  - CAREGIVER           → only with an active PatientCaregiver link or an
 *                           explicit Consent row covering the needed type
 */
@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

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
      const treating = await this.prisma.doctorProfile.findFirst({
        where: {
          userId: requester.id,
          OR: [
            { appointments: { some: { patientId: patient.id } } },
            { visits: { some: { patientId: patient.id } } },
          ],
        },
        select: { id: true },
      });
      if (treating) return;
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

    // HOSPITAL_ADMIN gets aggregate dashboards (Phase G), not record access.
    throw new ForbiddenException('You do not have access to this patient.');
  }

  /**
   * The patient's care circle: user ids of treating doctors (appointment or
   * visit relationship) + caregivers allowed to receive alerts. This is the
   * recipient list for alerts and emergencies.
   */
  async patientCircleUserIds(patientId: number): Promise<number[]> {
    const [doctors, links] = await Promise.all([
      this.prisma.doctorProfile.findMany({
        where: {
          OR: [
            { appointments: { some: { patientId } } },
            { visits: { some: { patientId } } },
          ],
        },
        select: { userId: true },
      }),
      this.prisma.patientCaregiver.findMany({
        where: {
          patientId,
          isActive: true,
          permission: {
            in: [ConsentType.RECEIVE_ALERTS, ConsentType.FULL_ACCESS],
          },
          OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
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
        isActive: true,
        permission: { in: acceptable },
        caregiver: { userId: requesterUserId },
        OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (link) return true;

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
