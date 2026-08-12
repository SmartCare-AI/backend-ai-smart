import { ApiProperty } from '@nestjs/swagger';

/**
 * multipart/form-data body for PUT /users/me/avatar — Swagger documentation
 * only; the binary is handled by the FileInterceptor.
 */
export class UploadAvatarDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Avatar image (jpeg, png, or webp — max 5 MB).',
  })
  file!: unknown;
}
