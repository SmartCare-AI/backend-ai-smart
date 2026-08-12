import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { StorageProvider } from './storage-provider.interface';

/**
 * Default storage driver: keeps files on the API server's own disk under
 * UPLOADS_DIR and serves them statically at /files/<key> (see main.ts).
 * Zero external dependencies — ideal for development and single-server
 * deployments.
 */
@Injectable()
export class LocalDiskStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalDiskStorageProvider.name);
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('UPLOADS_DIR', './uploads'));
    const appUrl =
      config.get<string>('APP_URL') ??
      `http://localhost:${config.get<number>('PORT', 3000)}`;
    this.baseUrl = appUrl.replace(/\/$/, '');
    this.logger.log(`Local storage driver active — files in ${this.root}`);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.root, key), { force: true });
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/files/${key}`;
  }
}
