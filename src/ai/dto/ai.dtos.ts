import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SymptomDto {
  @ApiProperty({ example: 'headache' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: '3 days' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  duration?: string;

  @ApiPropertyOptional({
    example: 'moderate',
    description: 'mild | moderate | severe (free text accepted)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  severity?: string;
}

export class TriageRequestDto {
  @ApiProperty({
    type: [SymptomDto],
    description: 'What the patient is feeling right now.',
    example: [
      { name: 'headache', duration: '3 days', severity: 'moderate' },
      { name: 'blurry vision', duration: '1 day', severity: 'mild' },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SymptomDto)
  symptoms!: SymptomDto[];

  @ApiPropertyOptional({
    example: 'The pain gets worse with bright light.',
    description: 'Anything else worth mentioning (Arabic or English).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
