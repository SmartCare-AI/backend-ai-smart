import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FilePurpose } from '@prisma/client';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { FileEntity } from './entities/file.entity';
import {
  STORAGE_PROVIDER,
  StorageProvider,
} from './storage/storage-provider.interface';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Central upload service. Owns validation, key generation, and the
 * FileObject records; the physical storage backend is pluggable
 * (see storage/storage-provider.interface.ts).
 *
 * Other features reference files by their FileObject id — never by
 * raw storage keys.
 */
@Injectable()
export class UploadsService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly prisma: PrismaService,
  ) {}

  async upload(
    file: Express.Multer.File,
    ownerId: string,
    purpose: FilePurpose = FilePurpose.OTHER,
  ): Promise<FileEntity> {
    this.validate(file, purpose);

    const key = `${purpose.toLowerCase()}/${ownerId}/${randomUUID()}${this.safeExtension(file)}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    const record = await this.prisma.fileObject.create({
      data: {
        ownerId,
        key,
        url: this.storage.publicUrl(key),
        mimeType: file.mimetype,
        size: file.size,
        purpose,
      },
    });
    return FileEntity.fromFile(record);
  }

  async findOwned(fileId: string, ownerId: string): Promise<FileEntity> {
    const file = await this.getOwnedOrThrow(fileId, ownerId);
    return FileEntity.fromFile(file);
  }

  async remove(fileId: string, ownerId: string): Promise<void> {
    const file = await this.getOwnedOrThrow(fileId, ownerId);
    await this.storage.delete(file.key);
    await this.prisma.fileObject.delete({ where: { id: file.id } });
  }

  // -------------------------------------------------------------------------

  private async getOwnedOrThrow(fileId: string, ownerId: string) {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
    });
    if (!file) throw new NotFoundException('File not found.');
    if (file.ownerId !== ownerId) {
      throw new ForbiddenException('You do not have access to this file.');
    }
    return file;
  }

  private validate(file: Express.Multer.File, purpose: FilePurpose) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file provided (use the "file" field).');
    }
    if (purpose === FilePurpose.AVATAR) {
      if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
        throw new BadRequestException(
          'Avatar must be an image (jpeg, png, or webp).',
        );
      }
      if (file.size > MAX_AVATAR_SIZE) {
        throw new BadRequestException('Avatar must be 5 MB or smaller.');
      }
      return;
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Allowed: jpeg, png, webp, pdf.`,
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('File must be 10 MB or smaller.');
    }
  }

  /** Extension derived from the validated MIME type, never from user input. */
  private safeExtension(file: Express.Multer.File): string {
    const byMime: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
    };
    return byMime[file.mimetype] ?? extname(file.originalname).toLowerCase();
  }
}
