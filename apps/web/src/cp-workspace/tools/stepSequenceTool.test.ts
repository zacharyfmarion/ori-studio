import { describe, expect, it } from 'vitest';
import { createStepSequenceTool, type SequenceState } from './stepSequenceTool';
import type { ToolInput } from './types';

function run(count: number, inputs: ToolInput[]) {
  const tool = createStepSequenceTool(count);
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
    expect(outs[1].commit).toEqual({
      points: [
        { x: 1, y: 2 },
        { x: 9, y: 9 },
      ],
    });
    expect(outs[1].state).toEqual({ points: [] });
  });

  it('reports placed points + cursor on hover', () => {
    const outs = run(3, [
      { kind: 'down', point: { x: 1, y: 1 } },
      { kind: 'move', point: { x: 5, y: 5 } },
    ]);
    expect(outs[1].livePoints).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 5 },
    ]);
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
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
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

  it('release (up) is a no-op', () => {
    const outs = run(2, [
      { kind: 'down', point: { x: 2, y: 2 } },
      { kind: 'up', point: { x: 2, y: 2 } },
    ]);
    expect(outs[1].state).toEqual({ points: [{ x: 2, y: 2 }] });
    expect(outs[1].commit).toBeNull();
  });
});
