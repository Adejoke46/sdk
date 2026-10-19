import {
  RequestFingerprinter,
  generateFingerprint,
  extractRequestId,
  hashString,
  DEFAULT_FINGERPRINT_TTL_MS,
} from '../../src/http/fingerprinter';
import type { RequestOptions } from '../../src/http/http-client';

describe('Request fingerprinting', () => {
  describe('generateFingerprint', () => {
    it('produces identical fingerprints for equivalent requests', () => {
      const a = generateFingerprint({
        method: 'POST',
        url: '/v1/tips',
        body: { amount: 10, currency: 'USD' },
      });
      const b = generateFingerprint({
        method: 'POST',
        url: '/v1/tips',
        body: { currency: 'USD', amount: 10 },
      });
      expect(a).toEqual(b);
    });

    it('produces different fingerprints for different methods', () => {
      const get = generateFingerprint({ method: 'GET', url: '/v1/tips' });
      const post = generateFingerprint({ method: 'POST', url: '/v1/tips' });
      expect(get).not.toEqual(post);
    });

    it('produces different fingerprints for different URLs', () => {
      const a = generateFingerprint({ method: 'GET', url: '/v1/tips' });
      const b = generateFingerprint({ method: 'GET', url: '/v1/wallets' });
      expect(a).not.toEqual(b);
    });

    it('produces different fingerprints for different bodies', () => {
      const a = generateFingerprint({ method: 'POST', url: '/v1/tips', body: { amount: 10 } });
      const b = generateFingerprint({ method: 'POST', url: '/v1/tips', body: { amount: 20 } });
      expect(a).not.toEqual(b);
    });

    it('uses the request ID when provided', () => {
      const a = generateFingerprint({
        method: 'POST',
        url: '/v1/tips',
        body: { amount: 10 },
        headers: { 'Id-empotency-Key': 'key-123' },
      });
      const b = generateFingerprint({
        method: 'POST',
        url: '/v1/tips',
        body: { amount: 999 },
        headers: { 'id-empotency-key': 'key-123' },
      });
      expect(a).toEqual(b);
      expect(a).toContain('key-123');
    });

    it('treats missing method as GET', () => {
      const a = generateFingerprint({ url: '/v1/tips' });
      const b = generateFingerprint({ method: 'GET', url: '/v1/tips' });
      expect(a).toEqual(b);
    });

    it('produces a stable hash for the same input', () => {
      expect(hashString('hello')).toEqual(hashString('hello'));
      expect(hashString('hello')).not.toEqual(hashString('world'));
    });

    it('extracts request ID from common headers', () => {
      expect(extractRequestId({ headers: { 'X-Request-ID': 'abc' } })).toEqual('abc');
      expect(extractRequestId({ headers: { 'id-empotency-key': 'xyz' } })).toEqual('xyz');
      expect(extractRequestId({ headers: {} })).toBeUndefined();
    });
  });

  describe('RequestFingerprinter', () => {
    it('returns the cached promise for a duplicate request', async () => {
      const fingerprinter = new RequestFingerprinter();
      const request: RequestOptions = { method: 'POST', url: '/v1/tips', body: { amount: 10 } };
      let calls = 0;
      const factory = () => {
        calls += 1;
        return Promise.resolve('ok');
      };

      const first = fingerprinter.execute(request, factory);
      const second = fingerprinter.execute(request, factory);

      expect(first).toBe(second);
      expect(calls).toEqual(1);
      await expect(first).resolves.toEqual('ok');
    });

    it('calls the factory again after TTL expiry', async () => {
      let now = 1000;
      const fingerprinter = new RequestFingerprinter({ ttlMs: 100, nowFn: () => now });
      const request: RequestOptions = { method: 'POST', url: '/v1/tips', body: { amount: 10 } };
      let calls = 0;
      const factory = () => {
        calls += 1;
        return Promise.resolve(calls);
      };

      await fingerprinter.execute(request, factory);
      now += 50;
      await fingerprinter.execute(request, factory);
      expect(calls).toEqual(1);

      now += 100;
      await fingerprinter.execute(request, factory);
      expect(calls).toEqual(2);
    });

    it('cleanup removes expired entries', () => {
      let now = 0;
      const fingerprinter = new RequestFingerprinter({ ttlMs: 50, nowFn: () => now });
      fingerprinter.store('a', Promise.resolve(1));
      now += 100;
      fingerprinter.store('b', Promise.resolve(2));
      expect(fingerprinter.size()).toEqual(2);
      const removed = fingerprinter.cleanup();
      expect(removed).toEqual(1);
      expect(fingerprinter.size()).toEqual(1);
    });

    it('check returns a miss and evicts expired entries', () => {
      let now = 0;
      const fingerprinter = new RequestFingerprinter({ ttlMs: 10, nowFn: () => now });
      fingerprinter.store('x', Promise.resolve(1));
      expect(fingerprinter.check('x').hit).toBeTrue();
      now += 100;
      expect(fingerprinter.check('x').hit).toBeFalse();
      expect(fingerprinter.size()).toEqual(0);
    });

    it('invalidate removes a specific fingerprint', () => {
      const fingerprinter = new RequestFingerprinter();
      fingerprinter.store('a', Promise.resolve(1));
      expect(fingerprinter.invalidate('a')).toBeTrue();
      expect(fingerprinter.invalidate('a')).toBe(false);
    });

    it('enforces the maximum entry limit', () => {
      const fingerprinter = new RequestFingerprinter({ maxEntries: 2 });
      fingerprinter.store('a', Promise.resolve(1));
      fingerprinter.store('b', Promise.resolve(2));
      fingerprinter.store('c', Promise.resolve(3));
      expect(fingerprinter.size()).toEqual(2);
      expect(fingerprinter.check('a').hit).toBeFalse();
      expect(fingerprinter.check('c').hit).toBeTrue();
    });

    it('invokes the onDuplicate callback', () => {
      const duplicates: string[] = [];
      const fingerprinter = new RequestFingerprinter({
        onDuplicate: (fp) => duplicates.push(fp),
      });
      const request: RequestOptions = { method: 'POST', url: '/v1/tips', body: { a: 1 } };
      fingerprinter.execute(request, () => Promise.resolve(1));
      fingerprinter.execute(request, () => Promise.resolve(2));
      expect(duplicates.length).toEqual(1);
    });

    it('exposes the default TTL constant', () => {
      expect(DEFAULT_FINGERPRINT_TTL_MS).toEqual(60 * 1000);
      const fingerprinter = new RequestFingerprinter();
      expect(fingerprinter.getTtlMs()).toEqual(DEFAULT_FINGERPRINT_TTL_MS);
    });

    it('clear removes all entries', () => {
      const fingerprinter = new RequestFingerprinter();
      fingerprinter.store('a', Promise.resolve(1));
      fingerprinter.store('b', Promise.resolve(2));
      fingerprinter.clear();
      expect(fingerprinter.size()).toEqual(0);
    });
  });
});
