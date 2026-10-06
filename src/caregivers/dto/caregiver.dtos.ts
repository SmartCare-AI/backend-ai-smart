import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConsentType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const PERMISSION_HELP =
  "RECEIVE_ALERTS = alerts & emergencies only · VIEW_RECORDS = read the medical record · MANAGE_APPOINTMENTS = book/cancel on the patient's behalf · FULL_ACCESS = all of the above.";

export class InviteCaregiverDto {
  @ApiProperty({ example: 'mona@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'daughter',
    description: 'How the invitee relates to the patient.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  relationship!: string;

  @ApiPropertyOptional({
    enum: ConsentType,
    default: ConsentType.RECEIVE_ALERTS,
    description: PERMISSION_HELP,
  })
  @IsOptional()
  @IsEnum(ConsentType)
  permissionLevel?: ConsentType;

  @ApiPropertyOptional({
    example: '2027-01-01',
    description: 'Access ends automatically on this date (optional).',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateCaregiverLinkDto {
  @ApiPropertyOptional({ enum: ConsentType, description: PERMISSION_HELP })
  @IsOptional()
  @IsEnum(ConsentType)
  permissionLevel?: ConsentType;

  @ApiPropertyOptional({
    example: '2027-01-01',
    nullable: true,
    description: 'Send null to remove the end date.',
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsDateString()
  endDate?: string | null;
}

export class GrantConsentDto {
  @ApiProperty({
    example: 12,
    description:
      'User id of a caregiver in your care circle (caregiver.userId from GET /caregivers/my).',
  })
  @IsInt()
  grantedToUserId!: number;

  @ApiProperty({ enum: ConsentType, description: PERMISSION_HELP })
  @IsEnum(ConsentType)
  type!: ConsentType;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
