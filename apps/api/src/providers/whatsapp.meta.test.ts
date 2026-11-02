import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { MetaWhatsAppChannel } from './whatsapp.meta';

async function mock(reply: { status?: number; json?: unknown; hang?: boolean }) {
  const seen: { headers: IncomingMessage['headers']; body: any; url: string }[] = [];
  const server: Server = createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(b || '{}'), url: req.url ?? '' });
      if (reply.hang) return;
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.json ?? {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { apiBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => { server.closeAllConnections(); server.close(); } };
}
const cfg = (apiBase: string) => ({ phoneNumberId: '1055', accessToken: 'tok-secret', template: 'zuri_login_code', language: 'en', apiBase, apiVersion: 'v23.0' });

test('WhatsApp: sends the authentication template with the code in the body and the copy-code button', async () => {
  const m = await mock({ json: { messages: [{ id: 'wamid.ABC' }] } });
  try {
    const r = await new MetaWhatsAppChannel(cfg(m.apiBase)).send('+254712345678', '482913', 5);
    assert.equal(r.providerMessageId, 'wamid.ABC');
    const q = m.seen[0];
    assert.equal(q.url, '/v23.0/1055/messages');
    assert.equal(q.headers.authorization, 'Bearer tok-secret');
    assert.equal(q.body.messaging_product, 'whatsapp'); assert.equal(q.body.to, '254712345678'); assert.equal(q.body.type, 'template');
    assert.equal(q.body.template.name, 'zuri_login_code'); assert.equal(q.body.template.language.code, 'en');
    const [body, button] = q.body.template.components;
    assert.equal(body.type, 'body'); assert.equal(body.parameters[0].text, '482913');
    assert.equal(button.type, 'button'); assert.equal(button.sub_type, 'url'); assert.equal(button.index, '0'); assert.equal(button.parameters[0].text, '482913');
  } finally { m.close(); }
});

test('WhatsApp: refusals become short codes that hold no number, code or token', async () => {
  for (const [reply, want] of [
    [{ status: 400, json: { error: { code: 132001, message: 'Template does not exist 254712345678' } } }, /^wa_http_400_132001$/],
    [{ status: 401, json: { error: { code: 190, message: 'Invalid OAuth tok-secret' } } }, /^wa_http_401_190$/],
    [{ status: 200, json: {} }, /^wa_no_message_id$/],
  ] as const) {
    const m = await mock(reply);
    try {
      await assert.rejects(new MetaWhatsAppChannel(cfg(m.apiBase)).send('+254712345678', '482913', 5),
        (e: Error) => want.test(e.message) && !/254712345678|482913|tok-secret/.test(e.message));
    } finally { m.close(); }
  }
});

test('WhatsApp: an unreachable or slow provider fails fast with a short code', async () => {
  await assert.rejects(new MetaWhatsAppChannel(cfg('http://127.0.0.1:1')).send('+254712345678', '482913', 5), /wa_unreachable/);
  const m = await mock({ hang: true });
  try { await assert.rejects(new MetaWhatsAppChannel(cfg(m.apiBase), 200).send('+254712345678', '482913', 5), /wa_unreachable/); }
  finally { m.close(); }
});
