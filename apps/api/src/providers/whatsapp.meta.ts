import { WhatsAppConfig } from '../config/env';
import { OtpChannel } from './ports';

/**
 * Sign-in codes over the WhatsApp Business Cloud API, using an approved "authentication" template.
 * Meta's template wording is fixed ("<code> is your verification code."); the code goes into the body and into the copy-code button.
 * Works against Meta directly or against a partner that exposes the same API (set WHATSAPP_API_BASE).
 * Built from the published API format and tested against a local mock server; it has not yet been run against a real account.
 * A number that is not on WhatsApp is usually reported by Meta later, not in this response, so the sign-in page also offers "send by SMS instead".
 */
export class MetaWhatsAppChannel implements OtpChannel {
  readonly name = 'whatsapp' as const;
  constructor(private cfg: WhatsAppConfig, private timeoutMs = 8000) {}

  async send(to: string, code: string): Promise<{ providerMessageId: string }> {
    const payload = {
      messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template',
      template: {
        name: this.cfg.template, language: { code: this.cfg.language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    };
    let res: Response;
    try {
      res = await fetch(`${this.cfg.apiBase}/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch { throw new Error('wa_unreachable'); }
    const json: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`wa_http_${res.status}${json?.error?.code ? `_${Number(json.error.code) || 'x'}` : ''}`);
    const id = json?.messages?.[0]?.id;
    if (!id) throw new Error('wa_no_message_id');
    return { providerMessageId: String(id) };
  }
}
