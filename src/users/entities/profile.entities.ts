import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BloodType, Gender, ProfileStatus } from '@prisma/client';

/** ERD #2 Patient — personal identity + clinical background. */
export class PatientProfileEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Omar' })
  firstName!: string;

  @ApiProperty({ example: 'Youssef' })
  lastName!: string;

  @ApiProperty({ example: 'SH-2026-000042' })
  medicalRecordNo!: string;

  @ApiPropertyOptional({ nullable: true, example: '1998-05-14T00:00:00.000Z' })
  dateOfBirth!: Date | null;

  @ApiPropertyOptional({ enum: Gender, nullable: true, example: Gender.MALE })
  gender!: Gender | null;

  @ApiPropertyOptional({
    enum: BloodType,
    nullable: true,
    example: BloodType.O_POS,
  })
  bloodType!: BloodType | null;

  @ApiPropertyOptional({ nullable: true, example: 'Cairo, Egypt' })
  address!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Mona Youssef' })
  emergencyContact!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+201001112223' })
  emergencyPhone!: string | null;

  @ApiProperty({ example: '2026-08-20T10:00:00.000Z' })
  registrationDate!: Date;

  @ApiProperty({ enum: ProfileStatus, example: ProfileStatus.ACTIVE })
  status!: ProfileStatus;

  @ApiPropertyOptional({ nullable: true, example: 'Type 2 diabetes' })
  chronicDiseases!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Penicillin' })
  allergies!: string | null;

  @ApiPropertyOptional({ nullable: true })
  insuranceProvider!: string | null;

  @ApiPropertyOptional({ nullable: true })
  insuranceNumber!: string | null;
}

/** ERD #3 Doctor. */
export class DoctorProfileEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Ahmed' })
  firstName!: string;

  @ApiProperty({ example: 'Hassan' })
  lastName!: string;

  @ApiProperty({ example: 'EG-MED-123456' })
  licenseNumber!: string;

  @ApiProperty({ example: 'Cardiology' })
  specialization!: string;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  yearsOfExperience!: number | null;

  @ApiPropertyOptional({ nullable: true })
  bio!: string | null;

  @ApiProperty({ enum: ProfileStatus, example: ProfileStatus.ACTIVE })
  status!: ProfileStatus;

  @ApiPropertyOptional({ nullable: true, example: 1 })
  hospitalId!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 2 })
  departmentId!: number | null;

  @ApiProperty({ example: true })
  isVerified!: boolean;
}

/** ERD #4 Caregiver. Contact phone is account-level (`User.phone`). */
export class CaregiverProfileEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Mona' })
  firstName!: string;

  @ApiProperty({ example: 'Youssef' })
  lastName!: string;

  @ApiProperty({ example: 'spouse' })
  relationship!: string;

  @ApiPropertyOptional({ nullable: true })
  address!: string | null;

  @ApiProperty({ enum: ProfileStatus, example: ProfileStatus.ACTIVE })
  status!: ProfileStatus;
}
