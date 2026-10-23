import { describe, expect, it, vi } from 'vitest';
import type { FoldOp, FoldPrecreaseOp, SheetPoint } from '../document/foldSequenceDocument';
import { findMoverFix, MOVER_FIX_TRIES, moverStaysPoint, withMoverSwapped } from './moverStays';
import type { FoldRefused } from './refusalNotice';

const precrease = (p: SheetPoint, q: SheetPoint): FoldPrecreaseOp => ({
  kind: 'precrease',
  line: { via: 'axiom', axiom: 2, inputs: [{ kind: 'point', at: p }, { kind: 'mark', at: q, mark: 'fmark-1' }] },
  direction: 'valley',
  seed: { scope: 'flaps', at: [[0.9, 0.45]] },
});

const stays = (point: SheetPoint): FoldRefused => ({ refusal: { code: 'mover_stays', point }, fixes: [] });

describe('a point that stays put', () => {
  it('reads the point from a mover_stays refusal only', () => {
    expect(moverStaysPoint(stays([0, 1]))).toEqual([0, 1]);
    expect(moverStaysPoint({ refusal: { code: 'mover_stays' }, fixes: [] })).toBeNull();
    expect(moverStaysPoint({ refusal: { code: 'no_side' }, fixes: [] })).toBeNull();
    expect(moverStaysPoint(null)).toBeNull();
  });

  it('swaps the axiom’s point at that spot, a mark for a plain point, and nothing else', () => {
    const op = precrease([0, 1], [0.5, 0.25]);
    expect(withMoverSwapped(op, [0, 1], [1, 0.5])).toEqual({
      ...op,
      line: { ...op.line, inputs: [{ kind: 'point', at: [1, 0.5] }, op.line.via === 'axiom' ? op.line.inputs[1] : null] },
    });
    expect(withMoverSwapped(op, [0.5, 0.25], [0.5, 0.75])).toMatchObject({
      line: { inputs: [{ kind: 'point', at: [0, 1] }, { kind: 'point', at: [0.5, 0.75] }] },
    });
    expect(withMoverSwapped(op, [0.3, 0.3], [1, 0.5])).toBeNull();
    const free: FoldOp = { kind: 'valley', line: { via: 'free', through: [[0, 1], [1, 0]] }, seed: { scope: 'all' } };
    expect(withMoverSwapped(free, [0, 1], [1, 0.5])).toBeNull();
  });

  it('offers the first point at the spot, top first, whose step lands, asking no more than it must', async () => {
    const op = precrease([0, 1], [0.5, 0.25]);
    const together = () => [[0, 0], [1, 0.5], [0.2, 0.2]] as SheetPoint[];
    const lands = vi.fn(async (asked: FoldOp) => asked.kind === 'precrease' && asked.line.via === 'axiom' && asked.line.inputs[0]?.kind === 'point' && asked.line.inputs[0].at[0] === 1);
    const fix = await findMoverFix(op, stays([0, 1]), together, lands);
    expect(fix).toMatchObject({ from: [0, 1], to: [1, 0.5] });
    expect(lands).toHaveBeenCalledTimes(2);
    // None that lands, or another refusal: no fix.
    expect(await findMoverFix(op, stays([0, 1]), together, async () => false)).toBeNull();
    expect(await findMoverFix(op, { refusal: { code: 'no_side' }, fixes: [] }, together, lands)).toBeNull();
    // Only the layers nearest the top are asked.
    const many = () => Array.from({ length: 20 }, (_, k) => [k / 40, 0.5] as SheetPoint);
    const never = vi.fn(async () => false);
    await findMoverFix(op, stays([0, 1]), many, never);
    expect(never).toHaveBeenCalledTimes(MOVER_FIX_TRIES);
  });
});
