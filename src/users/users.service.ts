import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { FilePurpose, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserEntity } from './entities/user.entity';

const BCRYPT_ROUNDS = 12;

/** Every read of "me" loads the role profiles so names resolve. */
const PROFILE_INCLUDE = {
  patientProfile: true,
  doctorProfile: true,
  caregiverProfile: true,
} satisfies Prisma.UserInclude;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async getProfile(userId: number): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: PROFILE_INCLUDE,
    });
    if (!user) throw new NotFoundException('User not found.');
    return UserEntity.fromUser(user);
  }

  /**
   * Partial update spanning the account and the caller's role profile.
   * Identity (first/last name) and role-specific fields are written to the
   * profile entity that matches `role`; fields that do not apply are ignored.
   */
  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
  ): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: PROFILE_INCLUDE,
    });
    if (!user) throw new NotFoundException('User not found.');

    const writes: Prisma.PrismaPromise<unknown>[] = [];

    if (dto.phone !== undefined) {
      writes.push(
        this.prisma.user.update({
          where: { id: userId },
          data: { phone: dto.phone },
        }),
      );
    }

    const identity = {
      ...(dto.firstName !== undefined && { firstName: dto.firstName }),
      ...(dto.lastName !== undefined && { lastName: dto.lastName }),
    };

    if (user.role === Role.PATIENT && user.patientProfile) {
      const data: Prisma.PatientProfileUpdateInput = {
        ...identity,
        ...(dto.dateOfBirth !== undefined && {
          dateOfBirth: new Date(dto.dateOfBirth),
        }),
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...(dto.bloodType !== undefined && { bloodType: dto.bloodType }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.emergencyContact !== undefined && {
          emergencyContact: dto.emergencyContact,
        }),
        ...(dto.emergencyPhone !== undefined && {
          emergencyPhone: dto.emergencyPhone,
        }),
        ...(dto.chronicDiseases !== undefined && {
          chronicDiseases: dto.chronicDiseases,
        }),
        ...(dto.allergies !== undefined && { allergies: dto.allergies }),
        ...(dto.insuranceProvider !== undefined && {
          insuranceProvider: dto.insuranceProvider,
        }),
        ...(dto.insuranceNumber !== undefined && {
          insuranceNumber: dto.insuranceNumber,
        }),
      };
      if (Object.keys(data).length > 0) {
        writes.push(
          this.prisma.patientProfile.update({ where: { userId }, data }),
        );
      }
    } else if (user.role === Role.DOCTOR && user.doctorProfile) {
      const data: Prisma.DoctorProfileUpdateInput = {
        ...identity,
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.yearsOfExperience !== undefined && {
          yearsOfExperience: dto.yearsOfExperience,
        }),
      };
      if (Object.keys(data).length > 0) {
        writes.push(
          this.prisma.doctorProfile.update({ where: { userId }, data }),
        );
      }
    } else if (user.role === Role.CAREGIVER && user.caregiverProfile) {
      const data: Prisma.CaregiverProfileUpdateInput = {
        ...identity,
        ...(dto.relationship !== undefined && {
          relationship: dto.relationship,
        }),
        ...(dto.address !== undefined && { address: dto.address }),
      };
      if (Object.keys(data).length > 0) {
        writes.push(
          this.prisma.caregiverProfile.update({ where: { userId }, data }),
        );
      }
    } else if (Object.keys(identity).length > 0) {
      // ADMIN / HOSPITAL_ADMIN have no ERD profile entity to hold a name.
      throw new BadRequestException(
        'This account has no role profile, so it cannot store a name.',
      );
    }

    if (writes.length > 0) await this.prisma.$transaction(writes);
    return this.getProfile(userId);
  }

  /**
   * Uploads the image through the central UploadsService (Cloudflare R2)
   * and points the account at the new file's public URL.
   */
  async updateAvatar(
    userId: number,
    file: Express.Multer.File,
  ): Promise<UserEntity> {
    const uploaded = await this.uploads.upload(
      file,
      userId,
      FilePurpose.AVATAR,
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: uploaded.url },
    });
    return this.getProfile(userId);
  }

  async changePassword(
    userId: number,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (!user.password) {
      throw new BadRequestException(
        'This account uses Google/Apple sign-in and has no password.',
      );
    }
    const ok = await bcrypt.compare(dto.currentPassword, user.password);
    if (!ok) throw new UnauthorizedException('Current password is incorrect.');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current one.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS) },
      }),
      // Force re-login on all other devices.
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return {
      message: 'Password changed. Other sessions have been logged out.',
    };
  }
}
