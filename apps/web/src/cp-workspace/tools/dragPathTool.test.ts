import { describe, expect, it } from 'vitest';
import { dragPathTool, type DragPathState } from './dragPathTool';
import type { ToolInput } from './types';

function run(inputs: ToolInput[]) {
  let state: DragPathState = dragPathTool.initialState;
  return inputs.map((input) => {
    const out = dragPathTool.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('dragPathTool', () => {
  it('accumulates sampled points and previews the polyline', () => {
    const outs = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'move', point: { x: 1, y: 1 } },
      { kind: 'move', point: { x: 2, y: 0 } },
    ]);
    expect(outs[2].preview?.segments).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      { a: { x: 1, y: 1 }, b: { x: 2, y: 0 } },
    ]);
  });

  it('skips duplicate consecutive samples', () => {
    const outs = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'move', point: { x: 1, y: 1 } },
      { kind: 'move', point: { x: 1, y: 1 } },
      { kind: 'up', point: { x: 1, y: 1 } },
    ]);
    expect(outs[3].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  });

  it('does not commit a single-point path', () => {
    const outs = run([
      { kind: 'down', point: { x: 4, y: 4 } },
      { kind: 'up', point: { x: 4, y: 4 } },
    ]);
    expect(outs[1].commit).toBeNull();
    expect(outs[1].state).toEqual({ points: [] });
  });

  it('cancel drops the path', () => {
    const outs = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'move', point: { x: 5, y: 5 } },
      { kind: 'cancel', point: { x: 5, y: 5 } },
    ]);
    expect(outs[2].commit).toBeNull();
    expect(outs[2].state).toEqual({ points: [] });
  });
});
