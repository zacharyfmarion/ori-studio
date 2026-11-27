import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpreadInput } from '@oristudio/layer-spread';
import { spreadRefusalOf, spreadUnavailable, spreadUnavailableError } from './spreadRefusal';

/**
 * What the spread worker makes of the solve's failures, over the real bridge
 * (`oristudio-layer-spread-wasm`): a model past the solve's resource limits
 * (`SpreadError::Limit`) is a refusal by its kind, named by the bridge's code
 * rather than its message; geometry the solve finds inconsistent, or input
 * it cannot read, is not. Skipped when the bridge has not been built (a
 * fresh worktree before `build:wasm`); CI builds it first.
 */
const SPREAD = resolve(process.cwd(), 'src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm');

async function solve() {
  const spread = await import('../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm');
  spread.initSync({ module: readFileSync(SPREAD) });
  return spread.solve_layer_spread;
}

/** What the worker posts, and the lease's error, for what the solve threw on `input`. */
async function failure(input: unknown) {
  const solveLayerSpread = await solve();
  let thrown: unknown = null;
  try {
    solveLayerSpread(input);
  } catch (error) {
    thrown = error;
  }
  const posted = spreadUnavailable(thrown);
  return { thrown, posted, error: spreadUnavailableError(posted) };
}

const triangle: SpreadInput = {
  xy: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  faces: [[0, 1, 2]],
  triangles: [[0, 1, 2]],
  triangleFaces: [0],
  orders: [],
  cells: [],
};

describe.skipIf(!existsSync(SPREAD))('the spread solve’s failures, as the worker posts them', () => {
  it('names a model past the solve’s resource limits a refusal, by the bridge’s code', async () => {
    const xy = Array.from({ length: 20_001 }, (_, k): [number, number] => [k / 20_001, 0]);
    const { thrown, posted, error } = await failure({ ...triangle, xy });
    expect(thrown).toEqual({ code: 'spread_limit', message: 'Spread resource limit exceeded: material topology' });
    expect(posted).toEqual({ message: 'Spread resource limit exceeded: material topology', refusal: 'resource_limit' });
    expect(spreadRefusalOf(error)).toBe('resource_limit');
  });

  it('keeps inconsistent geometry and unreadable input errors', async () => {
    const inconsistent = await failure({ ...triangle, xy: [[0, 0], [1, 0], [0, 11]] });
    expect(inconsistent.thrown).toEqual({ code: 'spread_invalid', message: 'Invalid spread geometry: coordinates or face rings' });
    expect(inconsistent.posted).toEqual({ message: 'Invalid spread geometry: coordinates or face rings' });
    expect(spreadRefusalOf(inconsistent.error)).toBeNull();

    const unreadable = await failure({});
    expect(unreadable.thrown).toMatchObject({ code: 'spread_input' });
    expect(unreadable.posted.message).toMatch(/^Invalid spread input: /);
    expect(spreadRefusalOf(unreadable.error)).toBeNull();
  });
});
