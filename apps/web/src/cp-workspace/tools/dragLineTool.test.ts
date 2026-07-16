import { describe, expect, it } from 'vitest';
import { dragLineTool, type DragLineState } from './dragLineTool';
import type { ToolInput } from './types';

/** Run a sequence of inputs from the initial state, returning every output. */
function run(inputs: ToolInput[]) {
  let state: DragLineState = dragLineTool.initialState;
  return inputs.map((input) => {
    const out = dragLineTool.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('dragLineTool', () => {
  it('previews a line from the start point while dragging', () => {
    const [down, move] = run([
      { kind: 'down', point: { x: 1, y: 2 } },
      { kind: 'move', point: { x: 5, y: 6 } },
    ]);
    expect(down.preview).toBeNull();
    expect(down.commit).toBeNull();
    expect(move.preview).toEqual({ segments: [{ a: { x: 1, y: 2 }, b: { x: 5, y: 6 } }] });
    expect(move.commit).toBeNull();
  });

  it('commits [start, end] on release and returns to idle', () => {
    const outs = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'move', point: { x: 10, y: 0 } },
      { kind: 'up', point: { x: 10, y: 0 } },
    ]);
    const up = outs[2];
    expect(up.commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(up.preview).toBeNull();
    expect(up.state).toEqual({ start: null });
  });

  it('does not commit a zero-length drag (press without moving)', () => {
    const outs = run([
      { kind: 'down', point: { x: 3, y: 3 } },
      { kind: 'up', point: { x: 3, y: 3 } },
    ]);
    expect(outs[1].commit).toBeNull();
    expect(outs[1].state).toEqual({ start: null });
  });

  it('ignores move/up with no active drag', () => {
    const [move, up] = run([
      { kind: 'move', point: { x: 1, y: 1 } },
      { kind: 'up', point: { x: 1, y: 1 } },
    ]);
    expect(move.preview).toBeNull();
    expect(move.commit).toBeNull();
    expect(up.commit).toBeNull();
  });

  it('cancel drops the in-progress drag without committing', () => {
    const outs = run([
      { kind: 'down', point: { x: 2, y: 2 } },
      { kind: 'move', point: { x: 8, y: 9 } },
      { kind: 'cancel', point: { x: 8, y: 9 } },
    ]);
    expect(outs[2].commit).toBeNull();
    expect(outs[2].preview).toBeNull();
    expect(outs[2].state).toEqual({ start: null });
  });
});
