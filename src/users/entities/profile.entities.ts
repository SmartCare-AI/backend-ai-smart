import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BloodType } from '@prisma/client';

export class PatientProfileEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'SC-2026-000042' })
  medicalRecordNo!: string;

  @ApiPropertyOptional({ enum: BloodType, nullable: true, example: BloodType.O_POS })
  bloodType!: BloodType | null;

  @ApiPropertyOptional({ nullable: true, example: 'Cairo, Egypt' })
  address!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Type 2 diabetes' })
  chronicDiseases!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Penicillin' })
  allergies!: string | null;

  @ApiPropertyOptional({ nullable: true })
  insuranceProvider!: string | null;

  @ApiPropertyOptional({ nullable: true })
  insuranceNumber!: string | null;

  @ApiProperty({ example: '2026-08-20T10:00:00.000Z' })
  registeredAt!: Date;
}

export class DoctorProfileEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'EG-MED-123456' })
  licenseNumber!: string;

  @ApiProperty({ example: 'Cardiology' })
  specialization!: string;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  yearsOfExperience!: number | null;

  @ApiPropertyOptional({ nullable: true })
  bio!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 1 })
  hospitalId!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 2 })
  departmentId!: number | null;

  @ApiProperty({ example: true })
  isVerified!: boolean;
}

export class CaregiverProfileEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiPropertyOptional({ nullable: true, example: 'spouse' })
  relationship!: string | null;

  @ApiPropertyOptional({ nullable: true })
  address!: string | null;
}
