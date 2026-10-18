/**
 * Sentry Integration
 *
 * Sentry-compatible error reporter that formats events for the Sentry API.
 * Does not import @sentry/node — uses a pluggable transport so consumers
 * can bring their own Sentry SDK or use the built-in HTTP transport.
 */

import type {
  ErrorReporter,
  ErrorReporterOptions,
  ErrorReportEvent,
  UserContext,
} from '../lib/error-reporter';

export interface SentryTransport {
  send(event: SentryEvent): Promise<void>;
}

export interface SentryEvent {
  event_id: string;
  message: string;
  platform?: string;
  level: string;
  timestamp: number;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  exception?: {
    values: Array<{
      type?: string;
      value: string;
      stacktrace?: { frames: Array<{ filename?: string; lineno?: number; colno?: number }> };
    }>;
  };
  user?: UserContext;
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function buildSentryEvent(event: ErrorReportEvent, user: UserContext | null): SentryEvent {
  const sentryEvent: SentryEvent = {
    event_id: uuid(),
    message: event.message,
    platform: 'javascript',
    level: event.level,
    timestamp: Math.floor(event.timestamp / 1000),
    tags: event.tags,
    extra: event.extra,
  };

  if (event.stack || event.name) {
    sentryEvent.exception = {
      values: [
        {
          type: event.name,
          value: event.message,
        },
      ],
    };
  }

  if (user) {
    sentryEvent.user = user;
  }

  return sentryEvent;
}

/**
 * Simple HTTP transport that posts events to a Sentry-compatible DSN endpoint.
 */
export class HttpSentryTransport implements SentryTransport {
  private dsn: string;

  constructor(dsn: string) {
    this.dsn = dsn;
  }

  async send(event: SentryEvent): Promise<void> {
    const url = `${this.dsn}/api/store/`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  }
}

/**
 * Sentry-compatible error reporter.
 */
export class SentryErrorReporter implements ErrorReporter {
  private enabled: boolean;
  private transport: SentryTransport;
  private userContext: UserContext | null = null;
  private extraContext: Record<string, unknown> = {};
  private tags: Record<string, string> = {};
  private beforeSend?: (event: ErrorReportEvent) => ErrorReportEvent | null;
  private environment?: string;
  private release?: string;

  constructor(options: ErrorReporterOptions & { transport: SentryTransport }) {
    this.enabled = options.enabled ?? true;
    this.transport = options.transport;
    this.beforeSend = options.beforeSend;
    this.environment = options.environment;
    this.release = options.release;
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
    this.sendEvent(event);
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
    this.sendEvent(event);
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
    // No pending queue in this implementation
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    this.userContext = null;
    this.extraContext = {};
    this.tags = {};
  }

  private sendEvent(event: ErrorReportEvent): void {
    if (this.beforeSend) {
      const filtered = this.beforeSend(event);
      if (!filtered) return;
      this.transport.send(buildSentryEvent(filtered, this.userContext)).catch(() => {});
    } else {
      this.transport.send(buildSentryEvent(event, this.userContext)).catch(() => {});
    }
  }
}

/**
 * Create a Sentry error reporter.
 */
export function createSentryReporter(
  options: ErrorReporterOptions & { transport: SentryTransport }
): SentryErrorReporter {
  return new SentryErrorReporter(options);
}
