import { ApiProperty } from '@nestjs/swagger';
import { FileObject, FilePurpose } from '@prisma/client';

export class FileEntity {
  @ApiProperty({
    example: '7c2e1f4a-9b3d-4e8c-a1f5-6d0b2c9e8a73',
    description: 'File id — reference this from other resources (e.g. avatar).',
  })
  id!: string;

  @ApiProperty({
    example: 'http://localhost:3000/files/avatar/4f9d.../7c2e....png',
    description: 'Public URL of the stored file.',
  })
  url!: string;

  @ApiProperty({ example: 'image/png' })
  mimeType!: string;

  @ApiProperty({ example: 204800, description: 'Size in bytes.' })
  size!: number;

  @ApiProperty({ enum: FilePurpose, example: FilePurpose.AVATAR })
  purpose!: FilePurpose;

  @ApiProperty({ example: '2026-08-12T09:30:00.000Z' })
  createdAt!: Date;

  static fromFile(file: FileObject): FileEntity {
    const { key: _key, ownerId: _ownerId, ...safe } = file;
    return Object.assign(new FileEntity(), safe);
  }
}
