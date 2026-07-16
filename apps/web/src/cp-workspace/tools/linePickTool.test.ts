import { describe, expect, it } from 'vitest';
import { createLinePickTool, type LinePickState } from './linePickTool';
import type { ToolInput } from './types';

const P = { x: 0, y: 0 };

function run(count: number, inputs: ToolInput[]) {
  const tool = createLinePickTool(count);
  let state: LinePickState = tool.initialState;
  return inputs.map((input) => {
    const out = tool.reduce(state, input);
    state = out.state;
    return out;
  });
}

describe('linePickTool', () => {
  it('picks N crease ids and commits lineIds (no points)', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 7 },
      { kind: 'down', point: P, lineId: 12 },
    ]);
    expect(outs[0].commit).toBeNull();
    expect(outs[0].highlightLineIds).toEqual([7]);
    expect(outs[1].commit).toEqual({ lineIds: [7, 12] });
    expect(outs[1].commit && 'points' in outs[1].commit).toBe(false);
    expect(outs[1].state).toEqual({ lineIds: [] });
  });

  it('ignores clicks that miss a crease (empty-canvas swallow)', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: null },
      { kind: 'down', point: P, lineId: 0 },
      { kind: 'down', point: P, lineId: 5 },
    ]);
    expect(outs[0].commit).toBeNull();
    expect(outs[0].state).toEqual({ lineIds: [] });
    expect(outs[1].state).toEqual({ lineIds: [] });
    expect(outs[2].state).toEqual({ lineIds: [5] });
    expect(outs[2].commit).toBeNull();
  });

  it('highlights picked + hovered on move', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 3 },
      { kind: 'move', point: P, lineId: 9 },
    ]);
    expect(outs[1].highlightLineIds).toEqual([3, 9]);
    expect(outs[1].commit).toBeNull();
  });

  it('move over empty canvas highlights only the picked', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 3 },
      { kind: 'move', point: P, lineId: null },
    ]);
    expect(outs[1].highlightLineIds).toEqual([3]);
  });

  it('cancel discards the picks', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 3 },
      { kind: 'cancel', point: P },
    ]);
    expect(outs[1].state).toEqual({ lineIds: [] });
    expect(outs[1].commit).toBeNull();
  });
});
