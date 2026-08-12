/**
 * Storage abstraction (Strategy pattern).
 *
 * UploadsService depends on this interface only — never on a concrete
 * backend (Dependency Inversion). Swapping local disk for Cloudflare R2,
 * S3, etc. is a configuration change (STORAGE_DRIVER), not a code change
 * (Open/Closed).
 */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StorageProvider {
  /** Persist a binary object under the given key. */
  put(key: string, body: Buffer, mimeType: string): Promise<void>;

  /** Remove an object; must not throw if it is already gone. */
  delete(key: string): Promise<void>;

  /** Public URL where the object can be fetched. */
  publicUrl(key: string): string;
}
