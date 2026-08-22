import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDoctorProfileDto {
  @ApiProperty({ example: 'EG-MED-123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  licenseNumber!: string;

  @ApiProperty({ example: 'Cardiology' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  specialization!: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  yearsOfExperience?: number;

  @ApiPropertyOptional({ example: 'Consultant cardiologist, Cairo University.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  hospitalId?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  departmentId?: number;
}
