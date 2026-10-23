import { describe, expect, it } from 'vitest';
import { moverFirst } from './moverFirst';

describe('moverFirst', () => {
  it('keeps the axiom’s order when the first input is the one that moves', () => {
    expect(moverFirst([0], [0, 1])).toEqual([0, 1]);
  });

  it('puts the second input first when it is the one that moves', () => {
    expect(moverFirst([1], [0, 1])).toEqual([1, 0]);
  });

  it('keeps the axiom’s order when neither moves, as an O1 crease moves nothing', () => {
    expect(moverFirst([], [0, 1])).toEqual([0, 1]);
  });

  it('orders each of an O6’s two pairs on its own', () => {
    // `[p1, m1, p2, m2]`: the first mark swings onto its line, the second
    // line onto its mark.
    const moving = [0, 3];
    expect(moverFirst(moving, [0, 1])).toEqual([0, 1]);
    expect(moverFirst(moving, [2, 3])).toEqual([3, 2]);
  });
});
