import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AssessmentType,
  DiagnosisStatus,
  ImagingType,
  RiskLevel,
  Severity,
  TestType,
  VisitType,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateVisitDto {
  @ApiProperty({
    example: 1,
    description:
      'Appointment this encounter realizes. BR-004: every visit belongs to an appointment — book one first (walk-ins are booked as an immediate slot).',
  })
  @IsInt()
  appointmentId!: number;

  @ApiPropertyOptional({
    enum: VisitType,
    description: 'Defaults from the appointment type.',
  })
  @IsOptional()
  @IsEnum(VisitType)
  type?: VisitType;

  @ApiPropertyOptional({ example: 'Recurring chest pain for two weeks' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mainComplaint?: string;

  @ApiPropertyOptional({ example: 'Patient appears fatigued.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CloseVisitDto {
  @ApiPropertyOptional({ example: 'Follow-up in two weeks.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Mark as needing follow-up instead of fully closed',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  followUpRequired?: boolean;
}

export class CreateDiagnosisDto {
  @ApiProperty({ example: 'Type 2 diabetes mellitus' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'E11.9', description: 'ICD-10 code.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional({ example: 'Without complications.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: Severity, example: Severity.MODERATE })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional({
    enum: DiagnosisStatus,
    default: DiagnosisStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(DiagnosisStatus)
  status?: DiagnosisStatus;
}

export class UpdateDiagnosisStatusDto {
  @ApiProperty({ enum: DiagnosisStatus, example: DiagnosisStatus.RESOLVED })
  @IsEnum(DiagnosisStatus)
  status!: DiagnosisStatus;
}

export class CreateAssessmentDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'Patient profile id. Patients may omit it (defaults to their own profile); doctors must provide it.',
  })
  @IsOptional()
  @IsInt()
  patientId?: number;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Attach to a visit (doctors). Omitted for the pre-visit AI assessment.',
  })
  @IsOptional()
  @IsInt()
  visitId?: number;

  @ApiPropertyOptional({
    enum: AssessmentType,
    description: 'Forced to AI_INITIAL for patient-submitted assessments.',
  })
  @IsOptional()
  @IsEnum(AssessmentType)
  type?: AssessmentType;

  @ApiPropertyOptional({
    example: '[{"name":"headache","duration":"3 days","severity":"mild"}]',
    description: 'Symptoms as a JSON string.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  symptoms?: string;

  @ApiPropertyOptional({ example: 'BP slightly elevated.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observations?: string;

  @ApiPropertyOptional({ enum: RiskLevel, example: RiskLevel.LOW })
  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @ApiPropertyOptional({ example: 'cardiology' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  suggestedSpecialty?: string;

  @ApiPropertyOptional({ example: 'Monitor for one week.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateMedicalTestDto {
  @ApiProperty({ example: 'HbA1c' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ enum: TestType, default: TestType.OTHER })
  @IsOptional()
  @IsEnum(TestType)
  type?: TestType;

  @ApiPropertyOptional({ example: 'Fasting sample preferred.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateTestResultDto {
  @ApiProperty({ example: '7.2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  value!: string;

  @ApiPropertyOptional({ example: '%' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @ApiPropertyOptional({ example: '4.0 - 5.6' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  normalRange?: string;

  @ApiPropertyOptional({
    example: 'Above target — indicates poor glycemic control.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  interpretation?: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'Uploaded lab report file id.',
  })
  @IsOptional()
  @IsInt()
  fileId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateMedicalImageDto {
  @ApiProperty({ enum: ImagingType, example: ImagingType.XRAY })
  @IsEnum(ImagingType)
  type!: ImagingType;

  @ApiPropertyOptional({ example: 'chest' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bodyPart?: string;

  @ApiProperty({
    example: 5,
    description: 'File id from POST /uploads (purpose RADIOLOGY).',
  })
  @IsInt()
  fileId!: number;

  @ApiPropertyOptional({ example: 'No acute abnormality.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  report?: string;
}
