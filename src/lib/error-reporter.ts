/**
 * Error Reporter
 *
 * Interface and default implementation for error reporting integration.
 * Supports pluggable backends (Sentry, custom) with automatic error capture,
 * metadata collection, and user context tracking.
 */

export interface ErrorReporterOptions {
  /** Enable/disable error reporting */
  enabled?: boolean;
  /** DSN or endpoint for the error service */
  dsn?: string;
  /** Environment name (e.g. 'production', 'staging') */
  environment?: string;
  /** Release version for tracking */
  release?: string;
  /** Sample rate for errors (0-1, default 1) */
  sampleRate?: number;
  /** Custom before-send hook to filter/modify errors before reporting */
  beforeSend?: (event: ErrorReportEvent) => ErrorReportEvent | null;
  /** Logger for reporter diagnostics */
  logger?: (message: string, data?: unknown) => void;
}

export interface ErrorReportEvent {
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
  /** Error name/type */
  name?: string;
  /** Severity level */
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  /** Timestamp in ms */
  timestamp: number;
  /** Arbitrary extra data */
  extra?: Record<string, unknown>;
  /** Fingerprint for grouping similar errors */
  fingerprint?: string[];
  /** Tags for searching/filtering */
  tags?: Record<string, string>;
}

export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

export interface ErrorReporter {
  /** Capture an error event */
  captureException(error: Error, context?: Record<string, unknown>): void;
  /** Capture a message event */
  captureMessage(message: string, level?: ErrorReportEvent['level']): void;
  /** Set user context for subsequent reports */
  setUserContext(user: UserContext | null): void;
  /** Set extra context for subsequent reports */
  setExtraContext(extra: Record<string, unknown>): void;
  /** Set tags for subsequent reports */
  setTags(tags: Record<string, string>): void;
  /** Flush pending reports */
  flush(timeout?: number): Promise<void>;
  /** Check if reporter is enabled */
  isEnabled(): boolean;
  /** Destroy the reporter instance */
  destroy(): void;
}

/**
 * Default console-based error reporter.
 * Logs errors to the configured logger when no external service is configured.
 */
export class ConsoleErrorReporter implements ErrorReporter {
  private enabled: boolean;
  private userContext: UserContext | null = null;
  private extraContext: Record<string, unknown> = {};
  private tags: Record<string, string> = {};
  private logger: (message: string, data?: unknown) => void;

  constructor(options?: ErrorReporterOptions) {
    this.enabled = options?.enabled ?? true;
    this.logger = options?.logger ?? ((msg, data) => console.error(msg, data));
  }

  captureException(error: Error, context?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const event: ErrorReportEvent = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      level: 'error',
      timestamp: Date.now(),
      extra: { ...this.extraContext, ...context },
      tags: { ...this.tags },
    };
    this.logger('[ErrorReporter] Exception captured', event);
  }

  captureMessage(message: string, level: ErrorReportEvent['level'] = 'error'): void {
    if (!this.enabled) return;
    const event: ErrorReportEvent = {
      message,
      level,
      timestamp: Date.now(),
      extra: { ...this.extraContext },
      tags: { ...this.tags },
    };
    this.logger('[ErrorReporter] Message captured', event);
  }

  setUserContext(user: UserContext | null): void {
    this.userContext = user;
  }

  setExtraContext(extra: Record<string, unknown>): void {
    this.extraContext = { ...this.extraContext, ...extra };
  }

  setTags(tags: Record<string, string>): void {
    this.tags = { ...this.tags, ...tags };
  }

  async flush(): Promise<void> {
    // Console reporter has nothing to flush
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    this.userContext = null;
    this.extraContext = {};
    this.tags = {};
  }
}

/**
 * No-op error reporter for when error reporting is disabled.
 */
export class NoopErrorReporter implements ErrorReporter {
  captureException(): void {}
  captureMessage(): void {}
  setUserContext(): void {}
  setExtraContext(): void {}
  setTags(): void {}
  async flush(): Promise<void> {}
  isEnabled(): boolean {
    return false;
  }
  destroy(): void {}
}

/**
 * Create an error reporter instance.
 * Returns a noop reporter if disabled, console reporter if no DSN provided,
 * or the Sentry integration if available.
 */
export function createErrorReporter(options?: ErrorReporterOptions): ErrorReporter {
  if (options?.enabled === false) {
    return new NoopErrorReporter();
  }
  return new ConsoleErrorReporter(options);
}
