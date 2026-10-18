/**
 * Telemetry Client
 *
 * Collects SDK usage telemetry and analytics data.
 * Tracks method calls, error rates, response times, and environment info.
 * Data is batched to reduce network overhead and can be sampled for large-scale usage.
 */

import { EventBatcher } from './event-batcher';

export type EventType = 'method_call' | 'error' | 'performance' | 'network_failure';

export interface TelemetryEvent {
  type: EventType;
  method?: string;
  timestamp: number;
  duration?: number;
  errorCode?: string;
  errorMessage?: string;
  statusCode?: number;
  responseTime?: number;
  metadata?: Record<string, unknown>;
}

export interface TelemetryConfig {
  enabled: boolean;
  endpoint: string;
  batchInterval: number; // ms
  maxBatchSize?: number;
  sampleRate: number; // 0-1
  environment?: string;
  version?: string;
}

export interface TelemetryEvent {
  type: EventType;
  method?: string;
  timestamp: number;
  duration?: number;
  errorCode?: string;
  errorMessage?: string;
  statusCode?: number;
  responseTime?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Telemetry client for collecting SDK usage metrics
 */
export class TelemetryClient {
  private config: TelemetryConfig;
  private batcher: EventBatcher;
  private sessionId: string;
  private initialized = false;

  constructor(config: TelemetryConfig) {
    this.config = {
      maxBatchSize: 100,
      environment: 'unknown',
      version: '1.0.0',
      ...config,
    };

    this.sessionId = this.generateSessionId();

    // Initialize event batcher
    this.batcher = new EventBatcher({
      endpoint: this.config.endpoint,
      batchInterval: this.config.batchInterval,
      maxBatchSize: this.config.maxBatchSize,
      onSend: (events) => this.sendBatch(events),
    });

    if (this.config.enabled) {
      this.initialized = true;
      this.recordStartupEvent();
    }
  }

  /**
   * Record a method call event
   */
  recordMethodCall(method: string, duration: number, metadata?: Record<string, unknown>): void {
    if (!this.initialized || !this.shouldSample()) return;

    const event: TelemetryEvent = {
      type: 'method_call',
      method,
      timestamp: Date.now(),
      duration,
      metadata,
    };

    this.batcher.addEvent(event);
  }

  /**
   * Record an error event
   */
  recordError(
    errorCode: string,
    errorMessage: string,
    method?: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (!this.initialized) return;

    const event: TelemetryEvent = {
      type: 'error',
      method,
      timestamp: Date.now(),
      errorCode,
      errorMessage,
      metadata: {
        ...metadata,
        sdk_version: this.config.version,
      },
    };

    this.batcher.addEvent(event);
  }

  /**
   * Record a performance metric
   */
  recordPerformance(
    method: string,
    responseTime: number,
    statusCode?: number,
    metadata?: Record<string, unknown>,
  ): void {
    if (!this.initialized || !this.shouldSample()) return;

    const event: TelemetryEvent = {
      type: 'performance',
      method,
      timestamp: Date.now(),
      responseTime,
      statusCode,
      metadata: {
        ...metadata,
        environment: this.config.environment,
      },
    };

    this.batcher.addEvent(event);
  }

  /**
   * Record a network failure event
   */
  recordNetworkFailure(
    method: string,
    statusCode: number,
    error: Error,
    metadata?: Record<string, unknown>,
  ): void {
    if (!this.initialized) return;

    const event: TelemetryEvent = {
      type: 'network_failure',
      method,
      timestamp: Date.now(),
      statusCode,
      errorMessage: error.message,
      metadata: {
        ...metadata,
        error_name: error.name,
      },
    };

    this.batcher.addEvent(event);
  }

  /**
   * Flush pending events immediately
   */
  async flush(): Promise<void> {
    if (!this.initialized) return;
    await this.batcher.flush();
  }

  /**
   * Shutdown telemetry client
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await this.batcher.shutdown();
    this.initialized = false;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Enable telemetry
   */
  enable(): void {
    this.initialized = true;
    this.recordStartupEvent();
  }

  /**
   * Disable telemetry
   */
  disable(): void {
    this.initialized = false;
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.initialized;
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.sampleRate;
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private recordStartupEvent(): void {
    const event: TelemetryEvent = {
      type: 'method_call',
      method: 'sdk_startup',
      timestamp: Date.now(),
      metadata: {
        session_id: this.sessionId,
        sdk_version: this.config.version,
        environment: this.config.environment,
      },
    };

    this.batcher.addEvent(event);
  }

  private async sendBatch(events: TelemetryEvent[]): Promise<void> {
    try {
      const payload = {
        events,
        sessionId: this.sessionId,
        timestamp: Date.now(),
        environment: this.config.environment,
        version: this.config.version,
      };

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `DorisioSDK/${this.config.version}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(
          `Failed to send telemetry batch: ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      // Silently fail telemetry errors to not impact application
      console.debug('Telemetry send error:', error);
    }
  }
}
