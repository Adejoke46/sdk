import { describe, expect, it } from 'vitest';
import { localizeError } from './index';
import { ValidationError } from '../types/errors';

describe('localizeError', () => {
  it('translates known SDK errors and attaches their key', () => {
    const error = localizeError(
      new ValidationError('Tip amount must be greater than 0'),
      { language: 'es' }
    );

    expect(error.message).toBe('El importe debe ser mayor que cero.');
    expect(error.i18n).toEqual({
      key: 'ERR_INVALID_AMOUNT',
      language: 'es',
      originalMessage: 'Tip amount must be greater than 0',
    });
  });

  it('uses a custom translation for the selected language', () => {
    const error = localizeError(new ValidationError('Tip amount must be greater than 0'), {
      language: 'es',
      translations: { es: { ERR_INVALID_AMOUNT: 'Importe personalizado.' } },
    });

    expect(error.message).toBe('Importe personalizado.');
    expect(error.i18n?.key).toBe('ERR_INVALID_AMOUNT');
  });
});