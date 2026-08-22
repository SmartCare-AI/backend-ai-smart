import { Injectable, Logger } from '@nestjs/common';
import { getMessaging } from 'firebase-admin/messaging';
import { FirebaseService } from '../firebase/firebase.service';

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link data for the app, e.g. { screen: "emergency", id: "7" } */
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  /** Tokens FCM reported as dead — caller should revoke them. */
  invalidTokens: string[];
}

/** FCM multicast hard limit per request. */
const FCM_BATCH_SIZE = 500;

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Sends push notifications through Firebase Cloud Messaging (free,
 * unlimited). High priority so messages wake devices in Doze/background —
 * this is how we reach "offline" users the moment they reconnect.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly firebase: FirebaseService) {}

  async sendToTokens(
    tokens: string[],
    payload: PushPayload,
  ): Promise<PushResult> {
    if (tokens.length === 0) return { sent: 0, invalidTokens: [] };

    const app = this.firebase.adminApp;
    if (!app) {
      // Dev fallback mirrors MailService: log instead of send.
      this.logger.log(
        `[DEV PUSH] to ${tokens.length} device(s): "${payload.title}" — ${payload.body}`,
      );
      return { sent: 0, invalidTokens: [] };
    }

    const messaging = getMessaging(app);
    let sent = 0;
    const invalidTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
      const batch = tokens.slice(i, i + FCM_BATCH_SIZE);
      const response = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: { priority: 'high' },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { sound: 'default' } },
        },
      });

      response.responses.forEach((res, idx) => {
        if (res.success) {
          sent++;
        } else if (res.error && INVALID_TOKEN_CODES.has(res.error.code)) {
          invalidTokens.push(batch[idx]);
        } else if (res.error) {
          this.logger.warn(`FCM send failed: ${res.error.code}`);
        }
      });
    }

    return { sent, invalidTokens };
  }
}
