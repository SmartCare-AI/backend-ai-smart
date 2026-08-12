import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

/**
 * Thin wrapper around the Firebase Admin SDK.
 * Used to verify Google / Apple sign-in ID tokens issued by Firebase Auth
 * on the mobile app, then exchange them for our own JWTs.
 */
@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app?: admin.app.App;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    // Private keys pasted into .env files have escaped newlines.
    const privateKey = this.config
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase credentials not set — Google/Apple sign-in is disabled until FIREBASE_* variables are provided.',
      );
      return;
    }

    this.app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    this.logger.log(`Firebase Admin initialized for project "${projectId}"`);
  }

  get isConfigured(): boolean {
    return !!this.app;
  }

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    if (!this.app) {
      throw new ServiceUnavailableException(
        'Social sign-in is not configured on this server yet (missing Firebase credentials).',
      );
    }
    try {
      return await this.app.auth().verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase ID token.');
    }
  }
}
