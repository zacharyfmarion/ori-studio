import { describe, expect, it } from 'vitest';
import {
  createStepSequenceTool,
  type SequenceState,
  type StepSequenceOptions,
} from './stepSequenceTool';
import type { ToolInput } from './types';

function run(count: number, inputs: ToolInput[], options?: StepSequenceOptions) {
  const tool = createStepSequenceTool(count, options);
  let state: SequenceState = tool.initialState;
  return inputs.map((input) => {
    const out = tool.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('stepSequenceTool', () => {
  it('collects points and commits at count', () => {
    const outs = run(2, [
      { kind: 'down', point: { x: 1, y: 2 } },
      { kind: 'down', point: { x: 9, y: 9 } },
    ]);
    expect(outs[0].commit).toBeNull();
    expect(outs[0].livePoints).toEqual([{ x: 1, y: 2 }]);
    expect(outs[1].commit).toEqual({ points: [{ x: 1, y: 2 }, { x: 9, y: 9 }] });
    expect(outs[1].state).toEqual({ points: [] });
  });

  it('reports placed points + cursor on hover', () => {
    const outs = run(3, [
      { kind: 'down', point: { x: 1, y: 1 } },
      { kind: 'move', point: { x: 5, y: 5 } },
    ]);
    expect(outs[1].livePoints).toEqual([{ x: 1, y: 1 }, { x: 5, y: 5 }]);
    expect(outs[1].commit).toBeNull();
  });

  it('needs all points for a 3-point tool', () => {
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

  it('cancel discards the sequence', () => {
    const outs = run(3, [
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'cancel', point: { x: 0, y: 0 } },
    ]);
    expect(outs[1].state).toEqual({ points: [] });
    expect(outs[1].commit).toBeNull();
  });

  describe('distinctPairs', () => {
    const distinctPairs = { distinctPairs: true };

    it('ignores a press that closes a pair on its own first point', () => {
      // A double-click on one vertex: the second press is refused and the
      // sequence still waits for the pair's second point.
      const outs = run(
        4,
        [
          { kind: 'down', point: { x: 0, y: 0 }, tolerance: 2 },
          { kind: 'down', point: { x: 1, y: 1 }, tolerance: 2 },
          { kind: 'move', point: { x: 50, y: 50 }, tolerance: 2 },
        ],
        distinctPairs
      );
      expect(outs[1]).toMatchObject({
        ignored: true,
        commit: null,
        state: { points: [{ x: 0, y: 0 }] },
        livePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      });
      expect(outs[2].livePoints).toEqual([{ x: 0, y: 0 }, { x: 50, y: 50 }]);
    });

    it('gates the second pair the same way, then commits four distinct points', () => {
      const outs = run(
        4,
        [
          { kind: 'down', point: { x: 0, y: 0 }, tolerance: 2 },
          { kind: 'down', point: { x: 10, y: 0 }, tolerance: 2 },
          { kind: 'down', point: { x: 20, y: 20 }, tolerance: 2 },
          { kind: 'down', point: { x: 21, y: 20 }, tolerance: 2 },
          { kind: 'down', point: { x: 30, y: 20 }, tolerance: 2 },
        ],
        distinctPairs
      );
      expect(outs[3].ignored).toBe(true);
      expect(outs[4].commit).toEqual({
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 20 }, { x: 30, y: 20 }],
      });
    });

    it('does not gate the first point of a pair against the previous pair', () => {
      // Target pair starting where the source pair ended is a legitimate
      // gesture (copy onto an adjacent vertex).
      const outs = run(
        4,
        [
          { kind: 'down', point: { x: 0, y: 0 }, tolerance: 2 },
          { kind: 'down', point: { x: 10, y: 0 }, tolerance: 2 },
          { kind: 'down', point: { x: 10, y: 0 }, tolerance: 2 },
        ],
        distinctPairs
      );
      expect(outs[2].ignored).toBeUndefined();
      expect(outs[2].state).toEqual({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }] });
    });

    it('is exact when no tolerance is given, and refuses a non-finite press', () => {
      const outs = run(
        2,
        [
          { kind: 'down', point: { x: 0, y: 0 } },
          { kind: 'down', point: { x: 0, y: 0 } },
          { kind: 'down', point: { x: Number.NaN, y: 0 } },
          { kind: 'down', point: { x: 0.001, y: 0 } },
        ],
        distinctPairs
      );
      expect(outs[1].ignored).toBe(true);
      expect(outs[2].ignored).toBe(true);
      expect(outs[3].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 0.001, y: 0 }] });
    });

    it('is off by default', () => {
      const outs = run(2, [
        { kind: 'down', point: { x: 0, y: 0 }, tolerance: 2 },
        { kind: 'down', point: { x: 0, y: 0 }, tolerance: 2 },
      ]);
      expect(outs[1].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] });
    });
  });

  it('release (up) is a no-op', () => {
    const outs = run(2, [
      { kind: 'down', point: { x: 2, y: 2 } },
      { kind: 'up', point: { x: 2, y: 2 } },
    ]);
    expect(outs[1].state).toEqual({ points: [{ x: 2, y: 2 }] });
    expect(outs[1].commit).toBeNull();
  });
});
