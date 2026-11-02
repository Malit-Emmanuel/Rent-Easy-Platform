import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { AfricasTalkingSms } from './africastalking.sms';

async function mock(handler: (req: IncomingMessage, body: string) => { status?: number; json?: unknown; hang?: boolean }) {
  const seen: { headers: IncomingMessage['headers']; form: URLSearchParams; url: string }[] = [];
  const server: Server = createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ headers: req.headers, form: new URLSearchParams(body), url: req.url ?? '' });
      const r = handler(req, body); if (r.hang) return;
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, seen, close: () => { server.closeAllConnections(); server.close(); } };
}
const ok = (code = 101) => ({ json: { SMSMessageData: { Message: 'Sent', Recipients: [{ statusCode: code, number: '+254712345678', status: 'Success', cost: 'KES 0.8000', messageId: 'ATXid_1' }] } } });

test("Africa's Talking: sends the documented request and returns the message id", async () => {
  const m = await mock(() => ok());
  try {
    const sms = new AfricasTalkingSms({ username: 'zuri', apiKey: 'secret-key', senderId: 'ZURIHOME', baseUrl: m.baseUrl });
    const r = await sms.send('+254712345678', 'hello');
    assert.equal(r.providerMessageId, 'ATXid_1');
    const q = m.seen[0];
    assert.equal(q.url, '/version1/messaging');
    assert.equal(q.headers.apikey, 'secret-key');
    assert.equal(q.form.get('username'), 'zuri'); assert.equal(q.form.get('to'), '+254712345678');
    assert.equal(q.form.get('message'), 'hello'); assert.equal(q.form.get('from'), 'ZURIHOME');
  } finally { m.close(); }
});

test("Africa's Talking: no sender id means no 'from' field", async () => {
  const m = await mock(() => ok(100));
  try {
    await new AfricasTalkingSms({ username: 'sandbox', apiKey: 'k', baseUrl: m.baseUrl }).send('+254712345678', 'x');
    assert.equal(m.seen[0].form.has('from'), false);
  } finally { m.close(); }
});

test("Africa's Talking: refusals become short codes that hold no number, text or key", async () => {
  const cases: [string, ReturnType<typeof ok> | { status: number; json: unknown }, RegExp][] = [
    ['rejected recipient', ok(403), /^at_status_403$/],
    ['bad api key', { status: 401, json: { message: 'The supplied authentication is invalid' } }, /^at_http_401$/],
    ['empty reply', { status: 200, json: {} }, /^at_no_recipient$/],
  ];
  for (const [, reply, want] of cases) {
    const m = await mock(() => reply);
    try {
      await assert.rejects(new AfricasTalkingSms({ username: 'u', apiKey: 'secret-key', baseUrl: m.baseUrl }).send('+254712345678', 'code 123456'),
        (e: Error) => want.test(e.message) && !/254712345678|123456|secret-key/.test(e.message));
    } finally { m.close(); }
  }
});

test("Africa's Talking: an unreachable or slow provider fails fast with a short code", async () => {
  await assert.rejects(new AfricasTalkingSms({ username: 'u', apiKey: 'k', baseUrl: 'http://127.0.0.1:1' }).send('+254712345678', 'x'), /^Error: at_unreachable$/);
  const m = await mock(() => ({ hang: true }));
  try {
    await assert.rejects(new AfricasTalkingSms({ username: 'u', apiKey: 'k', baseUrl: m.baseUrl }, 200).send('+254712345678', 'x'), /at_unreachable/);
  } finally { m.close(); }
});
