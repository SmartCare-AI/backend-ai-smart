import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthProvider, Role, User, UserStatus } from '@prisma/client';
import { displayName } from '../../common/utils/user-name.util';
import type { UserWithProfileNames } from '../../common/utils/user-name.util';
import {
  CaregiverProfileEntity,
  DoctorProfileEntity,
  PatientProfileEntity,
} from './profile.entities';

/** A User row optionally loaded with its role profiles. */
type UserWithProfiles = User & {
  patientProfile?: PatientProfileEntity | null;
  doctorProfile?: DoctorProfileEntity | null;
  caregiverProfile?: CaregiverProfileEntity | null;
};

/**
 * Public representation of an account — never exposes the password hash.
 *
 * Per the ERD, the account holds no personal identity: names live on the role
 * profile. `fullName` is resolved from whichever profile is loaded so clients
 * always have something to render.
 */
export class UserEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'patient@example.com' })
  email!: string;

  @ApiProperty({
    example: 'Omar Youssef',
    description:
      'Resolved from the role profile. Falls back to the email local part for accounts without one (admins).',
  })
  fullName!: string;

  @ApiPropertyOptional({ example: '+201001234567', nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({
    example: 'https://cdn.shifaa.ai/avatars/omar.png',
    nullable: true,
  })
  avatarUrl!: string | null;

  @ApiProperty({ enum: Role, example: Role.PATIENT })
  role!: Role;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiProperty({ enum: AuthProvider, example: AuthProvider.EMAIL })
  provider!: AuthProvider;

  @ApiProperty({ example: true })
  isEmailVerified!: boolean;

  @ApiPropertyOptional({ example: '2026-09-16T09:30:00.000Z', nullable: true })
  lastLoginAt!: Date | null;

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
  static fromUser(user: UserWithProfiles): UserEntity {
    const { password: _password, firebaseUid: _uid, ...safe } = user;
    return Object.assign(new UserEntity(), safe, {
      fullName: displayName(user as UserWithProfileNames),
    });
  }
}
