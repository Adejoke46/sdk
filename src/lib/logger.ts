/**
 * Logger Utility
 *
 * Provides structured logging with request ID tracking, log levels,
 * and customizable log handlers for debugging and tracing SDK operations.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

export interface LogEntry {
  level: LogLevel;
  message: string;
  requestId?: string;
  timestamp: string;
  data?: unknown;
}

export type LogHandler = (entry: LogEntry) => void;

export interface LoggerOptions {
  level?: LogLevel;
  handler?: LogHandler;
  prefix?: string;
  defaultRequestId?: string;
}

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  none: 100,
};

export class Logger {
  private level: LogLevel;
  private handler: LogHandler;
  private prefix: string;
  private requestId?: string;

  constructor(options?: LoggerOptions) {
    this.level = options?.level ?? 'info';
    this.prefix = options?.prefix ?? '[Dorisio]';
    this.requestId = options?.defaultRequestId;
    this.handler = options?.handler ?? this.defaultHandler.bind(this);
  }

  /**
   * Set minimum active log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Set custom log handler callback
   */
  setHandler(handler: LogHandler): void {
    this.handler = handler;
  }

  /**
   * Create a child logger bound to a specific request ID
   */
  withRequestId(requestId: string): Logger {
    return new Logger({
      level: this.level,
      handler: this.handler,
      prefix: this.prefix,
      defaultRequestId: requestId,
    });
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown, requestId?: string): void {
    this.log('debug', message, data, requestId);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: unknown, requestId?: string): void {
    this.log('info', message, data, requestId);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown, requestId?: string): void {
    this.log('warn', message, data, requestId);
  }

  /**
   * Log an error message
   */
  error(message: string, data?: unknown, requestId?: string): void {
    this.log('error', message, data, requestId);
  }

  /**
   * Internal log dispatcher
   */
  private log(level: LogLevel, message: string, data?: unknown, requestId?: string): void {
    if (LOG_LEVEL_PRIORITIES[level] < LOG_LEVEL_PRIORITIES[this.level]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      requestId: requestId ?? this.requestId,
      timestamp: new Date().toISOString(),
      data,
    };

    this.handler(entry);
  }

  /**
   * Default console-based log handler
   */
  private defaultHandler(entry: LogEntry): void {
    const reqTag = entry.requestId ? ` [req:${entry.requestId}]` : '';
    const formattedMessage = `${this.prefix}${reqTag} [${entry.level.toUpperCase()}] ${entry.message}`;

    switch (entry.level) {
      case 'debug':
        console.debug(formattedMessage, entry.data ?? '');
        break;
      case 'info':
        console.info(formattedMessage, entry.data ?? '');
        break;
      case 'warn':
        console.warn(formattedMessage, entry.data ?? '');
        break;
      case 'error':
        console.error(formattedMessage, entry.data ?? '');
        break;
      default:
        break;
    }
  }
}

/**
 * Create a new Logger instance
 */
export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}
