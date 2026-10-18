import type { ErrorTranslationKey } from '../../types/i18n';

export const en: Record<ErrorTranslationKey, string> = {
  ERR_INVALID_AMOUNT: 'Amount must be greater than zero.',
  ERR_REQUIRED_FIELD: 'A required field is missing.',
  ERR_INVALID_INPUT: 'The provided input is invalid.',
  ERR_AUTHENTICATION_REQUIRED: 'Authentication is required.',
  ERR_FORBIDDEN: 'You do not have permission to perform this action.',
  ERR_NOT_FOUND: 'The requested resource was not found.',
  ERR_RATE_LIMITED: 'Too many requests. Please try again later.',
  ERR_TIMEOUT: 'The request timed out.',
  ERR_NETWORK_ERROR: 'A network error occurred.',
  ERR_CREATE_TIP_FAILED: 'Failed to create tip.',
  ERR_REQUEST_FAILED: 'The request failed.',
  ERR_UNKNOWN: 'An unexpected error occurred.',
};