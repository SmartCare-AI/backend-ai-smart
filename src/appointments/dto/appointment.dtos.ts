import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateAppointmentDto {
  @ApiProperty({
    example: 1,
    description:
      'Patient profile id. Patients book for themselves; caregivers need MANAGE_APPOINTMENTS permission.',
  })
  @IsInt()
  patientId!: number;

  @ApiProperty({ example: 1, description: 'Doctor profile id.' })
  @IsInt()
  doctorId!: number;

  @ApiProperty({
    example: '2026-10-01T10:00:00.000Z',
    description: 'Slot start (UTC). The ERD Date is derived from it.',
  })
  @IsDateString()
  startTime!: string;

  @ApiPropertyOptional({
    default: 30,
    minimum: 10,
    maximum: 180,
    description: 'Slot length — EndTime is startTime + this.',
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(180)
  durationMinutes?: number = 30;

  @ApiPropertyOptional({
    enum: AppointmentType,
    default: AppointmentType.IN_PERSON,
    description:
      'VIDEO and CHAT appointments automatically get an Online Visit (telemedicine session).',
  })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiPropertyOptional({ example: 'Chest pain during exercise' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ example: 'Prefers a morning slot.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ListAppointmentsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    description: 'Only appointments from now onwards',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  upcoming?: boolean;
}

export class DoctorScheduleDto {
  @ApiProperty({
    example: '2026-10-01',
    description: 'Day to inspect (YYYY-MM-DD).',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class CancelAppointmentDto {
  @ApiPropertyOptional({ example: 'Patient is travelling' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
