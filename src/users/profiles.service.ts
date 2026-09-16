import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DoctorProfile, PatientProfile, Role } from '@prisma/client';
import { displayName, USER_NAME_INCLUDE } from '../common/utils/user-name.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { UserEntity } from './entities/user.entity';

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
   * ADMIN promotes an existing account to DOCTOR with license details.
   * Admin-created doctors are considered license-verified.
   */
  async promoteToDoctor(
    userId: number,
    dto: CreateDoctorProfileDto,
  ): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        patientProfile: true,
        doctorProfile: true,
        caregiverProfile: true,
      },
    });
    if (!user) throw new NotFoundException('User not found.');

    // Names live on the profile now — take them from the request, or carry
    // over the ones already on record for this account.
    const existingNames =
      user.doctorProfile ?? user.patientProfile ?? user.caregiverProfile;
    const firstName = dto.firstName ?? existingNames?.firstName;
    const lastName = dto.lastName ?? existingNames?.lastName;
    if (!firstName || !lastName) {
      throw new BadRequestException(
        'firstName and lastName are required — this account has no profile to copy them from.',
      );
    }

    const existingLicense = await this.prisma.doctorProfile.findUnique({
      where: { licenseNumber: dto.licenseNumber },
      select: { userId: true },
    });
    if (existingLicense && existingLicense.userId !== userId) {
      throw new ConflictException(
        'This license number is already registered to another doctor.',
      );
    }

    const profileData = {
      firstName,
      lastName,
      licenseNumber: dto.licenseNumber,
      specialization: dto.specialization,
      yearsOfExperience: dto.yearsOfExperience ?? null,
      bio: dto.bio ?? null,
      hospitalId: dto.hospitalId ?? null,
      departmentId: dto.departmentId ?? null,
      isVerified: true,
    };

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { role: Role.DOCTOR },
      }),
      this.prisma.doctorProfile.upsert({
        where: { userId },
        create: { userId, ...profileData },
        update: profileData,
      }),
    ]);

    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        patientProfile: true,
        doctorProfile: true,
        caregiverProfile: true,
      },
    });
    return UserEntity.fromUser(updated);
  }
}
