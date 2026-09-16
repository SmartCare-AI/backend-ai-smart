import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, AppointmentType } from '@prisma/client';

/** ERD #8 Appointment. */
export class AppointmentEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 1 })
  patientId!: number;

  @ApiProperty({ example: 1 })
  doctorId!: number;

  @ApiProperty({
    example: '2026-10-01T00:00:00.000Z',
    description: 'Calendar day of the appointment (ERD Date).',
  })
  date!: Date;

  @ApiProperty({ example: '2026-10-01T10:00:00.000Z' })
  startTime!: Date;

  @ApiProperty({ example: '2026-10-01T10:30:00.000Z' })
  endTime!: Date;

  @ApiProperty({ enum: AppointmentType, example: AppointmentType.IN_PERSON })
  type!: AppointmentType;

  @ApiProperty({ enum: AppointmentStatus, example: AppointmentStatus.PENDING })
  status!: AppointmentStatus;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Chest pain during exercise',
  })
  reason!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 3,
    description: 'User who created the booking (patient or caregiver).',
  })
  bookedById!: number | null;

  @ApiProperty({ example: '2026-09-16T09:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-09-16T09:00:00.000Z' })
  updatedAt!: Date;
}
