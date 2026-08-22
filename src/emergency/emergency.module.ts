import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import {
  EmergencyContactsController,
  EmergencyController,
} from './emergency.controller';
import { EmergencyService } from './emergency.service';
import { FirstAidController } from './first-aid.controller';
import { FirstAidService } from './first-aid.service';
import { NoopSmsProvider } from './sms/noop-sms.provider';
import { SMS_PROVIDER } from './sms/sms-provider.interface';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [
    EmergencyController,
    EmergencyContactsController,
    FirstAidController,
  ],
  providers: [
    EmergencyService,
    FirstAidService,
    {
      // Strategy factory — mirrors STORAGE_PROVIDER. Only "noop" ships now
      // (zero cost); a real gateway (e.g. Twilio) is one class + one case.
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('SMS_DRIVER', 'noop');
        if (driver !== 'noop') {
          // Unknown driver: fail soft to noop so emergencies still escalate.
          return new NoopSmsProvider();
        }
        return new NoopSmsProvider();
      },
    },
  ],
  exports: [EmergencyService],
})
export class EmergencyModule {}
