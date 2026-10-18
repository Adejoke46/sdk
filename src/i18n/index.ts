import { ERROR_TRANSLATIONS } from './translations';
import type { ErrorI18nMetadata, I18nConfig, I18nLanguage } from '../types/i18n';

type LocalizedError = Error & {
  code?: string;
  statusCode?: number;
  i18n?: ErrorI18nMetadata;
};

function getErrorKey(error: LocalizedError): string {
  if (error.i18n?.key) return error.i18n.key;

  const code = error.code?.startsWith('ERR_') ? error.code : `ERR_${error.code ?? ''}`;
  if (code in ERROR_TRANSLATIONS.en) return code;

  if (error.statusCode === 401 || /unauthori[sz]ed|authentication required/i.test(error.message)) {
    return 'ERR_AUTHENTICATION_REQUIRED';
  }
  if (error.statusCode === 403 || /forbidden|insufficient permissions/i.test(error.message)) {
    return 'ERR_FORBIDDEN';
  }
  if (error.statusCode === 404 || /not found/i.test(error.message)) return 'ERR_NOT_FOUND';
  if (error.statusCode === 429 || /rate.?limit|too many requests/i.test(error.message)) {
    return 'ERR_RATE_LIMITED';
  }
  if (error.statusCode === 408 || /timeout|timed out|aborterror/i.test(error.message)) {
    return 'ERR_TIMEOUT';
  }
  if (/network|fetch failed|offline/i.test(error.message)) return 'ERR_NETWORK_ERROR';
  if (/amount.*(greater than 0|positive|invalid)|invalid.*amount/i.test(error.message)) {
    return 'ERR_INVALID_AMOUNT';
  }
  if (/required/i.test(error.message)) return 'ERR_REQUIRED_FIELD';
  if (/failed to create tip|create tip failed/i.test(error.message)) {
    return 'ERR_CREATE_TIP_FAILED';
  }
  if (error.name === 'ValidationError') return 'ERR_INVALID_INPUT';
  if (/request failed|api error/i.test(error.message)) return 'ERR_REQUEST_FAILED';
  return 'ERR_UNKNOWN';
}

export function localizeError(error: unknown, config?: I18nConfig): LocalizedError {
  const localizedError: LocalizedError =
    error instanceof Error ? (error as LocalizedError) : new Error(String(error));
  const language: I18nLanguage = config?.language ?? 'en';
  const key = getErrorKey(localizedError);
  const fallback = ERROR_TRANSLATIONS[language][key as keyof (typeof ERROR_TRANSLATIONS)['en']];
  const message = config?.translations?.[language]?.[key] ?? fallback ?? ERROR_TRANSLATIONS.en.ERR_UNKNOWN;

  localizedError.i18n = {
    key,
    language,
    originalMessage: localizedError.i18n?.originalMessage ?? localizedError.message,
  };
  localizedError.message = message;
  return localizedError;
}

export { ERROR_TRANSLATIONS } from './translations';