/**
 * SDK Configuration
 *
 * Handles environment-specific configuration.
 */

export interface SdkConfig {
  apiUrl: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  debug: boolean;
  deduplication: boolean;
  /** Optional fallback hosts used when the primary host fails DNS resolution. */
  fallbackHosts?: string[];
  /** Optional fallback hosts used when the primary host fails DNS resolution. */
  fallbackHosts?: string[];
}

function parseFallbackHosts(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const hosts = value
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return hosts.length > 0 ? hosts : undefined;
}

const DEFAULT_CONFIG: SdkConfig = {
  apiUrl: process.env.DORISIO_API_URL || 'http://localhost:3000',
  timeout: parseInt(process.env.DORISIO_TIMEOUT || '30000', 10),
  retryAttempts: parseInt(process.env.DORISIO_RETRY_ATTEMPTS || '3', 10),
  retryDelay: parseInt(process.env.DORISIO_RETRY_DELAY || '1000', 10),
  debug: process.env.DORISIO_DEBUG === 'true',
  deduplication: process.env.DORISIO_DEBUPLICATION !== 'false',
  fallbackHosts: parseFallbackHosts(process.env.DORISIO_FALLBACK_HOSTS),
  fallbackHosts: parseFallbackHosts(process.env.DORISIO_FALLBACK_HOSTS),
};

let config: SdkConfig = { ...DEFAULT_CONFIG };

/**
 * Get current SDK configuration
 */
export function getConfig(): SdkConfig {
  return { ...config };
}

/**
 * Update SDK configuration
 */
export function setConfig(partialConfig: Partial<SdkConfig>): void {
  config = { ...config, ...partialConfig };
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): void {
  config = { ...DEFAULT_CONFIG };
}
