import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SocketManager } from '../../src/http/socket-manager';

function openManager(options?: Parameters<typeof SocketManager>[0]) {
  return new SocketManager(options);
}

describe('SocketManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('lifecycle', () => {
    it('registers a socket as open and tracks it in stats', () => {
      const manager = openManager();
      manager.register('s1');

      expect(manager.getState('s1')).toBe('open');
      expect(manager.isOpen('s1')).toBe(true);
      expect(manager.isClosed('s1')).toBe(false);
      expect(manager.getStats()).toMatchObject({
        open: 1,
        closing: 0,
        closed: 0,
        total: 1,
        inFlight: 0,
        registered: 1,
      });
    });

    it('returns undefined for unknown socket ids', () => {
      const manager = openManager();
      expect(manager.getState('missing')).toBeUndefined();
      expect(manager.getSocket('missing')).toBeUndefined();
      expect(manager.isOpen('missing')).toBe(false);
    });

    it('records activity on a known open socket and rejects unknown ids', () => {
      const manager = openManager();
      manager.register('s1');
      expect(manager.recordActivity('s1')).toBe(true);
      expect(manager.recordActivity('missing')).toBe(false);
    });

    it('tracks in-flight work with beginUse and endUse', () => {
      const manager = openManager();
      manager.register('s1');
      expect(manager.beginUse('s1')).toBe(true);
      expect(manager.beginUse('s1')).toBe(true);
      expect(manager.getStats().inFlight).toBe(2);
      expect(manager.endUse('s1')).toBe(true);
      expect(manager.getStats().inFlight).toBe(1);
      expect(manager.endUse('missing')).toBe(false);
    });

    it('transitions open -> closing -> closed on graceful close', async () => {
      const manager = openManager();
      manager.register('s1');
      const closed = manager.close('s1');

      expect(manager.getState('s1')).toBe('closing');
      await closed;
      expect(manager.getState('s1')).toBe('closed');
      expect(manager.isClosed('s1')).toBe(true);
      expect(manager.getStats().closed).toBe(1);
    });

    it('is idempotent: closing an unknown or already closed socket resolves', async () => {
      const manager = openManager();
      await expect(manager.close('missing')).resolves.toBeUndefined();
      manager.register('s1');
      await manager.close('s1');
      await expect(manager.close('s1')).resolves.toBeUndefined();
      expect(manager.getStats().closed).toBe(1);
    });

    it('closes all sockets with closeAll', async () => {
      const manager = openManager();
      manager.register('s1');
      manager.register('s2');
      manager.beginUse('s2');
      manager.endUse('s2');

      await manager.closeAll();

      expect(manager.getState('s1')).toBe('closed');
      expect(manager.getState('s2')).toBe('closed');
      expect(manager.getStats().open).toBe(0);
    });

    it('draining in-flight work completes a graceful close', async () => {
      const manager = openManager();
      manager.register('s1');
      manager.beginUse('s1');

      const closing = manager.close('s1');
      expect(manager.getState('s1')).toBe('closing');

      manager.endUse('s1');
      await closing;
      expect(manager.getState('s1')).toBe('closed');
    });

    it('honors the graceful close timeout instead of hanging', async () => {
      const manager = openManager({ gracefulCloseTimeoutMs: 500 });
      manager.register('s1');
      manager.beginUse('s1');

      const closing = manager.close('s1');
      expect(manager.getState('s1')).toBe('closing');

      vi.advanceTimersByTime(500);
      await Promise.resolve();
      expect(manager.getState('s1')).toBe('closed');
      await closing;
    });

    it('enforces maxSockets when registering new sockets', () => {
      const manager = openManager({ maxSockets: 2 });
      manager.register('s1');
      manager.register('s2');
      expect(() => manager.register('s3')).toThrow(/Maximum socket count/);
    });

    it('removes a socket from tracking', () => {
      const manager = openManager();
      manager.register('s1');
      manager.remove('s1');
      expect(manager.getState('s1')).toBeUndefined();
      expect(manager.getStats().total).toBe(0);
    });

    it('purges only closed sockets', () => {
      const manager = openManager();
      manager.register('s1');
      manager.register('s2');
      manager.register('s3');
      void manager.close('s1');
      manager.purgeClosed();
      expect(manager.getState('s1')).toBeUndefined();
      expect(manager.isOpen('s2')).toBe(true);
      expect(manager.getStats().total).toBe(2);
    });

    it('throws after destroy', async () => {
      const manager = openManager();
      manager.destroy();
      expect(() => manager.register('s1')).toThrow(/destroyed/);
      await expect(manager.close('s1')).rejects.toThrow(/destroyed/);
    });

    it('destroy closes all sockets and clears timers', () => {
      const manager = openManager();
      manager.register('s1');
      manager.register('s2');
      const stateChange = vi.fn();
      manager.onSocketStateChange = stateChange;

      manager.destroy();

      expect(manager.getState('s1')).toBe('closed');
      expect(manager.getStats().total).toBe(0);
      // No timer should fire after destroy.
      vi.advanceTimersByTime(100_000);
      expect(manager.getStats().total).toBe(0);
    });
  });

  describe('idle timeout', () => {
    it('closes an idle socket after the idle timeout', () => {
      const manager = openManager({ idleTimeoutMs: 100 });
      manager.register('s1');

      vi.advanceTimersByTime(100);
      expect(manager.getState('s1')).toBe('closed');
    });

    it('keeps an active socket open past the idle timeout', () => {
      const manager = openManager({ idleTimeoutMs: 100 });
      manager.register('s1');

      vi.advanceTimersByTime(50);
      expect(manager.recordActivity('s1')).toBe(true);
      vi.advanceTimersByTime(100);
      expect(manager.getState('s1')).toBe('open');

      vi.advanceTimersByTime(100);
      expect(manager.getState('s1')).toBe('closed');
    });

    it('does not close a socket while it has in-flight work', () => {
      const manager = openManager({ idleTimeoutMs: 100 });
      manager.register('s1');
      manager.beginUse('s1');

      vi.advanceTimersByTime(1000);
      expect(manager.getState('s1')).toBe('open');

      manager.endUse('s1');
      vi.advanceTimersByTime(100);
      expect(manager.getState('s1')).toBe('closed');
    });

    it('disables idle timeouts when idleTimeoutMs is 0', () => {
      const manager = openManager({ idleTimeoutMs: 0 });
      manager.register('s1');

      vi.advanceTimersByTime(100_000);
      expect(manager.getState('s1')).toBe('open');
    });
  });

  describe('error handling', () => {
    it('closes the socket and reports the error on handleError', async () => {
      const onError = vi.fn();
      const manager = openManager({ onSocketError: onError });
      manager.register('s1');

      const error = new Error('connection reset');
      const handled = manager.handleError('s1', error);

      expect(manager.getState('s1')).toBe('closed');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith('s1', error);
      await handled;
    });

    it('does nothing for handleError on an unknown socket', async () => {
      const onError = vi.fn();
      const manager = openManager({ onSocketError: onError });

      await expect(
        manager.handleError('missing', new Error('x')),
      ).resolves.toBeUndefined();
      expect(onError).not.toHaveBeenCalled();
      expect(manager.getStats().closed).toBe(0);
    });

    it('does nothing for handleError on a manually closed socket', async () => {
      const onError = vi.fn();
      const manager = openManager({ onSocketError: onError });
      manager.register('s1');
      await manager.close('s1');

      await manager.handleError('s1', new Error('boom'));

      expect(onError).not.toHaveBeenCalled();
      expect(manager.getState('s1')).toBe('closed');
    });

    it('reconnects after an unexpected close with backoff', async () => {
      const onReconnect = vi.fn().mockResolvedValue(undefined);
      const stateChange = vi.fn();
      const manager = openManager({
        maxReconnectAttempts: 3,
        reconnectBaseDelayMs: 100,
        onReconnect,
        onSocketStateChange: stateChange,
      });
      manager.register('s1');

      const handled = manager.handleError('s1', new Error('boom'));
      expect(manager.getState('s1')).toBe('closed');
      expect(onReconnect).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      await handled;
      expect(onReconnect).toHaveBeenCalledTimes(1);
      expect(onReconnect).toHaveBeenCalledWith('s1');
      expect(manager.getState('s1')).toBe('open');
      expect(manager.getStats().reconnections).toBe(1);
      expect(stateChange).toHaveBeenCalledWith('s1', 'closed', 'open');
    });

    it('retries reconnect when it fails and stops after maxReconnectAttempts', async () => {
      const onReconnect = vi.fn().mockRejectedValue(new Error('refused'));
      const manager = openManager({
        maxReconnectAttempts: 2,
        reconnectBaseDelayMs: 100,
        onReconnect,
      });
      manager.register('s1');

      const handled = manager.handleError('s1', new Error('boom'));
      expect(manager.getState('s1')).toBe('closed');

      vi.advanceTimersByTime(100);
      await handled;
      expect(onReconnect).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(200);
      await Promise.resolve();
      expect(onReconnect).toHaveBeenCalledTimes(2);
      expect(manager.getState('s1')).toBe('closed');
      expect(manager.getStats().reconnections).toBe(0);
    });

    it('does not reconnect a socket closed manually', async () => {
      const onReconnect = vi.fn().mockResolvedValue(undefined);
      const manager = openManager({
        maxReconnectAttempts: 3,
        reconnectBaseDelayMs: 100,
        onReconnect,
      });
      manager.register('s1');
      await manager.close('s1');

      await manager.handleError('s1', new Error('boom'));
      vi.advanceTimersByTime(10_000);

      expect(onReconnect).not.toHaveBeenCalled();
      expect(manager.getState('s1')).toBe('closed');
    });

    it('allows reconnection after re-registering a closed socket', async () => {
      const onReconnect = vi.fn().mockResolvedValue(undefined);
      const manager = openManager({
        maxReconnectAttempts: 3,
        reconnectBaseDelayMs: 100,
        onReconnect,
      });
      manager.register('s1');
      await manager.handleError('s1', new Error('boom'));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      expect(manager.isOpen('s1')).toBe(true);

      await manager.close('s1');
      manager.register('s1');
      expect(manager.isOpen('s1')).toBe(true);
    });
  });

  describe('state change notifications', () => {
    it('notifies listeners of every transition', () => {
      const onSocketStateChange = vi.fn();
      const manager = openManager({ onSocketStateChange });
      manager.register('s1');
      void manager.close('s1');

      expect(onSocketStateChange).toHaveBeenCalledWith('s1', 'open', 'closing');
      expect(onSocketStateChange).toHaveBeenCalledWith('s1', 'closing', 'closed');
    });

    it('reports current stats after a full lifecycle', () => {
      const manager = openManager({ idleTimeoutMs: 100 });
      manager.register('s1');
      manager.register('s2');
      manager.beginUse('s2');
      manager.endUse('s2');
      vi.advanceTimersByTime(100);

      const stats = manager.getStats();
      expect(stats.closed).toBe(2);
      expect(stats.registered).toBe(2);
    });
  });
});
