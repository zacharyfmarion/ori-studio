import { describe, expect, it } from 'vitest';
import { pickVertexTool } from './pickVertexTool';
import type { ToolInput } from './types';

const AT = (x: number, y: number) => ({ x, y });
const down = (x: number, y: number): ToolInput => ({ kind: 'down', point: AT(x, y) });

describe('pickVertexTool', () => {
  it('commits the vertex on press', () => {
    const out = pickVertexTool.reduce(pickVertexTool.initialState, down(3, 4));
    expect(out.commit).toEqual({ points: [AT(3, 4)] });
  });

  it('never previews — there is no gesture to show', () => {
    expect(pickVertexTool.reduce(pickVertexTool.initialState, down(3, 4)).preview).toBeNull();
  });

  it('commits nothing on the release that follows', () => {
    // The press already committed. A second commit on release would toggle the
    // pin straight back off, which is the bug this asserts against.
    const pressed = pickVertexTool.reduce(pickVertexTool.initialState, down(3, 4));
    const released = pickVertexTool.reduce(pressed.state, { kind: 'up', point: AT(3, 4) });
    expect(released.commit).toBeNull();
  });

  it('carries no state between gestures', () => {
    const first = pickVertexTool.reduce(pickVertexTool.initialState, down(1, 1));
    expect(first.state).toEqual(pickVertexTool.initialState);
  });
});
