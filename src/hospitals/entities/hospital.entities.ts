import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityStatus, HospitalType } from '@prisma/client';

/** ERD #6 Department. */
export class DepartmentEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 1 })
  hospitalId!: number;

  @ApiProperty({ example: 'Cardiology' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Heart care unit' })
  description!: string | null;

  @ApiProperty({ enum: EntityStatus, example: EntityStatus.ACTIVE })
  status!: EntityStatus;
}

/** ERD #5 Hospital. */
export class HospitalEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'SHIFAA Hospital' })
  name!: string;

  @ApiProperty({ enum: HospitalType, example: HospitalType.GENERAL })
  type!: HospitalType;

  @ApiProperty({ example: 'Cairo, Egypt' })
  address!: string;

  @ApiPropertyOptional({ nullable: true, example: '+20223456789' })
  phone!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'info@shifaa.dev' })
  email!: string | null;

  @ApiProperty({ enum: EntityStatus, example: EntityStatus.ACTIVE })
  status!: EntityStatus;

  @ApiPropertyOptional({ type: [DepartmentEntity] })
  departments?: DepartmentEntity[];
}
