import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AdministrationRoute,
  MedicineForm,
  TreatmentPlanStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateTreatmentPlanDto {
  @ApiProperty({ example: 1, description: 'Patient profile id.' })
  @IsInt()
  patientId!: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Diagnosis being treated (BR-006: optional).',
  })
  @IsOptional()
  @IsInt()
  diagnosisId?: number;

  @ApiProperty({
    example:
      'Glycemic control program: diet adjustment + metformin for 3 months.',
    description: 'ERD TreatmentPlan.Description — the planned treatment.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ example: 'HbA1c below 6.5% within 3 months.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  goals?: string;

  @ApiPropertyOptional({ example: '2026-12-16T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdatePlanStatusDto {
  @ApiProperty({
    enum: TreatmentPlanStatus,
    example: TreatmentPlanStatus.COMPLETED,
  })
  @IsEnum(TreatmentPlanStatus)
  status!: TreatmentPlanStatus;
}

export class PrescriptionItemDto {
  @ApiProperty({ example: 'Metformin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  medicineName!: string;

  @ApiPropertyOptional({ example: 'Metformin hydrochloride' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  genericName?: string;

  @ApiPropertyOptional({ enum: MedicineForm, example: MedicineForm.TABLET })
  @IsOptional()
  @IsEnum(MedicineForm)
  form?: MedicineForm;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  strength?: string;

  @ApiProperty({ example: '1 tablet' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  dose!: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: 6,
    description:
      'Intakes per day — the MedicineTracking schedule is generated from this.',
  })
  @IsInt()
  @Min(1)
  @Max(6)
  timesPerDay!: number;

  @ApiProperty({
    example: 7,
    minimum: 1,
    maximum: 180,
    description: 'Days of treatment.',
  })
  @IsInt()
  @Min(1)
  @Max(180)
  durationDays!: number;

  @ApiPropertyOptional({
    enum: AdministrationRoute,
    example: AdministrationRoute.ORAL,
  })
  @IsOptional()
  @IsEnum(AdministrationRoute)
  route?: AdministrationRoute;

  @ApiPropertyOptional({ example: 'Take with food.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;
}

export class CreatePrescriptionDto {
  @ApiProperty({
    example: 1,
    description:
      'Treatment plan this prescription belongs to (BR-007 — mandatory). The patient and prescribing doctor are read from it.',
  })
  @IsInt()
  treatmentPlanId!: number;

  @ApiPropertyOptional({ example: 'Take all medication with meals.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];
}

export class SkipDoseDto {
  @ApiPropertyOptional({
    example: 'Felt nauseous, skipped on doctor’s advice.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SearchMedicinesDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'metfor',
    description: 'Case-insensitive match on name or generic name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: MedicineForm })
  @IsOptional()
  @IsEnum(MedicineForm)
  form?: MedicineForm;
}
