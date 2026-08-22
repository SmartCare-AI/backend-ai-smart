import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthProvider, Gender, Role, User } from '@prisma/client';
import {
  CaregiverProfileEntity,
  DoctorProfileEntity,
  PatientProfileEntity,
} from './profile.entities';

/**
 * Public representation of a user — never exposes the password hash.
 */
export class UserEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'patient@example.com' })
  email!: string;

  @ApiProperty({ example: 'Omar' })
  firstName!: string;

  @ApiProperty({ example: 'Hassan' })
  lastName!: string;

  @ApiPropertyOptional({ example: '+201001234567', nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({
    example: '1998-05-14T00:00:00.000Z',
    nullable: true,
  })
  dateOfBirth!: Date | null;

  @ApiPropertyOptional({ enum: Gender, example: Gender.MALE, nullable: true })
  gender!: Gender | null;

  @ApiPropertyOptional({
    example: 'https://cdn.smartcare.ai/avatars/omar.png',
    nullable: true,
  })
  avatarUrl!: string | null;

  @ApiProperty({ enum: Role, example: Role.PATIENT })
  role!: Role;

  @ApiProperty({ enum: AuthProvider, example: AuthProvider.EMAIL })
  provider!: AuthProvider;

  @ApiProperty({ example: true })
  isEmailVerified!: boolean;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-08-12T09:30:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-08-12T09:30:00.000Z' })
  updatedAt!: Date;

  @ApiPropertyOptional({
    type: PatientProfileEntity,
    nullable: true,
    description: 'Present when role=PATIENT and profile relations are loaded.',
  })
  patientProfile?: PatientProfileEntity | null;

  @ApiPropertyOptional({ type: DoctorProfileEntity, nullable: true })
  doctorProfile?: DoctorProfileEntity | null;

  @ApiPropertyOptional({ type: CaregiverProfileEntity, nullable: true })
  caregiverProfile?: CaregiverProfileEntity | null;

  /** Accepts a plain User or one loaded with profile relations. */
  static fromUser(user: User): UserEntity {
    const { password: _password, firebaseUid: _uid, ...safe } = user;
    return Object.assign(new UserEntity(), safe);
  }
}
