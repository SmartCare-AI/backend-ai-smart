import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { FilePurpose } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserEntity } from './entities/user.entity';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async getProfile(userId: number): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        patientProfile: true,
        doctorProfile: true,
        caregiverProfile: true,
      },
    });
    if (!user) throw new NotFoundException('User not found.');
    return UserEntity.fromUser(user);
  }

  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
  ): Promise<UserEntity> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.dateOfBirth !== undefined && {
          dateOfBirth: new Date(dto.dateOfBirth),
        }),
        ...(dto.gender !== undefined && { gender: dto.gender }),
      },
    });
    return UserEntity.fromUser(user);
  }

  /**
   * Uploads the image through the central UploadsService (Cloudflare R2)
   * and points the profile at the new file's public URL.
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
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: uploaded.url },
    });
    return UserEntity.fromUser(user);
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
