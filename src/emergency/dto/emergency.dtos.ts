import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EmergencyStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class SosDto {
  @ApiPropertyOptional({ example: 30.0444, description: 'GPS latitude at the moment of the SOS.' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 31.2357 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ example: 'Severe chest pain, cannot breathe well' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class ResolveEmergencyDto {
  @ApiPropertyOptional({
    default: false,
    description: 'true = it was a false alarm (accidental press).',
  })
  @IsOptional()
  @IsBoolean()
  falseAlarm?: boolean;
}

export class ListEmergencyDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EmergencyStatus })
  @IsOptional()
  @IsEnum(EmergencyStatus)
  status?: EmergencyStatus;
}

export class CreateEmergencyContactDto {
  @ApiProperty({ example: 'Mostafa Youssef' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '+201001112223', description: 'E.164 format — receives emergency SMS.' })
  @IsPhoneNumber(undefined, {
    message: 'phone must be a valid number in E.164 format (e.g. +2010...)',
  })
  phone!: string;

  @ApiPropertyOptional({ example: 'brother' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  relationship?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 5, description: 'SMS order: 1 first.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  priority?: number;
}

export class UpdateEmergencyContactDto extends PartialType(CreateEmergencyContactDto) {}

export class CreateFirstAidGuideDto {
  @ApiProperty({ example: 'severe-bleeding', description: 'URL-safe unique id.' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
  @MaxLength(80)
  slug!: string;

  @ApiProperty({ example: 'Severe Bleeding' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title!: string;

  @ApiProperty({ example: 'bleeding', description: 'bleeding | burns | choking | cpr | fractures | ...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category!: string;

  @ApiProperty({ example: '## Severe Bleeding\n1. Call emergency services...', description: 'Markdown.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content!: string;

  @ApiPropertyOptional({ example: 7, description: 'Illustration/video file id (uploads module).' })
  @IsOptional()
  @IsInt()
  mediaFileId?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateFirstAidGuideDto extends PartialType(CreateFirstAidGuideDto) {}
