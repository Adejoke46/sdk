import { describe, it, expect } from 'vitest';
import { RequestSigner } from './request-signer';
import crypto from 'crypto';

describe('RequestSigner', () => {
  it('should sign request with HMAC-SHA256 and include headers', () => {
    const signer = new RequestSigner({ secret: 'test-secret' });
    const headers = { 'Content-Type': 'application/json' };
    const body = { amount: 100 };

    const signedHeaders = signer.signRequest('POST', '/api/v1/tips', headers, body, 1700000000000);

    expect(signedHeaders['X-Timestamp']).toBe('1700000000000');
    expect(signedHeaders['X-Signature']).toBeDefined();
    expect(typeof signedHeaders['X-Signature']).toBe('string');
    expect(signedHeaders['X-Signature']?.length).toBe(64);
    expect(signedHeaders['Content-Type']).toBe('application/json');

    // Verify signature independently
    const canonicalString = `POST\n/api/v1/tips\n1700000000000\n${JSON.stringify(body)}`;
    const expectedSig = crypto.createHmac('sha256', 'test-secret').update(canonicalString).digest('hex');
    expect(signedHeaders['X-Signature']).toBe(expectedSig);
  });

  it('should support key rotation with secret map and X-Key-Id header', () => {
    const signer = new RequestSigner({
      secret: {
        'key-v1': 'secret-1',
        'key-v2': 'secret-2',
      },
      keyId: 'key-v2',
    });

    const signedHeaders = signer.signRequest('GET', '/api/v1/balance', {}, undefined, 1700000000000);

    expect(signedHeaders['X-Key-Id']).toBe('key-v2');
    expect(signedHeaders['X-Timestamp']).toBe('1700000000000');
    expect(signedHeaders['X-Signature']).toBeDefined();

    const canonicalString = `GET\n/api/v1/balance\n1700000000000\n`;
    const expectedSig = crypto.createHmac('sha256', 'secret-2').update(canonicalString).digest('hex');
    expect(signedHeaders['X-Signature']).toBe(expectedSig);

    // Rotate key
    signer.setSecret(
      {
        'key-v1': 'secret-1',
        'key-v2': 'secret-2',
        'key-v3': 'secret-3',
      },
      'key-v3'
    );

    const rotatedHeaders = signer.signRequest('GET', '/api/v1/balance', {}, undefined, 1700000000000);
    expect(rotatedHeaders['X-Key-Id']).toBe('key-v3');
    const expectedRotatedSig = crypto.createHmac('sha256', 'secret-3').update(canonicalString).digest('hex');
    expect(rotatedHeaders['X-Signature']).toBe(expectedRotatedSig);
  });

  it('should throw error when secret is missing', () => {
    expect(() => new RequestSigner({ secret: '' })).toThrow();
  });
});
