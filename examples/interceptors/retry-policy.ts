/**
 * Retry policy interceptor example.
 *
 * The SDK already retries idempotent requests. A request interceptor lets you
 * raise the retry budget for safe methods without touching every call site.
 */
import { DorisioClient, type RequestInterceptor } from 'dorisio-sdk';

const IDEMPOTENT_METHODS = ['GET', 'PUT', 'PATCH'];

export const retryPolicyInterceptor: RequestInterceptor = (options) => {
  if (IDEMPOTENT_METHODS.includes(options.method)) {
    options.retries = Math.max(options.retries ?? 0, 5);
  }
  return options;
};

export function withRetryPolicy(client: DorisioClient): DorisioClient {
  client.getHttpClient().getInterceptors().addRequestInterceptor(retryPolicyInterceptor);
  return client;
}

/**
 * Userland retry around a logical operation (rather than a single HTTP
 * request), with exponential backoff.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
    }
  }
  throw lastError;
}
