import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, AppointmentType } from '@prisma/client';

export class AppointmentEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 1 })
  patientId!: number;

  @ApiProperty({ example: 1 })
  doctorId!: number;

  @ApiPropertyOptional({ nullable: true, example: 3 })
  bookedById!: number | null;

  @ApiProperty({ example: '2026-09-01T10:00:00.000Z' })
  scheduledAt!: Date;

  @ApiPropertyOptional({ nullable: true, example: '2026-09-01T10:30:00.000Z' })
  endsAt!: Date | null;

  @ApiProperty({ enum: AppointmentType, example: AppointmentType.IN_PERSON })
  type!: AppointmentType;

  @ApiProperty({ enum: AppointmentStatus, example: AppointmentStatus.PENDING })
  status!: AppointmentStatus;

  @ApiPropertyOptional({ nullable: true, example: 'Chest pain during exercise' })
  reason!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ example: '2026-08-22T09:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-08-22T09:00:00.000Z' })
  updatedAt!: Date;
}
