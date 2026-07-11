import { describe, expect, it } from 'vitest';
import { createStepSequenceTool, type StepKind, type StepSequenceState } from './stepSequenceTool';
import type { ToolInput } from './types';

function run(kinds: StepKind[], inputs: ToolInput[]) {
  const tool = createStepSequenceTool(kinds);
  let state: StepSequenceState = tool.initialState;
  return inputs.map((input) => {
    const out = tool.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('stepSequenceTool', () => {
  it('mixed point-then-line: collects a point then a crease and commits both', () => {
    const outs = run(
      ['point', 'line'],
      [
        { kind: 'down', point: { x: 1, y: 2 } }, // step 0: point
        { kind: 'move', point: { x: 9, y: 9 }, lineId: 7 }, // step 1: hovering crease 7
        { kind: 'down', point: { x: 9, y: 9 }, lineId: 7 }, // step 1: pick crease 7
      ]
    );
    // after the point, the next (line) step previews with the point placed
    expect(outs[0].livePoints).toEqual([{ x: 1, y: 2 }]);
    // hovering the crease highlights it, still passing the placed point for preview
    expect(outs[1].highlightLineIds).toEqual([7]);
    expect(outs[1].livePoints).toEqual([{ x: 1, y: 2 }]);
    // picking the crease completes the sequence
    expect(outs[2].commit).toEqual({ points: [{ x: 1, y: 2 }], lineIds: [7] });
    expect(outs[2].state).toEqual({ points: [], lineIds: [], step: 0 });
  });

  it('all-point behaves like a point sequence', () => {
    const outs = run(
      ['point', 'point'],
      [
        { kind: 'down', point: { x: 0, y: 0 } },
        { kind: 'down', point: { x: 5, y: 0 } },
      ]
    );
    expect(outs[0].commit).toBeNull();
    expect(outs[1].commit).toEqual({ points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], lineIds: [] });
  });

  it('all-line behaves like a line pick', () => {
    const outs = run(
      ['line', 'line'],
      [
        { kind: 'down', point: { x: 0, y: 0 }, lineId: 3 },
        { kind: 'down', point: { x: 0, y: 0 }, lineId: 8 },
      ]
    );
    expect(outs[0].highlightLineIds).toEqual([3]);
    expect(outs[1].commit).toEqual({ points: [], lineIds: [3, 8] });
  });

  it('ignores a line-step click on empty space', () => {
    const outs = run(
      ['line', 'line'],
      [
        { kind: 'down', point: { x: 0, y: 0 }, lineId: 3 },
        { kind: 'down', point: { x: 0, y: 0 }, lineId: null },
      ]
    );
    expect(outs[1].commit).toBeNull();
    expect(outs[1].state.lineIds).toEqual([3]);
  });

  it('cancel resets the whole sequence', () => {
    const outs = run(
      ['point', 'line'],
      [
        { kind: 'down', point: { x: 1, y: 1 } },
        { kind: 'cancel', point: { x: 1, y: 1 } },
      ]
    );
    expect(outs[1].state).toEqual({ points: [], lineIds: [], step: 0 });
  });
});
