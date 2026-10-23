import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEPTH_SPREAD, DEFAULT_LAYER_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { foldedDisplayLayers } from '../../cp-workspace/folded/foldedDisplayLayers';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { precreasedBaseStates } from '../engine/foldPrecreasedBase.fixtures';
import { foldPaneSpreadMap } from './foldPaneSpreadMap';

/**
 * A precrease folds nothing, so the spread folded pane must show the paper
 * after it exactly as before it (the open sink report, 2026-10-11): over the
 * real engine, in-process, the preliminary base and the same base precreased
 * across every layer, each point of the pane read back to the sheet point
 * drawn on top there. Skipped when the bridge has not been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

async function engine(): Promise<FoldEngineCalls> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return createFoldEngineCalls(new wasm.FoldEngine());
}

/** At a grid over the base, the sheet point the pane draws on top there, or null off the paper. */
function sheetPointsShown(map: NonNullable<ReturnType<typeof foldPaneSpreadMap>>): Array<readonly [number, number] | null> {
  const shown: Array<readonly [number, number] | null> = [];
  // Off any line a ring could have: the base spans x 0–1, y 0–0.5, and a spread moves it a little.
  for (let i = 0; i <= 60; i += 1) {
    for (let j = 0; j <= 40; j += 1) {
      shown.push(map.under({ x: -0.1 + i * 0.02 + 0.00123, y: -0.1 + j * 0.0175 + 0.00071 })?.sheet ?? null);
    }
  }
  return shown;
}

describe.skipIf(!available)('a precrease under the spread folded pane', () => {
  it('cuts the base’s layers in two, each pair one display layer', async () => {
    const calls = await engine();
    const states = precreasedBaseStates(calls);
    const [base, precreased] = [calls.scene(states[5]!), calls.scene(states[6]!)];
    expect(precreased.faces.length).toBe(2 * base.faces.length);
    expect(foldedDisplayLayers(precreased).layers).toHaveLength(base.faces.length);
    expect(precreased.faces.some((face) => face.edges.some((edge) => edge.kind === 'flat'))).toBe(true);
  });

  it.each([
    ['the default affine spread', DEFAULT_LAYER_SPREAD],
    ['the default depth spread', DEFAULT_DEPTH_SPREAD],
    ['a wide depth spread', { kind: 'depth', amount: 0.2, toward: 'down-left' } as LayerSpreadOptions],
    ['an affine spread held at the bottom', { ...DEFAULT_LAYER_SPREAD, keep: 'bottom', amount: 0.2 } as LayerSpreadOptions],
  ])('shows every point of the paper as it was before, with %s', async (_label, spread) => {
    const calls = await engine();
    const states = precreasedBaseStates(calls);
    const before = sheetPointsShown(foldPaneSpreadMap(calls.scene(states[5]!), spread)!);
    const after = sheetPointsShown(foldPaneSpreadMap(calls.scene(states[6]!), spread)!);
    expect(before.filter(Boolean).length).toBeGreaterThan(500);
    const moved = before.flatMap((point, k) => {
      const now = after[k]!;
      if (point === null || now === null) return point === now ? [] : [k];
      return Math.hypot(point[0] - now[0], point[1] - now[1]) <= 1e-9 ? [] : [k];
    });
    expect(moved).toEqual([]);
  });
});
