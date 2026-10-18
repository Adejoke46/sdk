import type { ErrorTranslationKey } from '../../types/i18n';

export const es: Record<ErrorTranslationKey, string> = {
  ERR_INVALID_AMOUNT: 'El importe debe ser mayor que cero.',
  ERR_REQUIRED_FIELD: 'Falta un campo obligatorio.',
  ERR_INVALID_INPUT: 'Los datos proporcionados no son válidos.',
  ERR_AUTHENTICATION_REQUIRED: 'Se requiere autenticación.',
  ERR_FORBIDDEN: 'No tienes permiso para realizar esta acción.',
  ERR_NOT_FOUND: 'No se encontró el recurso solicitado.',
  ERR_RATE_LIMITED: 'Hay demasiadas solicitudes. Inténtalo de nuevo más tarde.',
  ERR_TIMEOUT: 'La solicitud ha agotado el tiempo de espera.',
  ERR_NETWORK_ERROR: 'Se produjo un error de red.',
  ERR_CREATE_TIP_FAILED: 'No se pudo crear la propina.',
  ERR_REQUEST_FAILED: 'La solicitud ha fallado.',
  ERR_UNKNOWN: 'Se produjo un error inesperado.',
};