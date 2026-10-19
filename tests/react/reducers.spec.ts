/**
 * useCreateTip reducer tests
 *
 * Verifies every documented state transition of `tipFormReducer` in isolation.
 * The reducer is pure, so these tests exercise state transitions without rendering
 * any component or mocking the API client.
 */

import { describe, it, expect } from 'vitest';
import {
  tipFormReducer,
  initialTipFormState,
  type TipFormState,
  type TipFormStep,
} from '../../src/react/useCreateTip.reducer';

const makeTip = (id = 'tip-1'): TransactionLike => ({ id } as TransactionLike);

type TransactionLike = { id: string };

function stepOf(state: TipFormState): TipFormStep {
  return state.step;
}

describe('tipFormReducer - initial state', () => {
  it('returns the documented initial state', () => {
    expect(tipFormReducer(undefined as any, { type: 'RESET' })).toEqual(initialTipFormState);
    expect(initialTipFormState.loading).toBe(false);
    expect(initialTipFormState.submitting).toBe(false);
    expect(initialTipFormState.step).toBe('idle');
    expect(initialTipFormState.data).toBeUndefined();
    expect(initialTipFormState.error).toBeUndefined();
  });
});

describe('tipFormReducer - START action', () => {
  it('advances to creating and sets loading/submitting while clearing error', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      error: 'boom',
      step: 'error',
    };
    const next = tipFormReducer(state, { type: 'START', step: 'creating' });

    expect(next.step).toBe('creating');
    expect(next.loading).toBe(true);
    expect(next.submitting).toBe(true);
    expect(next.error).toBeUndefined();
  });

  it('advances to building from a clean idle state', () => {
    const next = tipFormReducer(initialTipFormState, { type: 'START', step: 'building' });

    expect(next.step).toBe('building');
    expect(next.loading).toBe(true);
    expect(next.submitting).toBe(true);
  });

  it('advances to submitting from a clean idle state', () => {
    const next = tipFormReducer(initialTipFormState, { type: 'START', step: 'submitting' });

    expect(next.step).toBe('submitting');
    expect(next.loading).toBe(true);
    expect(next.submitting).toBe(true);
  });

  it('advances to confirming from a clean idle state', () => {
    const next = tipFormReducer(initialTipFormState, { type: 'START', step: 'confirming' });

    expect(next.step).toBe('confirming');
    expect(next.loading).toBe(true);
    expect(next.submitting).toBe(true);
  });
});

describe('tipFormReducer - FAIL action', () => {
  it('records the error, steps to error, and clears loading/submitting', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      loading: true,
      submitting: true,
      step: 'submitting',
    };
    const next = tipFormReducer(state, { type: 'FAIL', error: 'network down' });

    expect(next.error).toBe('network down');
    expect(next.step).toBe('error');
    expect(next.loading).toBe(false);
    expect(next.submitting).toBe(false);
  });

  it('clears in-flight loading when failing from creating', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      loading: true,
      submitting: true,
      step: 'creating',
    };
    const next = tipFormReducer(state, { type: 'FAIL', error: 'Failed to create tip' });

    expect(next.loading).toBe(false);
    expect(next.submitting).toBe(false);
    expect(next.step).toBe('error');
    expect(next.error).toBe('Failed to create tip');
  });
});

describe('tipFormReducer - COMPLETE action', () => {
  it('completes createTip with data and returns to idle', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      loading: true,
      submitting: true,
      step: 'creating',
    };
    const next = tipFormReducer(state, { type: 'COMPLETE', data: makeTip(), step: 'idle' });

    expect(next.data).toEqual(makeTip());
    expect(next.step).toBe('idle');
    expect(next.loading).toBe(false);
    expect(next.submitting).toBe(false);
  });

  it('completes confirmTransaction with data and steps to success', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      loading: true,
      submitting: true,
      step: 'confirming',
    };
    const next = tipFormReducer(state, { type: 'COMPLETE', data: makeTip(), step: 'success' });

    expect(next.data).toEqual(makeTip());
    expect(next.step).toBe('success');
    expect(next.loading).toBe(false);
    expect(next.submitting).toBe(false);
  });

  it('completes buildTransaction without data while preserving existing data', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      data: makeTip('tip-1'),
      loading: true,
      submitting: true,
      step: 'building',
    };
    const next = tipFormReducer(state, { type: 'COMPLETE', step: 'idle' });

    expect(next.data).toEqual(makeTip('tip-1'));
    expect(next.step).toBe('idle');
    expect(next.loading).toBe(false);
    expect(next.submitting).toBe(false);
  });

  it('completes submitTransaction without data while preserving existing data', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      data: makeTip('tip-1'),
      loading: true,
      submitting: true,
      step: 'submitting',
    };
    const next = tipFormReducer(state, { type: 'COMPLETE', step: 'idle' });

    expect(next.data).toEqual(makeTip('tip-1'));
    expect(next.step).toBe('idle');
    expect(next.loading).toBe(false);
    expect(next.submitting).toBe(false);
  });
});

describe('tipFormReducer - RESET action', () => {
  it('clears loading/submitting and steps to idle while preserving data', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      data: makeTip('tip-1'),
      loading: true,
      submitting: true,
      step: 'success',
    };
    const next = tipFormReducer(state, { type: 'RESET' });

    expect(next.data).toEqual(makeTip('tip-1'));
    expect(next.loading).toBe(false);
    expect(next.submitting).toBe(false);
    expect(next.step).toBe('idle');
  });

  it('clears loading/submitting and steps to idle while preserving error', () => {
    const state: TipFormState = {
      ...initialTipFormState,
      error: 'network down',
      loading: true,
      submitting: true,
      step: 'error',
    };
    const next = tipFormReducer(state, { type: 'RESET' });

    expect(next.error).toBe('network down');
    expect(next.loading).toBe(false);
    expect(next.submitting).toBe(false);
    expect(next.step).toBe('idle');
  });

  it('returns the initial state when resetting from idle', () => {
    const next = tipFormReducer(initialTipFormState, { type: 'RESET' });
    expect(next).toEqual(initialTipFormState);
  });
});

describe('tipFormReducer - full lifecycle sequences', () => {
  it('createTip happy path: idle -> creating -> idle with data', () => {
    const started = tipFormReducer(initialTipFormState, { type: 'START', step: 'creating' });
    expect(stepOf(started)).toBe('creating');
    expect(started.loading).toBe(true);

    const completed = tipFormReducer(started, {
      type: 'COMPLETE',
      data: makeTip(),
      step: 'idle',
    });
    expect(completed.step).toBe('idle');
    expect(completed.loading).toBe(false);
    expect(completed.data).toEqual(makeTip());
  });

  it('createTip failure path: idle -> creating -> error, then reset clears loading', () => {
    const started = tipFormReducer(initialTipFormState, { type: 'START', step: 'creating' });
    expect(stepOf(started)).toBe('creating');

    const failed = tipFormReducer(started, { type: 'FAIL', error: 'Failed to create tip' });
    expect(failed.step).toBe('error');
    expect(failed.error).toBe('Failed to create tip');
    expect(failed.loading).toBe(false);
    expect(failed.submitting).toBe(false);

    const reset = tipFormReducer(failed, { type: 'RESET' });
    expect(reset.step).toBe('idle');
    expect(reset.loading).toBe(false);
    expect(reset.submitting).toBe(false);
    expect(reset.error).toBe('Failed to create tip');
  });
});
