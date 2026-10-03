import { describe, expect, it } from 'vitest';
import type { SimulatorGestureOutput, SimulatorPointerInput } from '../types';
import { boxGestureEngine, SIMULATOR_CLICK_MOVE_THRESHOLD, type BoxGestureState } from './boxGesture';

function sample(
  kind: SimulatorPointerInput['kind'],
  x: number,
  y: number,
  extra: Partial<SimulatorPointerInput> = {}
): SimulatorPointerInput {
  return { kind, point: { x, y }, shift: false, touch: false, ...extra };
}

/** Feed a whole pointer sequence; every output, in order. */
function run(inputs: SimulatorPointerInput[]): SimulatorGestureOutput<BoxGestureState>[] {
  let state = boxGestureEngine.initialState;
  return inputs.map((input) => {
    const out = boxGestureEngine.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('boxGestureEngine', () => {
  it('reads a release inside the threshold as a click where the press landed', () => {
    const near = SIMULATOR_CLICK_MOVE_THRESHOLD;
    const outs = run([sample('down', 10, 20), sample('move', 10 + near, 20 - near), sample('up', 10 + near, 20)]);

    expect(outs[1].preview).toBeNull();
    expect(outs[2].gesture).toEqual({ kind: 'click', point: { x: 10, y: 20 }, shift: false, touch: false });
  });

  it('draws a normalised marquee once the drag leaves the threshold, and ends in a box', () => {
    const outs = run([sample('down', 50, 60), sample('move', 20, 90), sample('up', 10, 100)]);

    expect(outs[1].preview).toEqual({ marquee: { left: 20, top: 60, right: 50, bottom: 90 } });
    expect(outs[2].gesture).toEqual({
      kind: 'box',
      rect: { left: 10, top: 60, right: 50, bottom: 100 },
      shift: false,
      touch: false,
    });
    expect(outs[2].state).toEqual(boxGestureEngine.initialState);
  });

  it('stays a box when the drag comes back to where it started', () => {
    // A marquee on screen must not turn into a click under the hand.
    const outs = run([sample('down', 0, 0), sample('move', 30, 30), sample('move', 1, 1), sample('up', 1, 1)]);

    expect(outs[2].preview).toEqual({ marquee: { left: 0, top: 0, right: 1, bottom: 1 } });
    expect(outs[3].gesture?.kind).toBe('box');
  });

  it('counts a release beyond the threshold as a box even with no move in between', () => {
    const outs = run([sample('down', 0, 0), sample('up', 0, SIMULATOR_CLICK_MOVE_THRESHOLD + 1)]);

    expect(outs[1].gesture?.kind).toBe('box');
  });

  it('takes Shift and the pointer kind from the press', () => {
    const outs = run([
      sample('down', 0, 0, { shift: true, touch: true }),
      sample('move', 40, 40, { shift: false }),
      sample('up', 40, 40, { shift: false }),
    ]);

    expect(outs[2].gesture).toMatchObject({ kind: 'box', shift: true, touch: true });
  });

  it('ends with nothing on cancel, and ignores samples with no press behind them', () => {
    const cancelled = run([sample('down', 0, 0), sample('move', 40, 40), sample('cancel', 40, 40)]);
    expect(cancelled[2]).toEqual({ state: boxGestureEngine.initialState, preview: null, gesture: null });

    const stray = run([sample('move', 10, 10), sample('up', 10, 10)]);
    expect(stray.every((out) => out.gesture === null && out.preview === null)).toBe(true);
  });
});
