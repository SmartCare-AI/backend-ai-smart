import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DoctorProfile, EntityStatus, PatientProfile } from '@prisma/client';
import { displayName, USER_NAME_INCLUDE } from '../common/utils/user-name.util';
import { PrismaService } from '../prisma/prisma.service';

export interface ProfileIdentity {
  firstName: string;
  lastName: string;
}

/**
 * Owns the three ERD profile entities (Patient #2, Doctor #3, Caregiver #4)
 * that carry a user's personal identity. Every service that needs a profile id
 * or a display name for an account goes through here.
 */
@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The requester's own patient profile — 403 if they aren't a patient. */
  async getPatientByUserId(userId: number): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new ForbiddenException('This action requires a patient account.');
    }
    return profile;
  }

  /** The requester's own doctor profile — 403 if they aren't a doctor. */
  async getDoctorByUserId(userId: number): Promise<DoctorProfile> {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new ForbiddenException('This action requires a doctor account.');
    }
    return profile;
  }

  /**
   * Human-readable name of any account, resolved from its role profile
   * (see common/utils/user-name.util.ts for the fallback rules).
   */
  async displayNameOf(userId: number): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, ...USER_NAME_INCLUDE },
    });
    return user ? displayName(user) : 'User';
  }

  /**
   * Called by AuthService whenever a PATIENT account is created (email
   * registration or first social login). Idempotent — an existing profile is
   * left untouched.
   *
   * MRN format: SH-<registration year>-<user id, zero-padded> — unique by
   * construction, human-readable for hospital staff.
   */
  async ensurePatientProfile(
    userId: number,
    identity: ProfileIdentity,
  ): Promise<void> {
    const existing = await this.prisma.patientProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) return;

    const medicalRecordNo = `SH-${new Date().getFullYear()}-${String(userId).padStart(6, '0')}`;
    await this.prisma.patientProfile.create({
      data: {
        userId,
        firstName: identity.firstName,
        lastName: identity.lastName,
        medicalRecordNo,
      },
    });
  }

  /**
   * Validates the optional workplace of a doctor: the hospital must be
   * active and the department must belong to it.
   */
  async assertPlacement(
    hospitalId?: number | null,
    departmentId?: number | null,
  ): Promise<void> {
    if (departmentId != null && hospitalId == null) {
      throw new BadRequestException('departmentId requires hospitalId.');
    }
    if (hospitalId != null) {
      const hospital = await this.prisma.hospital.findFirst({
        where: { id: hospitalId, status: EntityStatus.ACTIVE },
        select: { id: true },
      });
      if (!hospital) throw new BadRequestException('Unknown hospitalId.');
    }
    if (departmentId != null) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, hospitalId: hospitalId ?? undefined },
        select: { id: true },
      });
      if (!department) {
        throw new BadRequestException(
          'departmentId does not belong to hospitalId.',
        );
      }
    }
  }

  /** 409 when the license number belongs to a different account. */
  async assertLicenseAvailable(
    licenseNumber: string,
    userId?: number,
  ): Promise<void> {
    const owner = await this.prisma.doctorProfile.findUnique({
      where: { licenseNumber },
      select: { userId: true },
    });
    if (owner && owner.userId !== userId) {
      throw new ConflictException(
        'This license number is already registered to another doctor.',
      );
    }
  }
}
