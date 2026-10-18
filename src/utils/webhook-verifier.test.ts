import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWebhookMiddleware, createNextWebhookHandler, createNextApiWebhookHandler } from '../http/webhook-middleware';
import { parseWebhookPayload, verifyWebhookSignature, WebhookEventType } from './webhook-verifier';
import { WebhookPayloadSchema } from './validation-schemas';

const secret = 'test-secret';
const now = 1_700_000_000_000;
const event = { id: 'evt_1', timestamp: now, event: 'tip.confirmed', data: { amount: 1 } };
const body = JSON.stringify(event);
const sign = (raw: string, timestamp: number) => crypto.createHmac('sha256', secret)
  .update(`${timestamp}.${raw}`).digest('hex');

describe('webhook verification', () => {
  describe('valid signature acceptance', () => {
    it('accepts valid HMAC-SHA256 signature with current timestamp', () => {
      const signature = sign(body, now);
      expect(verifyWebhookSignature(body, signature, secret, { timestamp: now, now })).toBe(true);
    });

    it('accepts Buffer payload with timestamp verification', () => {
      const signature = sign(body, now);
      expect(verifyWebhookSignature(Buffer.from(body), signature, secret, { timestamp: now, now })).toBe(true);
    });

    it('accepts Record object payload with timestamp verification', () => {
      const signature = sign(body, now);
      expect(verifyWebhookSignature(event, signature, secret, { timestamp: now, now })).toBe(true);
    });

    it('preserves legacy body-only verification when options omitted', () => {
      const legacySig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(verifyWebhookSignature(body, legacySig, secret)).toBe(true);
      expect(verifyWebhookSignature(Buffer.from(body), legacySig, secret)).toBe(true);
      expect(verifyWebhookSignature(event, legacySig, secret)).toBe(true);
    });
  });

  describe('invalid signature rejection', () => {
    it('rejects incorrect signature', () => {
      const wrongSignature = crypto.createHmac('sha256', 'wrong-secret').update(`${now}.${body}`).digest('hex');
      expect(verifyWebhookSignature(body, wrongSignature, secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects corrupted signature with same length', () => {
      const validSig = sign(body, now);
      const corruptedSig = '0'.repeat(64);
      expect(verifyWebhookSignature(body, corruptedSig, secret, { timestamp: now, now })).toBe(false);
      const flippedOneChar = validSig.startsWith('a') ? 'b' + validSig.slice(1) : 'a' + validSig.slice(1);
      expect(verifyWebhookSignature(body, flippedOneChar, secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects signature when legacy body signature is passed to timestamp verification', () => {
      const legacySig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(verifyWebhookSignature(body, legacySig, secret, { timestamp: now, now })).toBe(false);
    });
  });

  describe('replay attack protection and timestamp windows', () => {
    it('rejects old timestamp (>5 minutes old by default)', () => {
      const oldTime = now - (5 * 60 * 1000 + 1); // 300,001 ms old
      const signature = sign(body, oldTime);
      expect(verifyWebhookSignature(body, signature, secret, { timestamp: oldTime, now })).toBe(false);
    });

    it('accepts timestamp within custom maxAge window', () => {
      const oldTime = now - (10 * 60 * 1000); // 10 minutes old
      const signature = sign(body, oldTime);
      expect(verifyWebhookSignature(body, signature, secret, { timestamp: oldTime, maxAge: 15 * 60 * 1000, now })).toBe(true);
    });

    it('rejects future timestamp exceeding allowed clockSkew', () => {
      const futureTime = now + (5 * 60 * 1000 + 1);
      const signature = sign(body, futureTime);
      expect(verifyWebhookSignature(body, signature, secret, { timestamp: futureTime, now })).toBe(false);
    });

    it('accepts future timestamp within custom clockSkew window', () => {
      const futureTime = now + (10 * 60 * 1000);
      const signature = sign(body, futureTime);
      expect(verifyWebhookSignature(body, signature, secret, { timestamp: futureTime, clockSkew: 15 * 60 * 1000, now })).toBe(true);
    });

    it('uses current Date.now() when options.now is not provided', () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const signature = sign(body, now);
        expect(verifyWebhookSignature(body, signature, secret, { timestamp: now })).toBe(true);
        const oldTime = now - 400_000;
        expect(verifyWebhookSignature(body, sign(body, oldTime), secret, { timestamp: oldTime })).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('payload tampering detection', () => {
    it('rejects payload when even one byte is modified', () => {
      const validSig = sign(body, now);
      const tamperedBody = body.replace('"amount":1', '"amount":2');
      expect(verifyWebhookSignature(tamperedBody, validSig, secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects payload with extra trailing whitespace or character', () => {
      const validSig = sign(body, now);
      expect(verifyWebhookSignature(body + ' ', validSig, secret, { timestamp: now, now })).toBe(false);
      expect(verifyWebhookSignature(body + '\n', validSig, secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects modified event data object', () => {
      const validSig = sign(body, now);
      const tamperedEvent = { ...event, event: 'tip.failed' };
      expect(verifyWebhookSignature(tamperedEvent, validSig, secret, { timestamp: now, now })).toBe(false);
    });
  });

  describe('empty, null, undefined, and malformed signature handling', () => {
    it('rejects empty signature string', () => {
      expect(verifyWebhookSignature(body, '', secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects undefined or null signature', () => {
      expect(verifyWebhookSignature(body, undefined as unknown as string, secret, { timestamp: now, now })).toBe(false);
      expect(verifyWebhookSignature(body, null as unknown as string, secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects non-string signatures', () => {
      expect(verifyWebhookSignature(body, 12345 as unknown as string, secret, { timestamp: now, now })).toBe(false);
      expect(verifyWebhookSignature(body, {} as unknown as string, secret, { timestamp: now, now })).toBe(false);
      expect(verifyWebhookSignature(body, true as unknown as string, secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects empty or missing secret', () => {
      const validSig = sign(body, now);
      expect(verifyWebhookSignature(body, validSig, '', { timestamp: now, now })).toBe(false);
      expect(verifyWebhookSignature(body, validSig, undefined as unknown as string, { timestamp: now, now })).toBe(false);
    });

    it('rejects non-hex characters in 64-char string', () => {
      const nonHex = 'z'.repeat(64);
      expect(verifyWebhookSignature(body, nonHex, secret, { timestamp: now, now })).toBe(false);
    });
  });

  describe('algorithm mismatch handling (SHA-256 vs MD5 / SHA-512 / SHA-1)', () => {
    it('rejects MD5 signature (32 hex characters)', () => {
      const md5Sig = crypto.createHash('md5').update(`${now}.${body}`).digest('hex');
      expect(md5Sig).toHaveLength(32);
      expect(verifyWebhookSignature(body, md5Sig, secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects SHA-1 signature (40 hex characters)', () => {
      const sha1Sig = crypto.createHash('sha1').update(`${now}.${body}`).digest('hex');
      expect(sha1Sig).toHaveLength(40);
      expect(verifyWebhookSignature(body, sha1Sig, secret, { timestamp: now, now })).toBe(false);
    });

    it('rejects SHA-512 signature (128 hex characters)', () => {
      const sha512Sig = crypto.createHash('sha512').update(`${now}.${body}`).digest('hex');
      expect(sha512Sig).toHaveLength(128);
      expect(verifyWebhookSignature(body, sha512Sig, secret, { timestamp: now, now })).toBe(false);
    });
  });

  describe('constant-time comparison prevents timing attacks', () => {
    it('uses crypto.timingSafeEqual for signature comparison', () => {
      const timingSafeSpy = vi.spyOn(crypto, 'timingSafeEqual');
      const validSig = sign(body, now);

      const isValid = verifyWebhookSignature(body, validSig, secret, { timestamp: now, now });
      expect(isValid).toBe(true);
      expect(timingSafeSpy).toHaveBeenCalled();
      const lastCall = timingSafeSpy.mock.calls[timingSafeSpy.mock.calls.length - 1];
      expect(lastCall).toBeDefined();
      if (lastCall) {
        expect(Buffer.isBuffer(lastCall[0])).toBe(true);
        expect(Buffer.isBuffer(lastCall[1])).toBe(true);
        expect((lastCall[0] as Buffer).length).toBe((lastCall[1] as Buffer).length);
      }

      timingSafeSpy.mockRestore();
    });

    it('catches and handles any unexpected errors in verification safely', () => {
      const timingSafeSpy = vi.spyOn(crypto, 'timingSafeEqual').mockImplementation(() => {
        throw new Error('unexpected crypto error');
      });

      const validSig = sign(body, now);
      expect(verifyWebhookSignature(body, validSig, secret, { timestamp: now, now })).toBe(false);

      timingSafeSpy.mockRestore();
    });
  });

  describe('options validation and edge cases', () => {
    it('rejects non-numeric timestamp strings', () => {
      expect(verifyWebhookSignature(body, sign(body, now), secret, { timestamp: 'not-a-number', now })).toBe(false);
      expect(verifyWebhookSignature(body, sign(body, now), secret, { timestamp: '-123', now })).toBe(false);
      expect(verifyWebhookSignature(body, sign(body, now), secret, { timestamp: '0', now })).toBe(false);
    });

    it('rejects unsafe integer timestamps', () => {
      const unsafeTimestamp = Number.MAX_SAFE_INTEGER + 1000;
      expect(verifyWebhookSignature(body, sign(body, now), secret, { timestamp: unsafeTimestamp, now })).toBe(false);
    });

    it('rejects invalid or negative maxAge / clockSkew settings', () => {
      expect(verifyWebhookSignature(body, sign(body, now), secret, { timestamp: now, maxAge: -1, now })).toBe(false);
      expect(verifyWebhookSignature(body, sign(body, now), secret, { timestamp: now, clockSkew: -1, now })).toBe(false);
      expect(verifyWebhookSignature(body, sign(body, now), secret, { timestamp: now, maxAge: NaN, now })).toBe(false);
      expect(verifyWebhookSignature(body, sign(body, now), secret, { timestamp: now, now: NaN })).toBe(false);
    });
  });

  describe('parseWebhookPayload', () => {
    it('validates and parses valid webhook payload structure', () => {
      const parsed = parseWebhookPayload(event);
      expect(parsed).toEqual(event);
    });

    it('throws if payload is null, undefined, or not an object', () => {
      expect(() => parseWebhookPayload(null)).toThrow('Invalid webhook payload: must be an object');
      expect(() => parseWebhookPayload(undefined)).toThrow('Invalid webhook payload: must be an object');
      expect(() => parseWebhookPayload('string')).toThrow('Invalid webhook payload: must be an object');
      expect(() => parseWebhookPayload(12345)).toThrow('Invalid webhook payload: must be an object');
    });

    it('throws if payload is missing or has invalid id', () => {
      expect(() => parseWebhookPayload({ ...event, id: undefined })).toThrow('missing or invalid id');
      expect(() => parseWebhookPayload({ ...event, id: 123 })).toThrow('missing or invalid id');
    });

    it('throws if payload is missing or has invalid timestamp', () => {
      expect(() => parseWebhookPayload({ ...event, timestamp: undefined })).toThrow('missing or invalid timestamp');
      expect(() => parseWebhookPayload({ ...event, timestamp: '2024-01-01' })).toThrow('missing or invalid timestamp');
    });

    it('throws if payload is missing or has invalid event string', () => {
      expect(() => parseWebhookPayload({ ...event, event: undefined })).toThrow('missing or invalid event');
      expect(() => parseWebhookPayload({ ...event, event: 123 })).toThrow('missing or invalid event');
    });

    it('throws if payload is missing or has invalid data object', () => {
      expect(() => parseWebhookPayload({ ...event, data: undefined })).toThrow('missing or invalid data');
      expect(() => parseWebhookPayload({ ...event, data: [] })).toThrow('missing or invalid data');
      expect(() => parseWebhookPayload({ ...event, data: 'string' })).toThrow('missing or invalid data');
    });

    it('throws if payload fails Zod schema validation', () => {
      expect(() => parseWebhookPayload({ ...event, timestamp: 1.5 })).toThrow('malformed fields');
      expect(() => parseWebhookPayload({ ...event, timestamp: -10 })).toThrow('malformed fields');
      expect(() => parseWebhookPayload({ ...event, timestamp: Infinity })).toThrow('malformed fields');
    });

    it('validates payload with WebhookPayloadSchema directly', () => {
      expect(WebhookPayloadSchema.safeParse(event).success).toBe(true);
      expect(WebhookPayloadSchema.safeParse({ ...event, timestamp: -1 }).success).toBe(false);
    });
  });

  describe('WebhookEventType enum values', () => {
    it('defines all required webhook event types', () => {
      expect(WebhookEventType.TIP_CREATED).toBe('tip.created');
      expect(WebhookEventType.TIP_CONFIRMED).toBe('tip.confirmed');
      expect(WebhookEventType.TIP_FAILED).toBe('tip.failed');
      expect(WebhookEventType.PAYMENT_SUCCEEDED).toBe('payment.succeeded');
      expect(WebhookEventType.PAYMENT_FAILED).toBe('payment.failed');
      expect(WebhookEventType.WALLET_VERIFIED).toBe('wallet.verified');
      expect(WebhookEventType.WITHDRAWAL_COMPLETED).toBe('withdrawal.completed');
    });
  });
});

describe('webhook middleware', () => {
  const makeRequest = (raw = body, timestamp = now) => ({
    body: Buffer.from(raw),
    headers: {
      'x-dorisio-signature': sign(raw, timestamp),
      'x-dorisio-timestamp': String(timestamp),
    },
    dorisioWebhook: undefined as undefined | typeof event,
  });

  it('passes a verified Express event to the next handler', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const req = makeRequest();
      const next = vi.fn();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      createWebhookMiddleware({ secret })(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(req.dorisioWebhook).toEqual(event);
      expect(res.status).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('rejects parsed input, expired delivery, malformed JSON and payload timestamp mismatch', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const next = vi.fn();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const middleware = createWebhookMiddleware({ secret });
      middleware({ ...makeRequest(), body: event }, res, next);
      expect(res.status).toHaveBeenLastCalledWith(400);
      middleware(makeRequest('{', now), res, next);
      expect(res.status).toHaveBeenLastCalledWith(401);
      middleware(makeRequest(body, now - 300_001), res, next);
      expect(res.status).toHaveBeenLastCalledWith(401);
      middleware(makeRequest(body, now - 1), res, next);
      expect(res.status).toHaveBeenLastCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('wraps a Next.js App Router handler', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const handler = vi.fn(() => Response.json({ ok: true }));
      const route = createNextWebhookHandler({ secret }, handler);
      const request = (signature: string) => new Request('https://example.com/webhook', {
        method: 'POST', body,
        headers: { 'x-dorisio-signature': signature, 'x-dorisio-timestamp': String(now) },
      });
      expect((await route(request(sign(body, now)))).status).toBe(200);
      expect(handler).toHaveBeenCalledWith(event, expect.any(Request));
      expect((await route(request('0'.repeat(64)))).status).toBe(401);
      expect(handler).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('wraps a Next.js Pages Router stream', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const handler = vi.fn();
      const route = createNextApiWebhookHandler({ secret }, handler);
      const req = {
        headers: { 'x-dorisio-signature': sign(body, now), 'x-dorisio-timestamp': String(now) },
        async *[Symbol.asyncIterator]() { yield Buffer.from(body); },
      };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await route(req, res);
      expect(handler).toHaveBeenCalledWith(event, res);
    } finally { vi.useRealTimers(); }
  });
});
