import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { ProfileStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { SPECIALIZATIONS } from '../specializations';

const toKey = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Professional details shared by registration and profile editing. */
export class DoctorProfessionalDto {
  @ApiProperty({
    example: 'cardiology',
    enum: SPECIALIZATIONS,
    description:
      'One of GET /doctors/specializations (lowercase key). Same keys as AI triage `suggestedSpecialty`.',
  })
  @Transform(toKey)
  @IsIn(SPECIALIZATIONS, {
    message: 'specialization must be one of GET /doctors/specializations',
  })
  specialization!: string;

  @ApiProperty({ example: 8, minimum: 0, maximum: 70 })
  @IsInt()
  @Min(0)
  @Max(70)
  yearsOfExperience!: number;

  @ApiPropertyOptional({
    example: 'Consultant cardiologist with a focus on hypertension.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Optional workplace from GET /hospitals.',
  })
  @IsOptional()
  @IsInt()
  hospitalId?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Optional; must belong to hospitalId.',
  })
  @IsOptional()
  @IsInt()
  departmentId?: number;
}

/** The `doctor` block of POST /auth/register when accountType = DOCTOR. */
export class DoctorRegistrationDto extends DoctorProfessionalDto {
  @ApiProperty({
    example: 'EG-MED-123456',
    description:
      'Medical license number. Unique across the platform. Not verified against a registry in the MVP.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9\-/ ]+$/, {
    message: 'licenseNumber may contain letters, digits, spaces, - and /',
  })
  licenseNumber!: string;
}

/** POST /doctors/me/profile — an existing (e.g. Google) account becomes a doctor. */
export class BecomeDoctorDto extends DoctorRegistrationDto {
  @ApiPropertyOptional({
    example: 'Ahmed',
    description: 'Defaults to the name already on the account.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Hassan' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName?: string;
}

/** PATCH /doctors/me — the license number is fixed after registration. */
export class UpdateMyDoctorProfileDto extends PartialType(
  OmitType(BecomeDoctorDto, ['licenseNumber'] as const),
) {}

export class SearchDoctorsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'cardiology' })
  @IsOptional()
  @Transform(toKey)
  @IsIn(SPECIALIZATIONS, {
    message: 'specialization must be one of GET /doctors/specializations',
  })
  specialization?: string;

  @ApiPropertyOptional({
    example: 'hassan',
    description: 'Matches first or last name (case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  hospitalId?: number;
}

export class AdminListDoctorsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ProfileStatus })
  @IsOptional()
  @IsIn(Object.values(ProfileStatus))
  status?: ProfileStatus;

  @ApiPropertyOptional({ description: 'Name, email or license number.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class SetDoctorStatusDto {
  @ApiProperty({
    enum: [ProfileStatus.ACTIVE, ProfileStatus.SUSPENDED],
    example: ProfileStatus.SUSPENDED,
  })
  @IsIn([ProfileStatus.ACTIVE, ProfileStatus.SUSPENDED])
  status!: ProfileStatus;

  @ApiPropertyOptional({
    example: 'License could not be confirmed.',
    description: 'Shown to the doctor in the notification.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
