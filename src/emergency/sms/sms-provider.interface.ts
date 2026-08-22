/**
 * SMS abstraction (Strategy pattern — same shape as StorageProvider).
 *
 * SMS is the last-resort emergency channel: sent ONLY when an SOS push goes
 * unacknowledged. The default NoopSmsProvider logs to the console (zero
 * cost — fine for development and the graduation demo). Adding a real
 * provider (Twilio, Vonage, or a local Egyptian gateway) means one new
 * class + STORAGE-style factory entry; no caller changes.
 */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}
