import { describe, it, expect, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
} from '../../src/http/circuit-breaker';

type State = CircuitState;

describe('CircuitBreaker state machine', () => {
  let now = 0;
  const clock = () => now;

  const create = (
    overrides: Parameters<typeof CircuitBreaker>[0] = {},
  ) =>
    new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1_000,
      halfOpenRequests: 1,
      successThreshold: 1,
      now: clock,
      ...overrides,
    });

  beforeEach(() => {
    now = 1_000_000;
  });

  /* CLOSED state */

  it('starts in the closed state', () => {
    const breaker = create();
    expect(breaker.getState('/api/users')).toBe('closed');
  });

  it('allows attempts while closed', () => {
    const breaker = create();
    expect(breaker.canAttempt('/api/users')).toBe(true);
    expect(breaker.assertCanAttempt('/api/users')).toBeUndefined();
  });

  it('records successes in closed state without opening', () => {
    const breaker = create();
    breaker.recordSuccess('/api/users');
    breaker.recordSuccess('/api/users');
    expect(breaker.getState('/api/users')).toBe('closed');
  });

  it('resets failure counter on success in closed state', () => {
    const breaker = create();
    breaker.recordFailure('/api/users');
    breaker.recordFailure('/api/users');
    breaker.recordSuccess('/api/users');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('closed');
  });

  /* CLOSED -> OPEN */

  it('opens after reaching the failure threshold', () => {
    const breaker = create();
    breaker.recordFailure('/api/users');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('closed');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('open');
  });

  it('respects a custom failure threshold', () => {
    const breaker = create({ failureThreshold: 2 });
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('closed');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('open');
  });

  it('fails fast when open', () => {
    const breaker = create();
    breaker.recordFailure('/api/users');
    breaker.recordFailure('/api/users');
    breaker.recordFailure('/api/users');
    expect(breaker.canAttempt('/api/users')).toBe(false);
    expect(() => breaker.assertCanAttempt('/api/users')).toThrow(CircuitOpenError);
  });

  it('CircuitOpenError carries key and retryAfter', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    let err: unknown;
    try {
      breaker.assertCanAttempt('/api/users');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CircuitOpenError);
    const openErr = err as CircuitOpenError;
    expect(openErr.message).toContain('/api/users');
    expect(openErr.key).toBe('/api/users');
    expect(openErr.retryAfter).toBe(1_000);
  });

  it('exposes current state via getState getter', () => {
    const breaker = create();
    expect(breaker.getState('/api/users')).toBe('closed');
    breaker.recordFailure('/api/users');
    breaker.recordFailure('/api/users');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('open');
  });

  it('tracks state per endpoint independently', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('open');
    expect(breaker.getState('/api/creators')).toBe('closed');
    expect(breaker.canAttempt('/api/creators')).toBe(true);
  });

  /* OPEN -> HALF_OPEN */

  it('transitions to half-open after the reset timeout', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    expect(breaker.getState('/api/users')).toBe('half-open');
    expect(breaker.canAttempt('/api/users')).toBe(true);
  });

  it('does not half-open before the reset timeout elapses', () => {
    const breaker = create({ resetTimeout: 5_000 });
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 4_999;
    expect(breaker.getState('/api/users')).toBe('open');
    expect(breaker.canAttempt('/api/users')).toBe(false);
    now += 1;
    expect(breaker.getState('/api/users')).toBe('half-open');
  });

  it('recovery works after the configured delay', () => {
    const breaker = create({ resetTimeout: 2_000, failureThreshold: 1 });
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('open');
    now += 1_999;
    expect(breaker.getState('/api/users')).toBe('open');
    now += 1;
    expect(breaker.getState('/api/users')).toBe('half-open');
  });

  it('reports OPEN -> HALF_OPEN transition via callback', () => {
    const transitions: Array<[State, State]> = [];
    const breaker = create({
      onStateChange: (from, to) => transitions.push([from, to]),
    });
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    breaker.getState('/api/users');
    expect(transitions).toContainEqual(['closed', 'open']);
    expect(transitions).toContainEqual(['open', 'half-open']);
  });

  /* HALF_OPEN -> CLOSED */

  it('closes after a success in half-open with default threshold', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    breaker.canAttempt('/api/users');
    breaker.recordSuccess('/api/users');
    expect(breaker.getState('/api/users')).toBe('closed');
  });

  it('requires multiple successes when successThreshold > 1', () => {
    const breaker = create({ successThreshold: 2 });
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    breaker.canAttempt('/api/users');
    breaker.recordSuccess('/api/users');
    expect(breaker.getState('/api/users')).toBe('half-open');
    breaker.recordSuccess('/api/users');
    expect(breaker.getState('/api/users')).toBe('closed');
  });

  it('reports HALF_OPEN -> CLOSED transition via callback', () => {
    const transitions: Array<[State, State]> = [];
    const breaker = create({
      onStateChange: (from, to) => transitions.push([from, to]),
    });
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    breaker.canAttempt('/api/users');
    breaker.recordSuccess('/api/users');
    expect(transitions).toContainEqual(['half-open', 'closed']);
  });

  /* HALF_OPEN -> OPEN */

  it('reopens on failure during half-open', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    breaker.canAttempt('/api/users');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('open');
  });

  it('half-open failure reopens with fresh openedAt', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    breaker.canAttempt('/api/users');
    breaker.recordFailure('/api/users');
    const opened = breaker.getStatuses().find((s) => s.key === '/api/users');
    expect(opened?.state).toBe('open');
    expect(opened?.openedAt).toBe(1_001_000);
  });

  /* in-flight limits */

  it('limits half-open in-flight requests', () => {
    const breaker = create({ halfOpenRequests: 1 });
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    expect(breaker.canAttempt('/api/users')).toBe(true);
    expect(breaker.canAttempt('/api/users')).toBe(false);
  });

  it('allows multiple half-open probes when halfOpenRequests > 1', () => {
    const breaker = create({ halfOpenRequests: 2 });
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    now += 1_000;
    expect(breaker.canAttempt('/api/users')).toBe(true);
    expect(breaker.canAttempt('/api/users')).toBe(true);
    expect(breaker.canAttempt('/api/users')).toBe(false);
  });

  /* status snapshots */

  it('exposes statuses for all tracked keys', () => {
    const breaker = create();
    breaker.recordFailure('/api/users');
    breaker.recordSuccess('/api/creators');
    const statuses = breaker.getStatuses();
    expect(statuses.length).toBe(2);
    expect(statuses.find((s) => s.key === '/api/users')?.failures).toBe(1);
    expect(statuses.find((s) => s.key === '/api/creators')?.successes).toBe(1);
  });

  /* reset */

  it('resets a single key to closed', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    breaker.reset('/api/users');
    expect(breaker.getState('/api/users')).toBe('closed');
    expect(breaker.canAttempt('/api/users')).toBe(true);
  });

  it('resets all tracked keys', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    breaker.recordFailure('/api/creators');
    breaker.resetAll();
    expect(breaker.getState('/api/users')).toBe('closed');
    expect(breaker.getState('/api/creators')).toBe('closed');
  });

  /* remaining reset time */

  it('reports remaining reset time while open', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    expect(breaker.remainingResetTime('/api/users')).toBe(1_000);
    now += 400;
    expect(breaker.remainingResetTime('/api/users')).toBe(600);
  });

  it('returns 0 remaining time when not open', () => {
    const breaker = create();
    expect(breaker.remainingResetTime('/api/users')).toBe(0);
  });

  /* configuration validation */

  it('rejects invalid configuration', () => {
    expect(() => create({ failureThreshold: 0 })).toThrow();
    expect(() => create({ resetTimeout: -1 })).toThrow();
    expect(() => create({ halfOpenRequests: 0 })).toThrow();
  });

  /* full cycle */

  it('completes a full closed -> open -> half-open -> closed cycle', () => {
    const breaker = create();
    expect(breaker.getState('/api/users')).toBe('closed');

    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('open');

    now += 1_000;
    expect(breaker.getState('/api/users')).toBe('half-open');

    breaker.canAttempt('/api/users');
    breaker.recordSuccess('/api/users');
    expect(breaker.getState('/api/users')).toBe('closed');
  });

  it('uses injected clock for all time tracking', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).toBe('open');
    expect(breaker.remainingResetTime('/api/users')).toBe(1_000);
    now += 1_000;
    expect(breaker.getState('/api/users')).toBe('half-open');
  });
});
