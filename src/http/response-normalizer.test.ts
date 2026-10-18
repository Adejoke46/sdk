import { describe, expect, it } from 'vitest';
import { ResponseNormalizer } from './response-normalizer';

describe('ResponseNormalizer', () => {
  it('converts a null API body into a failure response', () => {
    expect(ResponseNormalizer.normalize(null)).toMatchObject({
      success: false,
      error: {
        message: 'Invalid response format',
        code: 'INVALID_RESPONSE',
      },
    });
  });

  describe('extractData', () => {
    it('rejects a successful response with null data', () => {
      expect(() =>
        ResponseNormalizer.extractData({
          success: true,
          data: null,
          timestamp: new Date().toISOString(),
        })
      ).toThrow('No data in response');
    });

    it('rejects a null response with an SDK error', () => {
      expect(() => ResponseNormalizer.extractData(null)).toThrow('Invalid response format');
    });
  });
});
