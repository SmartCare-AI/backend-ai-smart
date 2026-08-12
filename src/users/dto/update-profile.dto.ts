import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Omar' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Hassan' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional({
    example: '+201001234567',
    description: 'E.164 format with country code.',
  })
  @IsOptional()
  @IsPhoneNumber(undefined, {
    message: 'phone must be a valid number in E.164 format (e.g. +2010...)',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: '1998-05-14',
    description: 'ISO 8601 date.',
  })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender, example: Gender.MALE })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}
