import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DoctorRegistrationDto } from '../../doctors/dto/doctor.dtos';

/** Account types that can sign up on their own. */
export const SELF_SERVICE_ACCOUNT_TYPES = ['PATIENT', 'DOCTOR'] as const;
export type SelfServiceAccountType =
  (typeof SELF_SERVICE_ACCOUNT_TYPES)[number];

export class RegisterDto {
  @ApiProperty({
    example: 'patient@example.com',
    description: 'A verification code will be sent to this address.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'P@ssw0rd123',
    minLength: 8,
    description:
      'Min 8 characters, must contain at least one letter and one number.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;

  @ApiProperty({ example: 'Omar' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName!: string;

  @ApiProperty({ example: 'Hassan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName!: string;

  @ApiPropertyOptional({
    example: '+201001234567',
    description: 'E.164 format with country code.',
  })
  @IsOptional()
  @IsPhoneNumber(undefined, {
    message: 'phone must be a valid number in E.164 format (e.g. +2010...)',
  })
  phone?: string;

  @ApiPropertyOptional({
    enum: SELF_SERVICE_ACCOUNT_TYPES,
    default: 'PATIENT',
    description:
      'PATIENT (default) or DOCTOR. Caregivers join through a patient invitation; admins are never self-registered.',
  })
  @IsOptional()
  @IsIn(SELF_SERVICE_ACCOUNT_TYPES)
  accountType?: SelfServiceAccountType;

  @ApiPropertyOptional({
    type: DoctorRegistrationDto,
    description: 'Required when accountType = DOCTOR; ignored otherwise.',
  })
  @ValidateIf((o: RegisterDto) => o.accountType === 'DOCTOR')
  @IsDefined({ message: 'doctor details are required for a DOCTOR account' })
  @ValidateNested()
  @Type(() => DoctorRegistrationDto)
  doctor?: DoctorRegistrationDto;
}
