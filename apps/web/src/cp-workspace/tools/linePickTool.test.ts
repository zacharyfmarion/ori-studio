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
  it('collects picked crease ids and commits at count', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 5 },
      { kind: 'down', point: P, lineId: 8 },
    ]);
    expect(outs[0].commit).toBeNull();
    expect(outs[0].highlightLineIds).toEqual([5]);
    expect(outs[1].commit).toEqual({ lineIds: [5, 8] });
    expect(outs[1].state).toEqual({ lineIds: [] });
  });

  it('commits on a single pick when count is 1', () => {
    const [down] = run(1, [{ kind: 'down', point: P, lineId: 3 }]);
    expect(down.commit).toEqual({ lineIds: [3] });
  });

  it('highlights picked + hovered on move', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 5 },
      { kind: 'move', point: P, lineId: 9 },
    ]);
    expect(outs[1].highlightLineIds).toEqual([5, 9]);
    expect(outs[1].commit).toBeNull();
  });

  it('ignores a click on empty space (no crease under cursor)', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 5 },
      { kind: 'down', point: P, lineId: null },
    ]);
    expect(outs[1].commit).toBeNull();
    expect(outs[1].state).toEqual({ lineIds: [5] });
    expect(outs[1].highlightLineIds).toEqual([5]);
  });

  it('cancel discards picks', () => {
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 5 },
      { kind: 'cancel', point: P },
    ]);
    expect(outs[1].state).toEqual({ lineIds: [] });
  });
});
