import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import { createFoldEngineCalls } from '../fold/engine/foldEngineCalls';
import type { FoldEngineOutcome, FoldScene } from '../fold/engine/foldEngineWire';
import { validSolution } from './protocol';

/**
 * Two flaps the fold engine lays edge to edge, spread by Default: a corner's
 * two edges folded to one line, the second fold a few hundred-millionths of
 * a radian off it, so the second flap reaches that far over the first. The
 * engine calls faces no more than its tolerance (a millionth of the sheet)
 * into each other touching: it folds them, and orders neither over the
 * other. The spread used to refuse the state ("significant overlap missing
 * layer order", ORI-STUDIO-1H); it keeps the two from crossing nowhere, as
 * the engine does.
 *
 * Over the real engine and solve (`oristudio-fold-wasm`,
 * `oristudio-layer-spread-wasm`); skipped when the bridges have not been
 * built (a fresh worktree before `build:wasm`). CI builds them first.
 */
const ROOT = process.cwd();
const FOLD = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const SPREAD = resolve(ROOT, 'src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm');
const available = existsSync(FOLD) && existsSync(SPREAD);

async function bridges() {
  const fold = await import('../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  fold.initSync({ module: readFileSync(FOLD) });
  const spread = await import('../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm');
  spread.initSync({ module: readFileSync(SPREAD) });
  return { calls: createFoldEngineCalls(new fold.FoldEngine()), solve: spread.solve_layer_spread };
}

function landed(outcome: unknown): number {
  const result = outcome as FoldEngineOutcome<{ state: number }>;
  if (result.status !== 'ok') throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  return result.state;
}

/** Valley folds of the bottom and the left edge to the line `angle` above the bottom edge, the second off by `miss`. */
function kite(angle: number, miss: number) {
  const bottom = Math.tan(angle / 2);
  const left = 1 / Math.tan(Math.PI / 4 + (angle - miss) / 2);
  return [
    { kind: 'valley', line: { via: 'free', through: [[0, 0], [1, bottom]] }, moving: [0.99, 0.001], seed: { scope: 'all' }, landing: { kind: 'outer' } },
    { kind: 'valley', line: { via: 'free', through: [[0, 0], [left, 1]] }, moving: [0.001, 0.99], seed: { scope: 'all' }, landing: { kind: 'outer' } },
  ];
}

describe.skipIf(!available)('flaps the fold engine lays side by side', () => {
  it.each([5e-8, 5e-7, 9e-7])('spread by Default when one reaches %s over the other', async (miss) => {
    const { calls, solve } = await bridges();
    let state = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'back' }));
    for (const op of kite((41 * Math.PI) / 180, miss)) state = landed(calls.step(state, op as never, {} as never));
    const source = connectedSpreadSource(calls.scene(state) as FoldScene, true);
    // The base and two flaps: each flap is over the base, and neither over the other.
    expect(source.input.faces).toHaveLength(3);
    expect(source.input.orders).toHaveLength(2);
    expect(source.input.cells.every((cell) => cell.faces.length <= 2)).toBe(true);
    const solution = solve(source.input) as SpreadSolution;
    expect(validSolution(solution, source.input)).toBe(true);
  });
});
