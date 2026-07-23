import { describe, expect, it } from 'vitest';
import { dragBoxTool, type DragBoxState } from './dragBoxTool';
import type { ToolInput } from './types';

function run(inputs: ToolInput[]) {
  let state: DragBoxState = dragBoxTool.initialState;
  return inputs.map((input) => {
    const out = dragBoxTool.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('dragBoxTool', () => {
  it('rubber-bands a rectangle (4 edges) while dragging', () => {
    const [, move] = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'move', point: { x: 10, y: 4 } },
    ]);
    expect(move.preview?.segments).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 4 } },
      { a: { x: 10, y: 4 }, b: { x: 0, y: 4 } },
      { a: { x: 0, y: 4 }, b: { x: 0, y: 0 } },
    ]);
  });

  it('commits the two opposite corners on release', () => {
    const outs = run([
      { kind: 'down', point: { x: 1, y: 2 } },
      { kind: 'move', point: { x: 5, y: 8 } },
      { kind: 'up', point: { x: 5, y: 8 } },
    ]);
    expect(outs[2].commit).toEqual({ points: [{ x: 1, y: 2 }, { x: 5, y: 8 }] });
    expect(outs[2].state).toEqual({ start: null });
  });

  it('commits a flat box from a straight drag along one axis', () => {
    const outs = run([
      { kind: 'down', point: { x: 1, y: 2 } },
      { kind: 'up', point: { x: 1, y: 9 } }, // same x, zero width
    ]);
    expect(outs[1].commit).toEqual({ points: [{ x: 1, y: 2 }, { x: 1, y: 9 }] });
  });

  it('does not commit a zero-length gesture', () => {
    const outs = run([
      { kind: 'down', point: { x: 1, y: 2 } },
      { kind: 'up', point: { x: 1, y: 2 } },
    ]);
    expect(outs[1].commit).toBeNull();
  });

  it('cancel drops the box', () => {
    const outs = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'cancel', point: { x: 3, y: 3 } },
    ]);
    expect(outs[1].commit).toBeNull();
    expect(outs[1].state).toEqual({ start: null });
  });
});
