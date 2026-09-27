import { describe, it, expect, vi } from 'vitest';
import { Logger, createLogger, LogEntry } from '../src/lib/logger';

describe('Logger', () => {
  it('should initialize with default log level info', () => {
    const logger = createLogger();
    expect(logger.getLevel()).toBe('info');
  });

  it('should respect log level thresholds', () => {
    const logs: LogEntry[] = [];
    const logger = new Logger({
      level: 'warn',
      handler: (entry) => logs.push(entry),
    });

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(logs.length).toBe(2);
    expect(logs[0].level).toBe('warn');
    expect(logs[0].message).toBe('warn message');
    expect(logs[1].level).toBe('error');
    expect(logs[1].message).toBe('error message');
  });

  it('should support changing log level dynamically', () => {
    const logs: LogEntry[] = [];
    const logger = new Logger({
      level: 'none',
      handler: (entry) => logs.push(entry),
    });

    logger.error('suppressed error');
    expect(logs.length).toBe(0);

    logger.setLevel('debug');
    logger.debug('visible debug');
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe('visible debug');
  });

  it('should create child logger with bound requestId', () => {
    const logs: LogEntry[] = [];
    const parent = new Logger({
      level: 'debug',
      handler: (entry) => logs.push(entry),
    });

    const child = parent.withRequestId('req-12345');
    child.info('child message');

    expect(logs.length).toBe(1);
    expect(logs[0].requestId).toBe('req-12345');
    expect(logs[0].message).toBe('child message');
  });

  it('should allow overriding requestId per log call', () => {
    const logs: LogEntry[] = [];
    const logger = new Logger({
      level: 'debug',
      defaultRequestId: 'default-req',
      handler: (entry) => logs.push(entry),
    });

    logger.info('call with override', { foo: 'bar' }, 'override-req');

    expect(logs.length).toBe(1);
    expect(logs[0].requestId).toBe('override-req');
    expect(logs[0].data).toEqual({ foo: 'bar' });
  });

  it('should format default console output correctly', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = new Logger({ level: 'info', prefix: '[CustomPrefix]' });

    logger.info('test message', { count: 42 }, 'req-999');

    expect(consoleSpy).toHaveBeenCalledWith(
      '[CustomPrefix] [req:req-999] [INFO] test message',
      { count: 42 }
    );

    consoleSpy.mockRestore();
  });
});
