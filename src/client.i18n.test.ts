import { describe, expect, it } from 'vitest';
import { DorisioClient } from './client';

describe('DorisioClient error localization', () => {
  it('localizes validation errors and includes a stable error key', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      i18n: { language: 'es' },
    });

    await expect(client.createTip({ creatorId: 'creator-1', amount: 0 })).rejects.toMatchObject({
      message: 'El importe debe ser mayor que cero.',
      i18n: { key: 'ERR_INVALID_AMOUNT', language: 'es' },
    });
  });

  it('allows custom translations to override the selected language', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      i18n: {
        language: 'es',
        translations: {
          es: { ERR_INVALID_AMOUNT: 'El importe personalizado no es válido.' },
        },
      },
    });

    await expect(client.createTip({ creatorId: 'creator-1', amount: 0 })).rejects.toMatchObject({
      message: 'El importe personalizado no es válido.',
      i18n: { key: 'ERR_INVALID_AMOUNT', language: 'es' },
    });
  });
});