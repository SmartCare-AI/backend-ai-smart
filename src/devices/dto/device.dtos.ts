import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { DeviceStatus, DeviceType, VitalType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class RegisterDeviceDto {
  @ApiProperty({ enum: DeviceType, example: DeviceType.SMARTWATCH })
  @IsEnum(DeviceType)
  type!: DeviceType;

  @ApiProperty({ example: 'Galaxy Watch 6' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Samsung' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  manufacturer?: string;

  @ApiPropertyOptional({
    example: 'SM-R960-XY12345',
    description: 'Hardware identifier — unique across the platform.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;
}

export class UpdateDeviceDto extends PartialType(RegisterDeviceDto) {
  @ApiPropertyOptional({ enum: DeviceStatus })
  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;
}

export class DeviceReadingDto {
  @ApiProperty({ enum: VitalType, example: VitalType.HEART_RATE })
  @IsEnum(VitalType)
  type!: VitalType;

  @ApiProperty({ example: 88 })
  @IsNumber()
  value!: number;

  @ApiPropertyOptional({ example: 'bpm' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({
    example: '2026-09-16T14:05:00.000Z',
    description: 'When the device produced the reading (UTC). Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  measuredAt?: string;
}

export class SyncReadingsDto {
  @ApiProperty({
    type: [DeviceReadingDto],
    description: 'Up to 200 raw readings from one sync session.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DeviceReadingDto)
  readings!: DeviceReadingDto[];

  @ApiPropertyOptional({
    default: true,
    description:
      'Also promote each reading into the clinical VitalSign stream (threshold alerts run on those).',
  })
  @IsOptional()
  @Transform(({ value }) => value !== false && value !== 'false')
  @IsBoolean()
  promoteToVitals?: boolean;
}

export class ListReadingsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: VitalType })
  @IsOptional()
  @IsEnum(VitalType)
  type?: VitalType;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-16T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
