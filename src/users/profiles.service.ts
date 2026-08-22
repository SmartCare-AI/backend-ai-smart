import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DoctorProfile, PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { UserEntity } from './entities/user.entity';

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
   * Called by AuthService whenever a PATIENT account is created (email
   * registration or first social login). Idempotent.
   * MRN format: SC-<registration year>-<user id, zero-padded> — unique by
   * construction, human-readable for hospital staff.
   */
  async ensurePatientProfile(userId: number): Promise<void> {
    const existing = await this.prisma.patientProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) return;

    const medicalRecordNo = `SC-${new Date().getFullYear()}-${String(userId).padStart(6, '0')}`;
    await this.prisma.patientProfile.create({
      data: { userId, medicalRecordNo },
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const existingLicense = await this.prisma.doctorProfile.findUnique({
      where: { licenseNumber: dto.licenseNumber },
      select: { userId: true },
    });
    if (existingLicense && existingLicense.userId !== userId) {
      throw new ConflictException(
        'This license number is already registered to another doctor.',
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { role: Role.DOCTOR },
      }),
      this.prisma.doctorProfile.upsert({
        where: { userId },
        create: {
          userId,
          licenseNumber: dto.licenseNumber,
          specialization: dto.specialization,
          yearsOfExperience: dto.yearsOfExperience ?? null,
          bio: dto.bio ?? null,
          hospitalId: dto.hospitalId ?? null,
          departmentId: dto.departmentId ?? null,
          isVerified: true,
        },
        update: {
          licenseNumber: dto.licenseNumber,
          specialization: dto.specialization,
          yearsOfExperience: dto.yearsOfExperience ?? null,
          bio: dto.bio ?? null,
          hospitalId: dto.hospitalId ?? null,
          departmentId: dto.departmentId ?? null,
          isVerified: true,
        },
      }),
    ]);
    return UserEntity.fromUser(updated);
  }
}
