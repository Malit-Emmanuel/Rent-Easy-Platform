import { AfricasTalkingConfig } from '../config/env';
import { SmsPort } from './ports';

/** Africa's Talking status codes that mean the message was taken: 100 processed, 101 sent, 102 queued. */
const ACCEPTED = new Set([100, 101, 102]);

/**
 * SMS through Africa's Talking (https://api.africastalking.com/version1/messaging, form-encoded, apiKey header).
 * Built from the published API format and tested against a local mock server; it has not yet been run against a real account.
 * Errors carry a short code only: never the phone number, the message text or the API key.
 */
export class AfricasTalkingSms implements SmsPort {
  constructor(private cfg: AfricasTalkingConfig, private timeoutMs = 8000) {}

  async send(to: string, body: string): Promise<{ providerMessageId: string }> {
    const form = new URLSearchParams({ username: this.cfg.username, to, message: body });
    if (this.cfg.senderId) form.set('from', this.cfg.senderId);
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/version1/messaging`, {
        method: 'POST',
        headers: { apiKey: this.cfg.apiKey, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: form, signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch { throw new Error('at_unreachable'); }
    if (!res.ok) throw new Error(`at_http_${res.status}`);
    const json: any = await res.json().catch(() => null);
    const rec = json?.SMSMessageData?.Recipients?.[0];
    if (!rec) throw new Error('at_no_recipient');
    if (!ACCEPTED.has(Number(rec.statusCode))) throw new Error(`at_status_${Number(rec.statusCode) || 'unknown'}`);
    return { providerMessageId: String(rec.messageId ?? '') };
  }
}
