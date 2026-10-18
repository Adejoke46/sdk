export type I18nLanguage = 'en' | 'es' | 'fr' | 'de' | 'zh' | 'ja';

export type ErrorTranslationKey =
  | 'ERR_INVALID_AMOUNT'
  | 'ERR_REQUIRED_FIELD'
  | 'ERR_INVALID_INPUT'
  | 'ERR_AUTHENTICATION_REQUIRED'
  | 'ERR_FORBIDDEN'
  | 'ERR_NOT_FOUND'
  | 'ERR_RATE_LIMITED'
  | 'ERR_TIMEOUT'
  | 'ERR_NETWORK_ERROR'
  | 'ERR_CREATE_TIP_FAILED'
  | 'ERR_REQUEST_FAILED'
  | 'ERR_UNKNOWN';

export interface I18nConfig {
  /** Language used for SDK error messages. Defaults to English. */
  language?: I18nLanguage;
  /** Overrides organized by language code, then error key. */
  translations?: Record<string, Record<string, string>>;
}

export interface ErrorI18nMetadata {
  key: string;
  language: I18nLanguage;
  originalMessage?: string;
}