import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { OTP_CHANNELS, OtpChannelId, OtpChannelSet } from '../../providers/ports';
import { AuditService, PG_POOL } from '../audit/audit.service';

export const OTP_POLICY = 'OTP_POLICY';
export interface OtpPolicy {
  /** Channels in the order they are tried, e.g. ['whatsapp', 'sms']. */
  order: Array<'whatsapp' | 'sms'>;
  /** Most paid messages (WhatsApp + SMS) in a rolling 24 hours before sign-in codes stop being sent. */
  dailyCap: number;
  /** Numbers whose code goes to the server log instead of a phone. */
  allowlist: string[];
}

export interface DeliveryResult { channel: OtpChannelId; fellBack: boolean }

const UNAVAILABLE = 'Sign-in codes cannot be sent right now. Try again later.';
/** Keep only short machine codes such as at_status_501; anything else is replaced so no number or code can leak into the table. */
const errorCode = (e: unknown) => (e instanceof Error && /^[a-z0-9_]{1,80}$/.test(e.message) ? e.message : 'send_failed');

/**
 * Gets a sign-in code to a person. Tries the configured channels in order, falls back when one refuses,
 * records what happened (never the phone number or the code), and stops at a daily spending cap.
 */
@Injectable()
export class OtpDeliveryService {
  private log = new Logger('OtpDelivery');
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    @Inject(OTP_CHANNELS) private channels: OtpChannelSet,
    @Inject(AuditService) private audit: AuditService,
    @Inject(OTP_POLICY) private policy: OtpPolicy,
  ) {}

  /** Which channels would be tried for this number, in order. */
  plan(phone: string, preferred?: 'whatsapp' | 'sms'): OtpChannelId[] {
    if (this.policy.allowlist.includes(phone) && this.channels.dev) return ['dev'];
    let order: OtpChannelId[] = this.policy.order.filter((c) => this.channels[c]);
    if (preferred && order.includes(preferred)) order = [preferred, ...order.filter((c) => c !== preferred)];
    return order;
  }

  async capReached(): Promise<boolean> {
    const n = (await this.pool.query(
      `SELECT count(*)::int AS n FROM identity.otp_deliveries
        WHERE channel IN ('whatsapp','sms') AND status='accepted' AND created_at > now() - interval '24 hours'`)).rows[0].n;
    return n >= this.policy.dailyCap;
  }

  async deliver(challengeId: string, phone: string, code: string, ttlMinutes: number, preferred?: 'whatsapp' | 'sms'): Promise<DeliveryResult> {
    const order = this.plan(phone, preferred);
    if (!order.length) { this.log.error('No sign-in channel is available for this request'); throw new ServiceUnavailableException(UNAVAILABLE); }
    if (order[0] !== 'dev' && await this.capReached()) {
      this.log.error(`Daily limit of ${this.policy.dailyCap} sign-in messages reached; codes are not being sent`);
      await this.audit.record({ action: 'auth.otp_cap_reached', subjectType: 'otp_challenge', subjectId: challengeId, metadata: { cap: this.policy.dailyCap } });
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
    let failures = 0;
    for (const name of order) {
      try {
        const r = await this.channels[name]!.send(phone, code, ttlMinutes);
        await this.record(challengeId, name, 'accepted', r.providerMessageId, null);
        return { channel: name, fellBack: failures > 0 };
      } catch (e) {
        failures++;
        const ec = errorCode(e);
        this.log.warn(`Channel ${name} refused a sign-in code: ${ec}`);
        await this.record(challengeId, name, 'failed', null, ec);
      }
    }
    throw new ServiceUnavailableException(UNAVAILABLE);
  }

  private record(challengeId: string, channel: OtpChannelId, status: 'accepted' | 'failed', messageId: string | null, error: string | null) {
    return this.pool.query(
      `INSERT INTO identity.otp_deliveries (challenge_id, channel, status, provider_message_id, error_code) VALUES ($1,$2,$3,$4,$5)`,
      [challengeId, channel, status, messageId, error]);
  }
}
