/**
 * Failover Manager
 *
 * Manages multiple API endpoints with automatic failover, health checking,
 * and round-robin load balancing.
 */

export interface EndpointConfig {
  url: string;
  weight?: number;
  region?: string;
}

export interface FailoverManagerOptions {
  /** List of API endpoint URLs or configs. */
  endpoints: (string | EndpointConfig)[];
  /** Interval in ms between health checks (default 30000). */
  healthCheckInterval?: number;
  /** Timeout in ms for health check requests (default 5000). */
  healthCheckTimeout?: number;
  /** Max consecutive failures before marking unhealthy (default 3). */
  failureThreshold?: number;
}

interface InternalEndpoint {
  url: string;
  weight: number;
  region?: string;
  healthy: boolean;
  consecutiveFailures: number;
}

export class FailoverManager {
  private endpoints: InternalEndpoint[] = [];
  private currentIndex = 0;
  private healthCheckInterval?: ReturnType<typeof setInterval>;
  private healthCheckTimeout: number;
  private failureThreshold: number;

  constructor(options: FailoverManagerOptions) {
    this.healthCheckTimeout = options.healthCheckTimeout ?? 5000;
    this.failureThreshold = options.failureThreshold ?? 3;

    for (const ep of options.endpoints) {
      const normalized = typeof ep === 'string' ? { url: ep } : ep;
      this.endpoints.push({
        url: normalized.url.replace(/\/$/, ''),
        weight: normalized.weight ?? 1,
        region: normalized.region,
        healthy: true,
        consecutiveFailures: 0,
      });
    }

    if (this.endpoints.length === 0) {
      throw new Error('FailoverManager requires at least one endpoint');
    }

    if (options.healthCheckInterval && this.endpoints.length > 1) {
      this.startHealthChecks(options.healthCheckInterval);
    }
  }

  /** Get the next healthy endpoint (round-robin). */
  getNextEndpoint(): string {
    const start = this.currentIndex;
    const total = this.endpoints.length;

    for (let i = 0; i < total; i++) {
      const idx = (start + i) % total;
      const ep = this.endpoints[idx];
      if (ep && ep.healthy) {
        this.currentIndex = (idx + 1) % total;
        return ep.url;
      }
    }

    // All endpoints unhealthy — reset and return first
    this.endpoints.forEach((ep) => {
      ep.healthy = true;
      ep.consecutiveFailures = 0;
    });
    this.currentIndex = 1 % total;
    const first = this.endpoints[0];
    return first ? first.url : '';
  }

  /** Record a failure for the given endpoint URL. */
  recordFailure(url: string): void {
    const ep = this.endpoints.find((e) => e.url === url);
    if (!ep) return;
    ep.consecutiveFailures++;
    if (ep.consecutiveFailures >= this.failureThreshold) {
      ep.healthy = false;
    }
  }

  /** Reset health status for the given endpoint. */
  recordSuccess(url: string): void {
    const ep = this.endpoints.find((e) => e.url === url);
    if (!ep) return;
    ep.consecutiveFailures = 0;
    ep.healthy = true;
  }

  /** Get all endpoint health statuses. */
  getEndpoints(): ReadonlyArray<{
    url: string;
    healthy: boolean;
    region?: string;
  }> {
    return this.endpoints.map((ep) => ({
      url: ep.url,
      healthy: ep.healthy,
      region: ep.region,
    }));
  }

  /** Get the count of healthy endpoints. */
  getHealthyCount(): number {
    return this.endpoints.filter((ep) => ep.healthy).length;
  }

  private startHealthChecks(interval: number): void {
    this.healthCheckInterval = setInterval(async () => {
      for (const ep of this.endpoints) {
        if (ep.url.startsWith('http')) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.healthCheckTimeout);
            const response = await fetch(`${ep.url}/health`, {
              method: 'GET',
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (response.ok) {
              ep.healthy = true;
              ep.consecutiveFailures = 0;
            }
          } catch {
            ep.consecutiveFailures++;
            if (ep.consecutiveFailures >= this.failureThreshold) {
              ep.healthy = false;
            }
          }
        }
      }
    }, interval);
  }

  /** Stop health checks. */
  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
}
