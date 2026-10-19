/**
 * Timeout Manager
 *
 * Manages timeout handling for requests.
 *
 * Provides two timeout tiers:
 *  - `request` – bounds a single request/attempt (tier 1).
 *  - `operation` – bounds the whole operation including retries (tier 2).
 *
 * Operations can degrade gracefully: if partial data is produced before the
 * deadline, it is returned instead of throwing. Consumers receive an
 * `AbortController` they can abort at any time to cancel manually.
 */

import { TimeoutError } from '../types/errors';

export interface TimeoutConfig {
  /** Default timeout applied when none is provided. */
  default: number;
  /** Per-request timeout tier (bounds a single request/attempt). */
  request: number;
  /** Overall operation timeout tier (bounds the whole operation). */
  operation: number;
  min: number;
  max: number;
}

export interface TimeoutOptions {
  /** Per-request timeout in ms. Defaults to `config.request`. */
  requestTimeout?: number;
  /** Overall operation timeout in ms. Defaults to `config.operation`. */
  operationTimeout?: number;
  /**
   * Externally owned abort signal the consumer may abort at any time to cancel
   * the operation manually. When provided, the manager does not create its own
   * controller and will not abort the consumer's signal.
   */
  signal?: AbortSignal;
}

export interface ExecuteResult<T> {
  /** Resolved data (partial when `partial` is true). */
  data: T;
  /** True when the returned data is partial because the deadline elapsed. */
  partial: boolean;
  /** True when the operation hit a deadline. */
  timedOut: boolean;
}

export class TimeoutManager {
  private config: TimeoutConfig;

  constructor(config: Partial<TimeoutConfig> = {}) {
    const defaultTimeout = config.default ?? 30000;
    this.config = {
      default: defaultTimeout,
      request: config.request ?? defaultTimeout,
      operation: config.operation ?? defaultTimeout,
      min: config.min ?? 1000,
      max: config.max ?? 300000,
    };
  }

  /**
   * Validate and normalize timeout value
   */
  normalizeTimeout(timeout?: number): number {
    if (timeout === undefined) {
      return this.config.default;
    }

    if (timeout < this.config.min) {
      return this.config.min;
    }

    if (timeout > this.config.max) {
      return this.config.max;
    }

    return timeout;
  }

  /**
   * Create abort signal with timeout
   */
  createAbortSignal(timeout?: number): AbortSignal {
    const normalizedTimeout = this.normalizeTimeout(timeout);
    return AbortSignal.timeout(normalizedTimeout);
  }

  /**
   * Create a timeout-bound `AbortController` the consumer can abort manually.
   *
   * The controller aborts automatically after `timeout` (normalized against
   * min/max). Aborting manually clears the timer so it cannot fire after the
   * fact. Returns the controller so callers can call `controller.abort()`
   * themselves and read `controller.signal`.
   */
  createController(timeout?: number): AbortController {
    const normalizedTimeout = this.normalizeTimeout(timeout);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), normalizedTimeout);
    controller.signal.addEventListener(
      'abort',
      () => clearTimeout(timer),
      { once: true }
    );
    return controller;
  }

  /**
   * Execute `fn` with a timeout.
   *
   * The timeout exists to bound how long a caller waits, so two things happen:
   * `fn` is handed the `AbortSignal` (so a cooperative operation can cancel its
   * own work) *and* the operation is raced against the deadline (so a caller is
   * not left waiting when the operation ignores the signal). Whichever settles
   * first wins; if the deadline wins, a `TimeoutError` is thrown.
   *
   * The timer is cleared before returning, so an operation that finishes early
   * never leaves a pending abort that would fire after the fact.
   */
  async executeWithTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeout?: number
  ): Promise<T> {
    const normalizedTimeout = this.normalizeTimeout(timeout);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), normalizedTimeout);

    const deadline = new Promise<never>((_, reject) => {
      const onAbort = () =>
        reject(
          new TimeoutError(
            `Request timed out after ${normalizedTimeout}ms`,
            normalizedTimeout
          )
        );

      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      return await Promise.race([fn(controller.signal), deadline]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Execute `fn` with tiered timeouts and graceful degradation.
   *
   * `requestTimeout` bounds each individual request/attempt; `operationTimeout`
   * bounds the whole operation (including retries). Whichever deadline elapses
   * first wins.
   *
   * If `fn` reports partial data via `reportPartial` and then the deadline
   * elapses, the partial data is returned (graceful degradation) instead of
   * throwing, with `partial` and `timedOut` set to `true`. When no partial
   * data is available, a `TimeoutError` is thrown.
   *
   * `fn` receives the `AbortSignal` and a `reportPartial` callback. Passing an
   * external `signal` lets the consumer cancel manually via the owning
   * `AbortController`; cancellation rejects the returned promise.
   */
  async executeWithTieredTimeout<T>(
    fn: (signal: AbortSignal, reportPartial: (data: T) => void) => Promise<T>,
    options: TimeoutOptions = {}
  ): Promise<ExecuteResult<T>> {
    const requestTimeout = this.normalizeTimeout(options.requestTimeout);
    const operationTimeout = this.normalizeTimeout(options.operationTimeout);

    const externalSignal = options.signal;
    const controller = externalSignal ? undefined : new AbortController();
    const signal = externalSignal ?? controller!.signal;

    let timedOut = false;
    let abortSource: 'request' | 'operation' | 'external' | null = null;
    let partialData: T | undefined;
    let settled = false;

    const reportPartial = (data: T) => {
      partialData = data;
    };

    const onSignalAbort = () => {
      if (abortSource === null) {
        abortSource = 'external';
      }
    };
    signal.addEventListener('abort', onSignalAbort, { once: true });

    const settle = () => {
      settled = true;
      clearTimers();
      signal.removeEventListener('abort', onSignalAbort);
    };

    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let operationTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (requestTimer) clearTimeout(requestTimer);
      if (operationTimer) clearTimeout(operationTimer);
    };

    const requestDeadline =
      requestTimeout > 0
        ? new Promise<never>((_, reject) => {
            requestTimer = setTimeout(() => {
              abortSource = 'request';
              timedOut = true;
              if (operationTimer) clearTimeout(operationTimer);
              if (!externalSignal) controller!.abort();
              reject(
                new TimeoutError(
                  `Request timed out after ${requestTimeout}ms`,
                  requestTimeout
                )
              );
            }, requestTimeout);
          })
        : null;

    const operationDeadline =
      operationTimeout > 0
        ? new Promise<never>((_, reject) => {
            operationTimer = setTimeout(() => {
              abortSource = 'operation';
              timedOut = true;
              if (requestTimer) clearTimeout(requestTimer);
              if (!externalSignal) controller!.abort();
              reject(
                new TimeoutError(
                  `Operation timed out after ${operationTimeout}ms`,
                  operationTimeout
                )
              );
            }, operationTimeout);
          })
        : null;

    // Rejects when an externally owned signal is aborted (manual cancellation).
    const externalAborted = externalSignal
      ? new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(newCancelError());
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(newCancelError()),
            { once: true }
          );
        })
      : null;

    // `fn` is wrapped so a rejection that arrives *after* the race has already
    // been won by a deadline or cancellation is swallowed (no unhandled
    // rejection), while a rejection that wins the race still propagates.
    const operation = (async () => {
      try {
        return await fn(signal, reportPartial);
      } catch (error) {
        if (!settled) throw error;
        return undefined as T;
      }
    })();

    try {
      const data = await Promise.race([
        operation,
        requestDeadline,
        operationDeadline,
        externalAborted,
      ].filter((promise): promise is Promise<T> => promise !== null));

      settle();
      return { data, partial: false, timedOut: false };
    } catch (error) {
      settle();
      // A deadline we armed elapsed: treat as a timeout (not cancellation).
      if (abortSource === 'request' || abortSource === 'operation') {
        if (partialData !== undefined) {
          return { data: partialData, partial: true, timedOut: true };
        }
        throw error instanceof TimeoutError
          ? error
          : new TimeoutError('Operation timed out');
      }
      // Manual cancellation or the wrapped function's own error.
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<TimeoutConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<TimeoutConfig>): void {
    const defaultTimeout = config.default ?? this.config.default;
    this.config = {
      default: defaultTimeout,
      request: config.request ?? defaultTimeout,
      operation: config.operation ?? defaultTimeout,
      min: config.min ?? this.config.min,
      max: config.max ?? this.config.max,
    };
  }
}

function newCancelError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
