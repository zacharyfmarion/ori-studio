import { describe, expect, it } from 'vitest';
import { dragVertexTool, type DragVertexState } from './dragVertexTool';
import type { ToolInput } from './types';

/** Run a sequence of inputs from the initial state, returning every output. */
function run(inputs: ToolInput[]) {
  let state: DragVertexState = dragVertexTool.initialState;
  return inputs.map((input) => {
    const out = dragVertexTool.reduce(state, input);
    state = out.state;
    return out;
  });
}

const IDLE = { anchor: null };

describe('dragVertexTool', () => {
  it('commits [vertex, destination] on release and returns to idle', () => {
    const outs = run([
      { kind: 'down', point: { x: 100, y: 100 } },
      { kind: 'move', point: { x: 130, y: 140 }, tolerance: 2 },
      { kind: 'up', point: { x: 130, y: 140 }, tolerance: 2 },
    ]);
    const up = outs[2];
    expect(up.commit).toEqual({
      points: [
        { x: 100, y: 100 },
        { x: 130, y: 140 },
      ],
    });
    expect(up.state).toEqual(IDLE);
  });

  it('anchors on the vertex the surface fed, not on wherever the drag went', () => {
    // The surface substitutes the resolved vertex for the press point, so a press
    // a few pixels off the junction still pivots on the junction.
    const outs = run([
      { kind: 'down', point: { x: 100, y: 100 } },
      { kind: 'up', point: { x: 0, y: 0 }, tolerance: 2 },
    ]);
    expect(outs[1].commit?.points?.[0]).toEqual({ x: 100, y: 100 });
  });

  it('never previews — the surface moves the real strokes', () => {
    const outs = run([
      { kind: 'down', point: { x: 1, y: 1 } },
      { kind: 'move', point: { x: 9, y: 9 } },
      { kind: 'up', point: { x: 9, y: 9 }, tolerance: 1 },
    ]);
    expect(outs.map((o) => o.preview)).toEqual([null, null, null]);
  });

  it('commits nothing for a click in place, so a stray click cannot dirty the document', () => {
    const outs = run([
      { kind: 'down', point: { x: 100, y: 100 } },
      { kind: 'up', point: { x: 100.5, y: 100 }, tolerance: 2 },
    ]);
    expect(outs[1].commit).toBeNull();
    expect(outs[1].state).toEqual(IDLE);
  });

  it('does not arm: a second press starts a fresh grab rather than finishing the first', () => {
    // The distinguishing behaviour against dragLineTool. A parked vertex move
    // would show no anchor and offer no way out.
    const outs = run([
      { kind: 'down', point: { x: 100, y: 100 } },
      { kind: 'up', point: { x: 100, y: 100 }, tolerance: 2 },
      { kind: 'down', point: { x: 20, y: 20 } },
      { kind: 'up', point: { x: 60, y: 60 }, tolerance: 2 },
    ]);
    expect(outs[1].commit).toBeNull();
    expect(outs[3].commit).toEqual({
      points: [
        { x: 20, y: 20 },
        { x: 60, y: 60 },
      ],
    });
  });

  it('treats a missing tolerance as zero, so any movement is a drag', () => {
    const outs = run([
      { kind: 'down', point: { x: 0, y: 0 } },
      { kind: 'up', point: { x: 0.001, y: 0 } },
    ]);
    expect(outs[1].commit).not.toBeNull();
  });

  it('ignores move/up with no grab in flight', () => {
    const [move, up] = run([
      { kind: 'move', point: { x: 1, y: 1 } },
      { kind: 'up', point: { x: 1, y: 1 }, tolerance: 2 },
    ]);
    expect(move.commit).toBeNull();
    expect(up.commit).toBeNull();
    expect(up.state).toEqual(IDLE);
  });

  it('drops the grab on cancel', () => {
    const outs = run([
      { kind: 'down', point: { x: 5, y: 5 } },
      { kind: 'cancel', point: { x: 9, y: 9 } },
      { kind: 'up', point: { x: 40, y: 40 }, tolerance: 2 },
    ]);
    expect(outs[1].state).toEqual(IDLE);
    expect(outs[2].commit).toBeNull();
  });
});
