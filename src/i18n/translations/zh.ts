import type { ErrorTranslationKey } from '../../types/i18n';

export const zh: Record<ErrorTranslationKey, string> = {
  ERR_INVALID_AMOUNT: '金额必须大于零。',
  ERR_REQUIRED_FIELD: '缺少必填字段。',
  ERR_INVALID_INPUT: '提供的数据无效。',
  ERR_AUTHENTICATION_REQUIRED: '需要进行身份验证。',
  ERR_FORBIDDEN: '你没有权限执行此操作。',
  ERR_NOT_FOUND: '未找到请求的资源。',
  ERR_RATE_LIMITED: '请求过多，请稍后重试。',
  ERR_TIMEOUT: '请求超时。',
  ERR_NETWORK_ERROR: '发生网络错误。',
  ERR_CREATE_TIP_FAILED: '无法创建打赏。',
  ERR_REQUEST_FAILED: '请求失败。',
  ERR_UNKNOWN: '发生意外错误。',
};