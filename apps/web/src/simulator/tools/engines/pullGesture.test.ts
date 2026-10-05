import { describe, expect, it } from 'vitest';
import { pullGestureEngine, type PullGestureState } from './pullGesture';
import type { SimulatorPointerInput } from '../types';

function sample(kind: SimulatorPointerInput['kind'], x = 10, y = 20): SimulatorPointerInput {
  return { kind, point: { x, y }, shift: false, touch: false };
}

/** Feed a sequence of samples, collecting the steps the tool would be handed. */
function steps(samples: SimulatorPointerInput[]) {
  let state: PullGestureState = pullGestureEngine.initialState;
  const out: Array<{ phase: string; x: number }> = [];
  for (const input of samples) {
    const result = pullGestureEngine.reduce(state, input);
    state = result.state;
    expect(result.preview).toBeNull();
    if (result.gesture?.kind === 'pull') out.push({ phase: result.gesture.phase, x: result.gesture.point.x });
  }
  return out;
}

describe('pullGestureEngine', () => {
  it('acts on every sample: grips on the press, draws on each move, keeps on letting go', () => {
    expect(steps([sample('down', 1), sample('move', 2), sample('move', 3), sample('up', 4)])).toEqual([
      { phase: 'begin', x: 1 },
      { phase: 'move', x: 2 },
      { phase: 'move', x: 3 },
      { phase: 'end', x: 4 },
    ]);
  });

  it('puts the paper back when the drag is abandoned', () => {
    expect(steps([sample('down', 1), sample('move', 2), sample('cancel', 0)])).toEqual([
      { phase: 'begin', x: 1 },
      { phase: 'move', x: 2 },
      { phase: 'cancel', x: 0 },
    ]);
  });

  it('says nothing for samples without a press', () => {
    expect(steps([sample('move'), sample('up'), sample('cancel')])).toEqual([]);
    // And nothing more once a pull has ended.
    expect(steps([sample('down'), sample('up'), sample('move'), sample('up')]).map((s) => s.phase)).toEqual([
      'begin',
      'end',
    ]);
  });

  it('carries whether a finger made it', () => {
    const result = pullGestureEngine.reduce(pullGestureEngine.initialState, { ...sample('down'), touch: true });
    expect(result.gesture).toMatchObject({ kind: 'pull', phase: 'begin', touch: true });
  });
});
