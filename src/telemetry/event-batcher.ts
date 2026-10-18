/**
 * Event Batcher
 *
 * Batches telemetry events to reduce network overhead.
 * Events are sent when batch reaches max size or interval expires.
 */

import type { TelemetryEvent } from './telemetry-client';

export interface EventBatcherOptions {
  endpoint: string;
  batchInterval: number;
  maxBatchSize?: number;
  onSend: (events: TelemetryEvent[]) => Promise<void>;
}

/**
 * Batches events and sends them at intervals or when batch size is reached
 */
export class EventBatcher {
  private events: TelemetryEvent[] = [];
  private batchInterval: number;
  private maxBatchSize: number;
  private intervalId: NodeJS.Timeout | number | undefined;
  private onSend: (events: TelemetryEvent[]) => Promise<void>;
  private endpoint: string;
  private isSending = false;

  constructor(options: EventBatcherOptions) {
    this.endpoint = options.endpoint;
    this.batchInterval = options.batchInterval;
    this.maxBatchSize = options.maxBatchSize || 100;
    this.onSend = options.onSend;

    // Start batch timer
    this.startBatchTimer();
  }

  /**
   * Add event to batch
   */
  addEvent(event: TelemetryEvent): void {
    this.events.push(event);

    // Send immediately if batch is full
    if (this.events.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Flush pending events
   */
  async flush(): Promise<void> {
    if (this.events.length === 0 || this.isSending) {
      return;
    }

    const eventsToSend = [...this.events];
    this.events = [];

    // Reset timer after flush
    this.stopBatchTimer();
    this.startBatchTimer();

    try {
      this.isSending = true;
      await this.onSend(eventsToSend);
    } catch (error) {
      // Re-add events if send fails
      this.events = [...eventsToSend, ...this.events];
      console.debug('Failed to send batch, events re-queued:', error);
    } finally {
      this.isSending = false;
    }
  }

  /**
   * Shutdown batcher and send remaining events
   */
  async shutdown(): Promise<void> {
    this.stopBatchTimer();
    await this.flush();
  }

  /**
   * Get current batch size
   */
  getBatchSize(): number {
    return this.events.length;
  }

  /**
   * Clear all pending events
   */
  clear(): void {
    this.events = [];
  }

  private startBatchTimer(): void {
    this.intervalId = setInterval(() => {
      this.flush();
    }, this.batchInterval);
  }

  private stopBatchTimer(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId as NodeJS.Timeout);
      this.intervalId = undefined;
    }
  }
}
