import type { ErrorTranslationKey } from '../../types/i18n';

export const ja: Record<ErrorTranslationKey, string> = {
  ERR_INVALID_AMOUNT: '金額は0より大きくする必要があります。',
  ERR_REQUIRED_FIELD: '必須項目が入力されていません。',
  ERR_INVALID_INPUT: '入力内容が無効です。',
  ERR_AUTHENTICATION_REQUIRED: '認証が必要です。',
  ERR_FORBIDDEN: 'この操作を実行する権限がありません。',
  ERR_NOT_FOUND: '要求されたリソースが見つかりません。',
  ERR_RATE_LIMITED: 'リクエストが多すぎます。しばらくしてから再試行してください。',
  ERR_TIMEOUT: 'リクエストがタイムアウトしました。',
  ERR_NETWORK_ERROR: 'ネットワークエラーが発生しました。',
  ERR_CREATE_TIP_FAILED: 'チップを作成できませんでした。',
  ERR_REQUEST_FAILED: 'リクエストに失敗しました。',
  ERR_UNKNOWN: '予期しないエラーが発生しました。',
};