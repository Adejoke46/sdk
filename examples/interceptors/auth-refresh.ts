/**
 * Auth refresh (401) example.
 *
 * Prefer the SDK's built-in single-flight refresher: it retries at most once
 * per rejection, shares one in-flight refresh across concurrent 401s, and never
 * recurses on /auth/login, /auth/register or /auth/refresh.
 */
import { DorisioClient, ApiError } from 'dorisio-sdk';

async function refreshSession(): Promise<{ accessToken: string }> {
  // Replace with your own refresh call (e.g. POST /auth/refresh).
  return { accessToken: 'new-access-token' };
}

export function withAuthRefresh(client: DorisioClient): DorisioClient {
  client.setTokenRefresher(async () => {
    const { accessToken } = await refreshSession();
    client.getHttpClient().setHeader('Authorization', `Bearer ${accessToken}`);
  });

  // Optional: observe rejected sessions for telemetry. The refresh itself is
  // handled by the SDK, so this interceptor only reports.
  client.getHttpClient().getInterceptors().addErrorInterceptor((error) => {
    if (error instanceof ApiError && error.statusCode === 401) {
      console.warn('session rejected; built-in refresher will retry once');
    }
    return error;
  });

  return client;
}
