import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FilePurpose } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * multipart/form-data body for POST /uploads.
 * The `file` property exists only for Swagger documentation —
 * the binary itself is handled by the FileInterceptor.
 */
export class UploadFileDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'The file to upload (images or PDF, max 10 MB).',
  })
  file!: unknown;

  @ApiPropertyOptional({
    enum: FilePurpose,
    default: FilePurpose.OTHER,
    example: FilePurpose.MEDICAL_REPORT,
    description: 'What the file is for — used to organize storage.',
  })
  @IsOptional()
  @IsEnum(FilePurpose)
  purpose?: FilePurpose;
}
