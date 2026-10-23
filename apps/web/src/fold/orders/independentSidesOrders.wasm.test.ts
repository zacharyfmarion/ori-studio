import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { createFoldReplayer } from '../document/foldReplay';
import { isLockedStep, type FoldOp, type FoldSequenceDocument } from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import { createFoldEnginePort, type FoldEngineSource } from '../engine/foldEnginePort';

/**
 * A KNOWN GAP, kept for the fix after the launch (see
 * `tests/fixtures/fold-regressions/README.md`): the fixture is a square with
 * two flaps folded in at the bottom left and the same mirrored at the top
 * right. Folding the bottom-right corner up along x - y = 9/16 lands across
 * both sides, and each side can take the corner three ways (under both of its
 * flaps, between them, or on top): nine orders. The chooser builds its list
 * from tuck recipes, each of which pins one side, so it lists six and never
 * both sides between. A listing of every flat stacking was tried and
 * reverted: it also offered stackings a fold cannot reach by moving. The fix
 * is to combine, side by side, the orders the motion reaches.
 *
 * Skipped when the bridge has not been built; CI builds it first.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const FIXTURE = resolve(ROOT, '../../tests/fixtures/fold-regressions/independent-sides-orders.osf');
const available = existsSync(WASM) && existsSync(FIXTURE);

/** The fold over both sides: the bottom-right corner onto (9/16, 7/16), only that corner's flap. */
const ACROSS_BOTH: FoldOp = {
  kind: 'valley',
  line: {
    via: 'axiom',
    axiom: 2,
    inputs: [
      { kind: 'point', at: [1, 0] },
      { kind: 'point', at: [0.5625, 0.4375] },
    ],
  },
  seed: { scope: 'flaps', at: [[0.8125, 0.125]] },
};
const ROOT_LINE = { n: [Math.SQRT1_2, -Math.SQRT1_2] as [number, number], d: 0.397747564417433 };

async function ordersListed(): Promise<{ orders: number; exact: boolean }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const raw = new wasm.FoldEngine();
  const calls: FoldEngineCalls & FoldEngineCompoundCalls = { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
  const source: FoldEngineSource = {
    generation: () => 0,
    sheet: async (paper) => calls.sheet(paper),
    step: async (state, op, choices) => calls.step(state, op, choices),
    release: async (states) => calls.release(states),
  };
  const project = parseNativeProjectFile(readFileSync(FIXTURE, 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  const document = held?.document as FoldSequenceDocument;
  const done = await createFoldReplayer(createFoldEnginePort(source, wasm.fold_engine_version())).run({ loadId: 1, sequence: document });
  if (!done) throw new Error('superseded');
  const last = document.steps.at(-1)!;
  if (isLockedStep(last)) throw new Error('locked');
  const parent = done.steps.get(last.id)?.state?.id;
  if (parent === undefined) throw new Error('no state');
  // Search until the chooser says its list is complete, as Find more orders would.
  let answer = calls.orderSelection(parent, ACROSS_BOTH, { root: ROOT_LINE }, { index: 0, searchMs: 2_000 });
  for (let press = 0; answer.status === 'ok' && !answer.count.exact && press < 6; press++)
    answer = calls.orderSelection(parent, ACROSS_BOTH, { root: ROOT_LINE }, { index: 0, searchMs: 8_000 });
  if (answer.status !== 'ok') throw new Error(JSON.stringify(answer));
  return answer.count;
}

describe.skipIf(!available)('a fold over two independent sides (known gap)', () => {
  it('lists the six orders the tuck recipes reach, today', async () => {
    expect(await ordersListed()).toEqual({ orders: 6, exact: true });
  });

  // Fails until the chooser combines each side's reachable orders; then flip it to `it`.
  it.fails('lists all nine, each side its three ways', async () => {
    expect((await ordersListed()).orders).toBe(9);
  });
});
