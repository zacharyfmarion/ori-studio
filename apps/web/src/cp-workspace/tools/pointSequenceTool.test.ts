import { describe, expect, it } from 'vitest';
import { createPointSequenceTool, type PointSequenceState } from './pointSequenceTool';
import type { ToolInput } from './types';

function run(stepCount: number, inputs: ToolInput[]) {
  const tool = createPointSequenceTool(stepCount);
  let state: PointSequenceState = tool.initialState;
  return inputs.map((input) => {
    const out = tool.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('pointSequenceTool', () => {
  it('collects clicks and commits when stepCount points are placed', () => {
    const outs = run(2, [
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'down', point: { x: 10, y: 0 } },
    ]);
    // first click: collected, not yet complete
    expect(outs[0].commit).toBeNull();
    expect(outs[0].livePoints).toEqual([{ x: 0, y: 0 }]);
    // second click completes the 2-point sequence
    expect(outs[1].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(outs[1].state).toEqual({ points: [] });
  });

  it('reports placed points + cursor on hover for the kernel preview', () => {
    const outs = run(3, [
      { kind: 'down', point: { x: 1, y: 1 } },
      { kind: 'move', point: { x: 5, y: 5 } },
    ]);
    expect(outs[1].livePoints).toEqual([{ x: 1, y: 1 }, { x: 5, y: 5 }]);
    expect(outs[1].commit).toBeNull();
  });

  it('shows no preview before the first point is placed', () => {
    const [move] = run(2, [{ kind: 'move', point: { x: 3, y: 3 } }]);
    expect(move.livePoints).toBeUndefined();
    expect(move.preview).toBeNull();
  });

  it('needs all stepCount points for a 3-point tool', () => {
    const outs = run(3, [
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'down', point: { x: 1, y: 0 } },
      { kind: 'down', point: { x: 1, y: 1 } },
    ]);
    expect(outs[0].commit).toBeNull();
    expect(outs[1].commit).toBeNull();
    expect(outs[2].commit).toEqual({
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    });
  });

  it('cancel discards the in-progress sequence', () => {
    const outs = run(3, [
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'cancel', point: { x: 0, y: 0 } },
    ]);
    expect(outs[1].state).toEqual({ points: [] });
    expect(outs[1].commit).toBeNull();
  });

  it('release (up) is a no-op — points are placed on press', () => {
    const outs = run(2, [
      { kind: 'down', point: { x: 2, y: 2 } },
      { kind: 'up', point: { x: 2, y: 2 } },
    ]);
    expect(outs[1].state).toEqual({ points: [{ x: 2, y: 2 }] });
    expect(outs[1].commit).toBeNull();
  });
});
