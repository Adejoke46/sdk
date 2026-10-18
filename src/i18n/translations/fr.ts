import type { ErrorTranslationKey } from '../../types/i18n';

export const fr: Record<ErrorTranslationKey, string> = {
  ERR_INVALID_AMOUNT: 'Le montant doit être supérieur à zéro.',
  ERR_REQUIRED_FIELD: 'Un champ obligatoire est manquant.',
  ERR_INVALID_INPUT: 'Les données fournies ne sont pas valides.',
  ERR_AUTHENTICATION_REQUIRED: "L'authentification est requise.",
  ERR_FORBIDDEN: "Vous n'avez pas l'autorisation d'effectuer cette action.",
  ERR_NOT_FOUND: "La ressource demandée est introuvable.",
  ERR_RATE_LIMITED: 'Trop de requêtes. Veuillez réessayer plus tard.',
  ERR_TIMEOUT: "Le délai d'attente de la requête a expiré.",
  ERR_NETWORK_ERROR: 'Une erreur réseau est survenue.',
  ERR_CREATE_TIP_FAILED: "Impossible de créer le pourboire.",
  ERR_REQUEST_FAILED: "La requête a échoué.",
  ERR_UNKNOWN: 'Une erreur inattendue est survenue.',
};