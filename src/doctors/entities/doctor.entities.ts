import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProfileStatus } from '@prisma/client';

class NamedRefEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'SHIFAA Hospital' })
  name!: string;
}

/** A doctor as patients see them in search and on the profile page. */
export class PublicDoctorEntity {
  @ApiProperty({
    example: 4,
    description: 'Doctor profile id (use it for booking).',
  })
  id!: number;

  @ApiProperty({ example: 'Ahmed' })
  firstName!: string;

  @ApiProperty({ example: 'Hassan' })
  lastName!: string;

  @ApiProperty({ example: 'cardiology' })
  specialization!: string;

  @ApiPropertyOptional({ example: 12, nullable: true })
  yearsOfExperience!: number | null;

  @ApiPropertyOptional({ nullable: true })
  bio!: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl!: string | null;

  @ApiPropertyOptional({ type: NamedRefEntity, nullable: true })
  hospital!: NamedRefEntity | null;

  @ApiPropertyOptional({ type: NamedRefEntity, nullable: true })
  department!: NamedRefEntity | null;
}

export class PublicDoctorPageEntity {
  @ApiProperty({ type: [PublicDoctorEntity] })
  items!: PublicDoctorEntity[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}

export class SpecializationListEntity {
  @ApiProperty({ example: ['internal medicine', 'cardiology', 'neurology'] })
  items!: string[];
}

export class DoctorStatusResultEntity {
  @ApiProperty({ example: 4 })
  id!: number;

  @ApiProperty({ enum: ProfileStatus, example: ProfileStatus.SUSPENDED })
  status!: ProfileStatus;

  @ApiProperty({
    example: 3,
    description: 'Future appointments cancelled by a suspension.',
  })
  cancelledAppointments!: number;
}
