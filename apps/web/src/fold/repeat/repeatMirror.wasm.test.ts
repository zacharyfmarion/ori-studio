import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQUARE_PAPER, type FoldOp, type FoldPrecreaseOp } from '../document/foldSequenceDocument';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import { mirroredStepAxis } from './repeatVerification';

/**
 * Two steps made by hand, one the mirror image of the other, told by
 * Repeat's own check (`mirroredStepAxis`): over the real engine in-process,
 * each pair folded from the flat square or the state given. Skipped when
 * the bridge has not been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return createFoldEngineCalls(new wasm.FoldEngine());
}

const precrease = (
  through: [[number, number], [number, number]],
  moving: [number, number],
  patch: Partial<FoldPrecreaseOp> = {}
): FoldOp => ({ kind: 'precrease', direction: 'valley', line: { via: 'free', through }, moving, seed: { scope: 'all' }, ...patch });
const vertical = (x: number, patch?: Partial<FoldPrecreaseOp>) => precrease([[x, 0], [x, 1]], [x / 2, 0.5], patch);
const pinch = (x: number): FoldOp =>
  precrease([[0, 0.5], [1, 0.5]], [0.5, 0.75], { extent: { kind: 'pinch', at: { kind: 'point', at: [x, 0.5] }, length: 0.06 } });

/** The scenes of the state `ops` start from and of the last two they land. */
async function scenes(ops: FoldOp[]) {
  const calls = await engine();
  const sheet = calls.sheet(SQUARE_PAPER);
  if (sheet.status !== 'ok') throw new Error('sheet');
  const states = [sheet.state];
  for (const op of ops) {
    const landed = calls.step(states.at(-1)!, op);
    if (landed.status !== 'ok') throw new Error(JSON.stringify(landed));
    states.push(landed.state);
  }
  return states.slice(-3).map((state) => calls.scene(state)) as [ReturnType<typeof calls.scene>, ReturnType<typeof calls.scene>, ReturnType<typeof calls.scene>];
}

describe.skipIf(!available)('a step that mirrors the one before it', () => {
  it('is told across the axis that takes one onto the other, a symmetry of the state before them', async () => {
    const symmetry = mirroredStepAxis(...(await scenes([vertical(0.25), vertical(0.75)])));
    expect(symmetry).not.toBeNull();
    // The sheet's vertical middle, whichever way its normal points.
    const { n, d } = symmetry!.sheet;
    expect(Math.abs(n[0])).toBeCloseTo(1);
    expect(n[1]).toBeCloseTo(0);
    expect(d * Math.sign(n[0])).toBeCloseTo(0.5);
  });

  it('is told for the two diagonals, which cross, and for two pinches on one line', async () => {
    const diagonal = precrease([[0, 0], [1, 1]], [0.75, 0.25]);
    const other = precrease([[1, 0], [0, 1]], [0.25, 0.25]);
    expect(mirroredStepAxis(...(await scenes([diagonal, other])))).not.toBeNull();
    expect(mirroredStepAxis(...(await scenes([pinch(0.1), pinch(0.9)])))).not.toBeNull();
  });

  it.each([
    ['two parallel creases across no symmetry of the sheet', [vertical(0.25), vertical(0.5)]],
    ['a valley mirroring a mountain', [vertical(0.25), vertical(0.75, { direction: 'mountain' })]],
    ['a fold that moves paper', [vertical(0.25), { kind: 'valley', line: { via: 'free', through: [[0.75, 0], [0.75, 1]] }, moving: [0.9, 0.5], seed: { scope: 'all' } } as FoldOp]],
    ['a mirror image across a line the folded state before them is not symmetric about', [{ kind: 'valley', line: { via: 'free', through: [[0, 0.6], [0.4, 1]] }, moving: [0.05, 0.95], seed: { scope: 'all' } } as FoldOp, vertical(0.7), vertical(0.3)]],
  ])('is not told for %s', async (_label, ops) => {
    expect(mirroredStepAxis(...(await scenes(ops)))).toBeNull();
  });
});
