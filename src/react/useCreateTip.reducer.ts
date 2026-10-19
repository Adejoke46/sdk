/**
 * useCreateTip reducer
 *
 * Centralizes the tip lifecycle state machine (idle -> creating/building/submitting/confirming
 * -> success/error) into a single, pure, and independently testable transition function.
 *
 * This replaces the previous `useState`-based scatter of state updates in `useCreateTip`.
 * Every state mutation now flows through one of the documented actions below, which makes
 * transitions predictable and easy to assert against in tests.
 *
 * State shape:
 *   - `data`        : the last successfully created/confirmed `Transaction`, if any.
 *   - `loading`     : whether an operation is currently in flight.
 *   - `submitting`  : whether a submission-phase operation is currently in flight.
 *   - `error`       : the most recent error message, if any.
 *   - `step`        : the current lifecycle step.
 *
 * Actions:
 *   - { type: 'START', step }        - Begin an operation; sets loading/submitting, clears error,
 *                                      advances `step` to the provided lifecycle step.
 *   - { type: 'FAIL', error }        - Record a failure; sets `error`, steps to 'error', clears
 *                                      loading/submitting.
 *   - { type: 'COMPLETE', data?, step } - Record a successful completion; clears loading/submitting,
 *                                      advances `step`, and replaces `data` only when provided.
 *   - { type: 'RESET' }              - Return to idle: clears loading/submitting, steps to 'idle'.
 *                                      Preserves any existing `data` and `error`.
 *
 * The reducer is intentionally side-effect free: it receives the previous state and an action and
 * returns the next state. All async work, abort controllers, debounce guards and provider
 * reporting remain in `useCreateTip`.
 */

import { Transaction } from '../types/models';

export type TipFormStep =
  | 'idle'
  | 'creating'
  | 'building'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'error';

export interface TipFormState {
  data?: Transaction;
  loading: boolean;
  submitting: boolean;
  error?: string;
  step: TipFormStep;
}

export type TipFormAction =
  | { type: 'START'; step: TipFormStep }
  | { type: 'FAIL'; error: string }
  | { type: 'COMPLETE'; data?: Transaction; step: TipFormStep }
  | { type: 'RESET' };

export const initialTipFormState: TipFormState = {
  loading: false,
  submitting: false,
  step: 'idle',
};

/**
 * Pure reducer for the tip creation lifecycle state.
 *
 * @param state - previous hook state
 * @param action - the transition to apply
 * @returns the next hook state
 */
export function tipFormReducer(state: TipFormState, action: TipFormAction): TipFormState {
  switch (action.type) {
    case 'START':
      return {
        ...state,
        loading: true,
        submitting: true,
        step: action.step,
        error: undefined,
      };
    case 'FAIL':
      return {
        ...state,
        error: action.error,
        step: 'error',
        loading: false,
        submitting: false,
      };
    case 'COMPLETE':
      return {
        ...state,
        ...(action.data !== undefined ? { data: action.data } : {}),
        step: action.step,
        loading: false,
        submitting: false,
      };
    case 'RESET':
      return {
        ...state,
        loading: false,
        submitting: false,
        step: 'idle',
      };
    default:
      return state;
  }
}
