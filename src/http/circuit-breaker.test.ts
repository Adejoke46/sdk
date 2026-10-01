import { describe, it, expect, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitState,
} from './circuit-breaker';

describe('CircuitBreaker', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000_000;
  });

  const create = (
    overrides: Partial<ConstructorParameters<typeof CircuitBreaker>[0]> = {},
  ) =>
    new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1_000,
      halfOpenRequests: 1,
      now: clock,
      ...overrides,
    });

  it('starts in the closed state', () => {
    const breaker = create();
    expect(breaker.getState('/api/users')).to.be('closed');
    expect(breaker.canAttempt('/api/users')).to.be(true);
  });

  it('opens after reaching the failure threshold', () => {
    const breaker = create();
    breaker.recordFailure('/api/users');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).to.be('closed');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).to.be('open');
  });

  it('fails fast when open', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    expect(breaker.canAttempt('/api/users')).to.be(false);
    expect(() => breaker.assertCanAttempt('/api/users')).toThrow(CircuitBreakerOpenError);
  });

  it('transitions to half-open after the reset timeout', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    now += 1_000;
    expect(breaker.getState('/api/users')).to.be('half-open');
    expect(breaker.canAttempt('/api/users')).to.be(true);
  });

  it('closes after a successful half-open probe', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    now += 1_000;
    expect(breaker.canAttempt('/api/users')).to.be(true);
    breaker.recordSuccess('/api/users');
    expect(breaker.getState('/api/users')).to.be('closed');
  });

  it('reopens on failure during half-open', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    now += 1_000;
    breaker.canAttempt('/api/users');
    breaker.recordFailure('/api/users');
    expect(breaker.getState('/api/users')).to.be('open');
  });

  it('tracks state per endpoint', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    expect(breaker.getState('/api/users')).to.be('open');
    expect(breaker.getState('/api/creators')).to.be('closed');
    expect(breaker.canAttempt('/api/creators')).to.be(true);
  });

  it('limits half-open in-flight requests', () => {
    const breaker = create({ halfOpenRequests: 1 });
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    now += 1_000;
    expect(breaker.canAttempt('/api/users')).to.be(true);
    expect(breaker.canAttempt('/api/users')).to.be(false);
  });

  it('reports state transitions via callback', () => {
    const transitions: Array<[CircuitState, CircuitState]> = [];
    const breaker = create({
      onStateChange: (from, to) => {
        transitions.push([from, to]);
      },
    });
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    now += 1_000;
    breaker.getState('/api/users');
    breaker.recordSuccess('/api/users');
    expect(transitions).toContainEqual([['closed', 'open']]);
    expect(transitions).toContainEqual([['open', 'half-open']]);
    expect(transitions).toContainEqual([['half-open', 'closed']]);
  });

  it('exposes remaining reset time while open', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    expect(breaker.remainingResetTime('/api/users')).to.be(1_000);
    now += 400;
    expect(breaker.remainingResetTime('/api/users')).to.be(600);
  });

  it('resets a key on demand', () => {
    const breaker = create();
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('/api/users');
    }
    breaker.reset('/api/users');
    expect(breaker.getState('/api/users')).to.be('closed');
    expect(breaker.canAttempt('/api/users')).to.be(true);
  });

  it('returns a snapshot of all tracked keys', () => {
    const breaker = create();
    breaker.recordFailure('/api/users');
    breaker.recordSuccess('/api/creators');
    const statuses = breaker.getStatuses();
    expect(statuses.length).to.be(2);
    const users = statuses.find((s) => s.key === '/api/users');
    const creators = statuses.find((s) => s.key === '/api/creators');
    expect(users?.failures).to.be(1);
    expect(creators?.successes).to.be(1);
  });

  it('validates configuration', () => {
    expect(() => create({ failureThreshold: 0 })).toThrow();
    expect(() => create({ resetTimeout: -1 })).toThrow();
    expect(() => create({ halfOpenRequests: 0 })).toThrow();
  });
});
