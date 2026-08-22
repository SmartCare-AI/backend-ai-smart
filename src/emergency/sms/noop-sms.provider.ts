import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

/** Default driver: logs instead of sending — zero cost, demo-friendly. */
@Injectable()
export class NoopSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  send(to: string, message: string): Promise<void> {
    this.logger.warn(`[DEV SMS] to=${to}: ${message}`);
    return Promise.resolve();
  }
}
