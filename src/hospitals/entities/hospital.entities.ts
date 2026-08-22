import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DepartmentEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 1 })
  hospitalId!: number;

  @ApiProperty({ example: 'Cardiology' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Heart care unit' })
  description!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;
}

export class HospitalEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'SmartCare Hospital' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'general' })
  type!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Cairo, Egypt' })
  address!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+20223456789' })
  phone!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'info@smartcare.dev' })
  email!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ type: [DepartmentEntity] })
  departments?: DepartmentEntity[];
}
