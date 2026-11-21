import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OtpChannel, SmsPort } from './ports';

/** The code as a plain text message, for SMS. */
export function otpText(code: string, ttlMinutes: number): string {
  return `Your Edupato Homes code is ${code}. It expires in ${ttlMinutes} minutes. Do not share it.`;
}

/** Sends the code as an ordinary SMS through whichever SmsPort is configured. */
export class SmsOtpChannel implements OtpChannel {
  readonly name = 'sms' as const;
  constructor(private sms: SmsPort) {}
  send(to: string, code: string, ttlMinutes: number) { return this.sms.send(to, otpText(code, ttlMinutes)); }
}

/**
 * For a few named test numbers: the code goes to the server log, not to a phone.
 * Anyone who can read the server log can sign in as these numbers, so they must only ever be demo or test accounts.
 */
export class DevLogOtpChannel implements OtpChannel {
  readonly name = 'dev' as const;
  private log = new Logger('DevOtp');
  async send(to: string, code: string, ttlMinutes: number) {
    this.log.warn(`[DEV CODE] ***${to.slice(-3)}: ${otpText(code, ttlMinutes)}`);
    return { providerMessageId: randomUUID() };
  }
}
