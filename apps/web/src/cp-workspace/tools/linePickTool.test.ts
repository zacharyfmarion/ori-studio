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

  it('un-picks a crease that is picked again', () => {
    // Appending it instead produced a duplicate id, which every one of these
    // tools rejects downstream — the three-angle solve answered `CreaseNotInFan`
    // and the gesture died with no way back except restarting it.
    const outs = run(3, [
      { kind: 'down', point: P, lineId: 3 },
      { kind: 'down', point: P, lineId: 7 },
      { kind: 'down', point: P, lineId: 3 },
    ]);
    expect(outs[2].state).toEqual({ lineIds: [7] });
    expect(outs[2].highlightLineIds).toEqual([7]);
    expect(outs[2].commit).toBeNull();
  });

  it('lets a changed mind reach a different crease', () => {
    // The whole point: un-picking has to leave room to pick another and still
    // commit, not merely avoid the crash.
    const outs = run(3, [
      { kind: 'down', point: P, lineId: 3 },
      { kind: 'down', point: P, lineId: 7 },
      { kind: 'down', point: P, lineId: 7 },
      { kind: 'down', point: P, lineId: 9 },
      { kind: 'down', point: P, lineId: 11 },
    ]);
    expect(outs[4].commit).toEqual({ lineIds: [3, 9, 11] });
  });

  it('never commits a duplicate id', () => {
    // A two-pick tool clicking one crease twice used to commit `[a, a]`, which
    // is meaningless for every tool on this engine.
    const outs = run(2, [
      { kind: 'down', point: P, lineId: 4 },
      { kind: 'down', point: P, lineId: 4 },
    ]);
    expect(outs[1].commit).toBeNull();
    expect(outs[1].state).toEqual({ lineIds: [] });
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
