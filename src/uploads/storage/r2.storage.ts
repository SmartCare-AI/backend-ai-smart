import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from './storage-provider.interface';

/**
 * Optional cloud driver: Cloudflare R2 (S3-compatible).
 * Activated with STORAGE_DRIVER=r2 — not used unless selected, so no
 * Cloudflare account is required to run the project.
 */
@Injectable()
export class R2StorageProvider implements StorageProvider {
  private readonly logger = new Logger(R2StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor(config: ConfigService) {
    const accountId = config.getOrThrow<string>('R2_ACCOUNT_ID');
    this.bucket = config.getOrThrow<string>('R2_BUCKET');
    this.publicBaseUrl = config.get<string>('R2_PUBLIC_URL')?.replace(/\/$/, '');
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
    });
    this.logger.log(`R2 storage driver active — bucket "${this.bucket}"`);
  }

  async put(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  publicUrl(key: string): string {
    return this.publicBaseUrl
      ? `${this.publicBaseUrl}/${key}`
      : `r2://${this.bucket}/${key}`;
  }
}
