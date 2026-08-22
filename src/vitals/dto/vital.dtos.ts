import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VitalType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RecordVitalDto {
  @ApiProperty({ enum: VitalType, example: VitalType.HEART_RATE })
  @IsEnum(VitalType)
  type!: VitalType;

  @ApiProperty({ example: 88 })
  @IsNumber()
  value!: number;

  @ApiProperty({ example: 'bpm', description: 'bpm | mg/dL | % | mmHg | °C | kg | hours | steps' })
  @IsString()
  @MaxLength(20)
  unit!: string;

  @ApiPropertyOptional({
    example: '2026-08-22T14:05:00.000Z',
    description: 'When measured (UTC). Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  measuredAt?: string;

  @ApiPropertyOptional({ example: 1, description: 'Paired device id (device sync).' })
  @IsOptional()
  @IsInt()
  deviceId?: number;
}

export class RecordVitalsBatchDto {
  @ApiProperty({ type: [RecordVitalDto], description: 'Up to 100 readings (smartwatch sync).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RecordVitalDto)
  readings!: RecordVitalDto[];
}

export class VitalsSeriesQueryDto {
  @ApiPropertyOptional({ enum: VitalType, example: VitalType.HEART_RATE })
  @IsOptional()
  @IsEnum(VitalType)
  type?: VitalType;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-22T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 500, maximum: 2000, description: 'Max points returned.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  take?: number = 500;
}
