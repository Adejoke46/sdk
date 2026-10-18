/**
 * Metrics interceptor example.
 *
 * Counts requests and failures. Error interceptors are awaited (so metrics are
 * recorded) but do not swallow the error.
 *
 * Note: request and response interceptors do not receive a shared handle for
 * the same call, so per-call timing is measured with the `timed` wrapper below
 * rather than inside an interceptor.
 */
import {
  DorisioClient,
  ApiError,
  type RequestInterceptor,
  type ErrorInterceptor,
} from 'dorisio-sdk';

export const metrics = {
  requests: 0,
  errors: 0,
};

export const metricsRequestInterceptor: RequestInterceptor = (options) => {
  metrics.requests += 1;
  return options;
};

export const metricsErrorInterceptor: ErrorInterceptor = (error) => {
  metrics.errors += 1;
  if (error instanceof ApiError) {
    console.warn(`request failed with status ${error.statusCode}`);
  }
  return error;
};

export function withMetrics(client: DorisioClient): DorisioClient {
  const interceptors = client.getHttpClient().getInterceptors();
  interceptors.addRequestInterceptor(metricsRequestInterceptor);
  interceptors.addErrorInterceptor(metricsErrorInterceptor);
  return client;
}

/** Measure one logical operation end-to-end. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`${label} took ${Date.now() - start}ms`);
  }
}

/* Usage:
 *
 * const client = withMetrics(new DorisioClient({ baseUrl: 'https://api.dorisio.com', token }));
 * await timed('getCurrentUser', () => client.getCurrentUser());
 * console.log(metrics.requests, metrics.errors);
 */
