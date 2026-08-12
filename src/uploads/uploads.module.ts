import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorageProvider } from './storage/local-disk.storage';
import { R2StorageProvider } from './storage/r2.storage';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController],
  providers: [
    UploadsService,
    {
      // Factory selects the storage strategy from config.
      // Default is local disk — no external account needed.
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('STORAGE_DRIVER', 'local') === 'r2'
          ? new R2StorageProvider(config)
          : new LocalDiskStorageProvider(config),
    },
  ],
  exports: [UploadsService],
})
export class UploadsModule {}
