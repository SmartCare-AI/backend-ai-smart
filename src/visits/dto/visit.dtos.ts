import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AppointmentType,
  AssessmentType,
  RiskLevel,
  Severity,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateVisitDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'Create the visit from this appointment (marks it COMPLETED). Omit for a walk-in visit.',
  })
  @IsOptional()
  @IsInt()
  appointmentId?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Required for walk-in visits (no appointmentId).',
  })
  @ValidateIf((o: CreateVisitDto) => !o.appointmentId)
  @IsInt()
  patientId?: number;

  @ApiPropertyOptional({ enum: AppointmentType, default: AppointmentType.IN_PERSON })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

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

  @ApiPropertyOptional({ example: 1, description: 'Attach to a visit (doctors).' })
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

  @ApiPropertyOptional({ example: 'blood' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

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

  @ApiPropertyOptional({ example: 'Above target — indicates poor glycemic control.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  interpretation?: string;

  @ApiPropertyOptional({ example: 3, description: 'Uploaded lab report file id.' })
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
  @ApiProperty({ example: 'XRAY', description: 'XRAY | CT | MRI | ULTRASOUND' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  type!: string;

  @ApiPropertyOptional({ example: 'chest' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bodyPart?: string;

  @ApiProperty({ example: 5, description: 'File id from POST /uploads (purpose RADIOLOGY).' })
  @IsInt()
  fileId!: number;

  @ApiPropertyOptional({ example: 'No acute abnormality.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  report?: string;
}
