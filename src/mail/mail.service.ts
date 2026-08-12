import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASSWORD');
    this.from =
      this.config.get<string>('MAIL_FROM') ?? `SmartCare AI <${user}>`;

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('MAIL_HOST', 'smtp.gmail.com'),
        port: this.config.get<number>('MAIL_PORT', 587),
        secure: this.config.get<string>('MAIL_SECURE', 'false') === 'true',
        auth: { user, pass },
      });
    } else {
      this.logger.warn(
        'MAIL_USER / MAIL_PASSWORD not set — emails will be logged to the console instead of sent.',
      );
    }
  }

  async sendVerificationCode(to: string, name: string, code: string) {
    await this.send(
      to,
      'Verify your SmartCare AI account',
      this.template(
        `Welcome to SmartCare AI, ${name}!`,
        'Use the code below to verify your email address. It expires in 10 minutes.',
        code,
      ),
    );
  }

  async sendPasswordResetCode(to: string, name: string, code: string) {
    await this.send(
      to,
      'Reset your SmartCare AI password',
      this.template(
        `Hello ${name},`,
        'We received a request to reset your password. Use the code below to continue. It expires in 10 minutes. If you did not request this, you can safely ignore this email.',
        code,
      ),
    );
  }

  private async send(to: string, subject: string, html: string) {
    // Dev fallback: no SMTP credentials configured yet.
    if (!this.transporter) {
      this.logger.log(`[DEV MAIL] to=${to} subject="${subject}"`);
      this.logger.log(`[DEV MAIL] body: ${html.replace(/<[^>]+>/g, ' ')}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}`, err as Error);
      throw new ServiceUnavailableException(
        'Could not send email. Please try again later.',
      );
    }
  }

  private template(title: string, message: string, code: string): string {
    return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
  <h2 style="color: #0f766e; margin-top: 0;">SmartCare AI</h2>
  <h3 style="margin-bottom: 8px;">${title}</h3>
  <p style="color: #374151; line-height: 1.6;">${message}</p>
  <div style="background: #f0fdfa; border: 1px dashed #0f766e; border-radius: 8px; text-align: center; padding: 16px; margin: 16px 0;">
    <span style="font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #0f766e;">${code}</span>
  </div>
  <p style="color: #9ca3af; font-size: 12px;">This is an automated message from the SmartCare AI platform — please do not reply.</p>
</div>`;
  }
}
