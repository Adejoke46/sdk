/**
 * Sandbox Mode Client
 *
 * Convenience wrapper that constructs DorisioClient in sandbox mode.
 * Mock routing and request history are handled by HttpClient.
 */

import { DorisioClient, type ClientConfig } from '../client';

export interface SandboxConfig extends Omit<ClientConfig, 'mode'> {
  mode?: 'sandbox';
  /**
   * Simulate network delays (ms). Set to 0 for instant responses.
   */
  latency?: number;
  /**
   * Seed for deterministic mock data. Same seed = same data.
   */
  seed?: number;
  /**
   * Simulate errors randomly (0-1). 0 = no errors, 0.2 = 20% error rate.
   */
  errorRate?: number;
}

/**
 * Sandbox client — all API methods return mocks, no network I/O.
 *
 * @example
 * ```ts
 * const client = new SandboxClient({
 *   baseUrl: 'https://api.dorisio.com',
 *   latency: 50,
 *   seed: 42,
 * });
 *
 * const tip = await client.createTip({
 *   creatorId: 'mock-creator-123',
 *   amount: 50,
 *   message: 'Test tip',
 * });
 *
 * console.log(client.getSandboxHistory());
 * ```
 */
export class SandboxClient extends DorisioClient {
  constructor(config: SandboxConfig) {
    const { latency, seed, errorRate, ...rest } = config;

    super({
      ...rest,
      baseUrl: rest.baseUrl || 'http://sandbox.dorisio.local',
      mode: 'sandbox',
      sandboxSeed: seed,
      sandboxLatency: latency,
      sandboxErrorRate: errorRate,
    });
  }

  /**
   * Set latency for simulating network delays
   */
  setLatency(latency: number): void {
    this.configureSandbox({ latency });
  }

  /**
   * Set error rate for simulating failures (0-1)
   */
  setErrorRate(errorRate: number): void {
    this.configureSandbox({ errorRate });
  }

  /**
   * Set seed for deterministic responses
   */
  setSeed(seed: number): void {
    this.configureSandbox({ seed });
  }

  /**
   * Get current sandbox configuration
   */
  getSandboxConfig() {
    return {
      mode: this.getMode(),
      isSandbox: this.isSandboxMode(),
      historyLength: this.getSandboxHistory().length,
    };
  }
}

/**
 * Create a sandbox client easily
 *
 * @example
 * ```ts
 * import { createSandboxClient } from 'dorisio-sdk/sandbox';
 *
 * const client = createSandboxClient({
 *   latency: 200,
 *   seed: 42,
 * });
 * ```
 */
export function createSandboxClient(config: Partial<SandboxConfig> = {}) {
  return new SandboxClient({
    ...config,
    mode: 'sandbox',
    baseUrl: config.baseUrl || 'http://sandbox.dorisio.local',
  });
}
