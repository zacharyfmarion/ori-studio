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

const IDLE = { start: null, armed: false };

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
    expect(up.state).toEqual(IDLE);
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
    expect(outs[2].state).toEqual(IDLE);
  });

  describe('click-to-place', () => {
    it('arms the start point on a click in place instead of committing', () => {
      const outs = run([
        { kind: 'down', point: { x: 3, y: 3 }, tolerance: 1 },
        { kind: 'up', point: { x: 3.2, y: 3 }, tolerance: 1 },
      ]);
      expect(outs[1].commit).toBeNull();
      expect(outs[1].preview).toBeNull();
      expect(outs[1].state).toEqual({ start: { x: 3, y: 3 }, armed: true });
    });

    it('rubber-bands from the armed start while hovering', () => {
      const outs = run([
        { kind: 'down', point: { x: 0, y: 0 }, tolerance: 1 },
        { kind: 'up', point: { x: 0, y: 0 }, tolerance: 1 },
        { kind: 'move', point: { x: 4, y: 7 }, tolerance: 1 },
      ]);
      expect(outs[2].preview).toEqual({ segments: [{ a: { x: 0, y: 0 }, b: { x: 4, y: 7 } }] });
      expect(outs[2].commit).toBeNull();
    });

    it('commits [armed start, end] on a second click elsewhere', () => {
      const outs = run([
        { kind: 'down', point: { x: 0, y: 0 }, tolerance: 1 },
        { kind: 'up', point: { x: 0, y: 0 }, tolerance: 1 },
        { kind: 'move', point: { x: 10, y: 0 }, tolerance: 1 },
        { kind: 'down', point: { x: 10, y: 0 }, tolerance: 1 },
        { kind: 'up', point: { x: 10, y: 0 }, tolerance: 1 },
      ]);
      // The second press keeps the armed start rather than restarting from it.
      expect(outs[3].state).toEqual({ start: { x: 0, y: 0 }, armed: true });
      expect(outs[3].preview).toEqual({ segments: [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }] });
      expect(outs[4].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
      expect(outs[4].state).toEqual(IDLE);
    });

    it('disarms when the armed point is clicked again', () => {
      const outs = run([
        { kind: 'down', point: { x: 5, y: 5 }, tolerance: 1 },
        { kind: 'up', point: { x: 5, y: 5 }, tolerance: 1 },
        { kind: 'down', point: { x: 5, y: 5 }, tolerance: 1 },
        { kind: 'up', point: { x: 5.5, y: 5 }, tolerance: 1 },
      ]);
      expect(outs[3].commit).toBeNull();
      expect(outs[3].state).toEqual(IDLE);
    });

    it('cancel disarms an armed start', () => {
      const outs = run([
        { kind: 'down', point: { x: 5, y: 5 }, tolerance: 1 },
        { kind: 'up', point: { x: 5, y: 5 }, tolerance: 1 },
        { kind: 'cancel', point: { x: 9, y: 9 }, tolerance: 1 },
      ]);
      expect(outs[2].state).toEqual(IDLE);
      expect(outs[2].preview).toBeNull();
    });

    it('commits from the armed start when the second gesture drags', () => {
      const outs = run([
        { kind: 'down', point: { x: 0, y: 0 }, tolerance: 1 },
        { kind: 'up', point: { x: 0, y: 0 }, tolerance: 1 },
        { kind: 'down', point: { x: 6, y: 0 }, tolerance: 1 },
        { kind: 'move', point: { x: 8, y: 0 }, tolerance: 1 },
        { kind: 'up', point: { x: 8, y: 0 }, tolerance: 1 },
      ]);
      expect(outs[4].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 8, y: 0 }] });
    });

    it('a drag longer than the tolerance still commits without arming', () => {
      const outs = run([
        { kind: 'down', point: { x: 0, y: 0 }, tolerance: 1 },
        { kind: 'move', point: { x: 0, y: 4 }, tolerance: 1 },
        { kind: 'up', point: { x: 0, y: 4 }, tolerance: 1 },
      ]);
      expect(outs[2].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 0, y: 4 }] });
      expect(outs[2].state).toEqual(IDLE);
    });

    it('treats an absent tolerance as zero, so any movement is a drag', () => {
      const outs = run([
        { kind: 'down', point: { x: 0, y: 0 } },
        { kind: 'up', point: { x: 0.0001, y: 0 } },
      ]);
      expect(outs[1].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 0.0001, y: 0 }] });
    });

    it('arms rather than committing a zero-length press-release', () => {
      const outs = run([
        { kind: 'down', point: { x: 3, y: 3 } },
        { kind: 'up', point: { x: 3, y: 3 } },
      ]);
      expect(outs[1].commit).toBeNull();
      expect(outs[1].state).toEqual({ start: { x: 3, y: 3 }, armed: true });
    });
  });
});
