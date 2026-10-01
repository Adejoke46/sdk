import type { ErrorTranslationKey } from '../../types/i18n';

export const de: Record<ErrorTranslationKey, string> = {
  ERR_INVALID_AMOUNT: 'Der Betrag muss größer als null sein.',
  ERR_REQUIRED_FIELD: 'Ein Pflichtfeld fehlt.',
  ERR_INVALID_INPUT: 'Die angegebenen Daten sind ungültig.',
  ERR_AUTHENTICATION_REQUIRED: 'Eine Authentifizierung ist erforderlich.',
  ERR_FORBIDDEN: 'Du bist nicht berechtigt, diese Aktion auszuführen.',
  ERR_NOT_FOUND: 'Die angeforderte Ressource wurde nicht gefunden.',
  ERR_RATE_LIMITED: 'Zu viele Anfragen. Bitte versuche es später erneut.',
  ERR_TIMEOUT: 'Die Anfrage hat das Zeitlimit überschritten.',
  ERR_NETWORK_ERROR: 'Ein Netzwerkfehler ist aufgetreten.',
  ERR_CREATE_TIP_FAILED: 'Das Trinkgeld konnte nicht erstellt werden.',
  ERR_REQUEST_FAILED: 'Die Anfrage ist fehlgeschlagen.',
  ERR_UNKNOWN: 'Ein unerwarteter Fehler ist aufgetreten.',
};