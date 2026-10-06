import type { SimulatorGestureEngine, SimulatorGestureOutput, SimulatorPointerInput } from '../types';

export interface PullGestureState {
  /** A press is down and pulling. */
  pressed: boolean;
}

const IDLE: PullGestureState = { pressed: false };

const nothing = (state: PullGestureState): SimulatorGestureOutput<PullGestureState> => ({
  state,
  preview: null,
  gesture: null,
});

/**
 * Press and drag to pull. Unlike a box, a pull acts as it goes: every sample is
 * a step for the tool — the press grips, each move draws, letting go keeps, and
 * a cancel (Escape, a second finger, a tool switch) puts the paper back. There
 * is no click threshold: a press that never moves pulls nowhere and keeps that.
 */
export const pullGestureEngine: SimulatorGestureEngine<PullGestureState> = {
  initialState: IDLE,

  reduce(state, input: SimulatorPointerInput) {
    const step = (phase: 'begin' | 'move' | 'end' | 'cancel', next: PullGestureState) => ({
      state: next,
      preview: null,
      gesture: { kind: 'pull' as const, phase, point: input.point, touch: input.touch },
    });
    switch (input.kind) {
      case 'down':
        return step('begin', { pressed: true });
      case 'move':
        return state.pressed ? step('move', state) : nothing(state);
      case 'up':
        return state.pressed ? step('end', IDLE) : nothing(IDLE);
      case 'cancel':
        return state.pressed ? step('cancel', IDLE) : nothing(IDLE);
    }
  },
};
