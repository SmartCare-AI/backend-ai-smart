import { ApiPropertyOptional } from '@nestjs/swagger';
import { BloodType, Gender } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Partial update of the caller's own account + role profile.
 *
 * Account-level fields (phone) go to `users`; identity and role-specific
 * fields go to the matching profile entity — fields that do not apply to the
 * caller's role are ignored.
 */
export class UpdateProfileDto {
  // --- Identity (all roles, written to the caller's profile) ----------------

  @ApiPropertyOptional({ example: 'Omar' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Youssef' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName?: string;

  // --- Account level --------------------------------------------------------

  @ApiPropertyOptional({
    example: '+201001234567',
    description: 'E.164 format with country code. Stored on the account.',
  })
  @IsOptional()
  @IsPhoneNumber(undefined, {
    message: 'phone must be a valid number in E.164 format (e.g. +2010...)',
  })
  phone?: string;

  // --- Patient profile ------------------------------------------------------

  @ApiPropertyOptional({ example: '1998-05-14', description: 'PATIENT only.' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender, description: 'PATIENT only.' })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ enum: BloodType, description: 'PATIENT only.' })
  @IsOptional()
  @IsEnum(BloodType)
  bloodType?: BloodType;

  @ApiPropertyOptional({
    example: 'Mona Youssef',
    description: 'PATIENT only — emergency contact name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContact?: string;

  @ApiPropertyOptional({
    example: '+201001112223',
    description: 'PATIENT only — emergency contact phone.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyPhone?: string;

  @ApiPropertyOptional({
    example: 'Type 2 diabetes',
    description: 'PATIENT only.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chronicDiseases?: string;

  @ApiPropertyOptional({ example: 'Penicillin', description: 'PATIENT only.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  allergies?: string;

  @ApiPropertyOptional({ description: 'PATIENT only.' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  insuranceProvider?: string;

  @ApiPropertyOptional({ description: 'PATIENT only.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  insuranceNumber?: string;

  // --- Patient & caregiver --------------------------------------------------

  @ApiPropertyOptional({
    example: 'Cairo, Egypt',
    description: 'PATIENT and CAREGIVER.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  // --- Caregiver profile ----------------------------------------------------

  @ApiPropertyOptional({ example: 'spouse', description: 'CAREGIVER only.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  relationship?: string;

  // --- Doctor profile -------------------------------------------------------

  @ApiPropertyOptional({
    example: 'Consultant cardiologist, Cairo University.',
    description: 'DOCTOR only.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional({ example: 12, description: 'DOCTOR only.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(70)
  yearsOfExperience?: number;
}
