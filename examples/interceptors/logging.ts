/**
 * Logging interceptor example.
 *
 * Logs every outgoing request and every successful response. Copy the two
 * interceptors into your app, or import them from this file.
 */
import { DorisioClient, type RequestInterceptor, type ResponseInterceptor } from 'dorisio-sdk';

const startedAt = new WeakMap<object, number>();

export const loggingRequestInterceptor: RequestInterceptor = (options) => {
  startedAt.set(options, Date.now());
  const target = options.body ? Object.keys(options.body).join(', ') : '(no body)';
  console.log(`→ ${options.method} [${target}]`);
  return options;
};

export const loggingResponseInterceptor: ResponseInterceptor = <T>(response: T): T => {
  console.log('← response OK');
  return response;
};

export function withLogging(client: DorisioClient): DorisioClient {
  const interceptors = client.getHttpClient().getInterceptors();
  interceptors.addRequestInterceptor(loggingRequestInterceptor);
  interceptors.addResponseInterceptor(loggingResponseInterceptor);
  return client;
}

/* Usage:
 *
 * const client = withLogging(new DorisioClient({ baseUrl: 'https://api.dorisio.com', token }));
 * await client.getCurrentUser();
 */
