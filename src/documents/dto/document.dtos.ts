import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentStatus, DocumentType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateMedicalDocumentDto {
  @ApiProperty({
    example: 1,
    description:
      'Owning patient profile. Patients may omit it (defaults to their own record).',
  })
  @IsOptional()
  @IsInt()
  patientId?: number;

  @ApiProperty({
    example: 5,
    description: 'File id from POST /uploads — the stored document.',
  })
  @IsInt()
  fileId!: number;

  @ApiProperty({ example: 'Discharge summary — Sept 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ enum: DocumentType, default: DocumentType.OTHER })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @ApiPropertyOptional({
    example: 'Issued by SHIFAA Hospital cardiology ward.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateMedicalDocumentDto {
  @ApiPropertyOptional({ example: 'Discharge summary (corrected)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;
}

export class ListMedicalDocumentsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @ApiPropertyOptional({
    enum: DocumentStatus,
    description: 'Defaults to ACTIVE — archived and deleted rows are hidden.',
  })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;
}
