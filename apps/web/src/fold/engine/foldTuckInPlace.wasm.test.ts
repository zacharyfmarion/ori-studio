import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import { SQUARE_PAPER, isLockedStep, type FoldChoices, type FoldOp, type FoldPlainOp } from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import type { FoldEngineOutcome } from './foldEngineWire';

/**
 * A flap tucked in place over the real bridge, in-process: a valley along a
 * flap's folded edge lists the flap tucked under another layer with no new
 * crease (`landing: { kind: 'in_place' }`), that landing commits, crosses the
 * project file as it is stored, and replays to the same fingerprint; asked
 * for its own orders, it explores only its order, never the fold's other
 * landings. Two strips on a square: the bottom one up, the top one down over
 * it, the top one tucked under the bottom one by its hinge.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const FOLD_WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(FOLD_WASM);

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

/** A step through the document's own file format: written, read back, its op and choices as replay gets them. */
function throughTheFile(op: FoldOp, choices?: FoldChoices): { op: FoldOp; choices?: FoldChoices } {
  const written = writeFoldSequence({
    document: { formatVersion: 1, id: 'fold-a', title: '', paper: SQUARE_PAPER, steps: [{ id: 'a', parent: null, op, ...(choices ? { choices } : {}) }] },
    readOnlyRaw: null,
  });
  const [step] = readFoldSequence(JSON.parse(JSON.stringify(written)))?.document.steps ?? [];
  if (!step || isLockedStep(step)) throw new Error('the step did not read back');
  return { op: step.op, ...(step.choices ? { choices: step.choices } : {}) };
}

/** The top strip's hinge, the flap picked on it (sheet y > 0.65 lies below the line once folded). */
const TOP_STRIP: FoldPlainOp = {
  kind: 'valley',
  line: { via: 'free', through: [[0.2, 0.65], [0.8, 0.65]] },
  moving: [0.5, 0.8],
  seed: { scope: 'flaps', at: [[0.5, 0.8]] },
};

describe.skipIf(!available)('a flap tucked in place over the bridge', () => {
  let calls: FoldEngineCalls;
  let orders: FoldEngineCompoundCalls;
  let strips: number;

  beforeAll(async () => {
    const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    wasm.initSync({ module: readFileSync(FOLD_WASM) });
    const fold = new wasm.FoldEngine();
    calls = createFoldEngineCalls(fold);
    orders = createFoldEngineCompoundCalls(fold);
    const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
    const up = landed(calls.step(sheet, { kind: 'valley', line: { via: 'free', through: [[0, 0.3], [1, 0.3]] }, moving: [0.5, 0.1], seed: { scope: 'all' } })).state;
    strips = landed(calls.step(up, { kind: 'valley', line: { via: 'free', through: [[0, 0.65], [1, 0.65]] }, moving: [0.5, 0.9], seed: { scope: 'all' } })).state;
  });

  it('lists the tuck in place beside the fold, commits it, and replays it from the file', () => {
    const first = landed(orders.orderSelection(strips, TOP_STRIP, undefined, { index: 0, batch: 0 }));
    expect(first.count).toEqual({ orders: 2, exact: true });
    const listed = Array.from({ length: first.count.orders }, (_, index) =>
      landed(orders.orderSelection(strips, TOP_STRIP, undefined, { index, batch: 0 }))
    );
    const inPlace = listed.find((selection) => selection.landing?.kind === 'in_place');
    expect(inPlace?.landing).toMatchObject({ kind: 'in_place', moves: 'flap' });
    // The flap the fold along its hinge would lay out flat: the same paper moves.
    expect(inPlace?.moving_varies).toBeFalsy();
    const op: FoldOp = { ...TOP_STRIP, landing: inPlace!.landing! };
    const choices = inPlace!.completion ? { completion: inPlace!.completion } : undefined;
    const folded = landed(calls.step(strips, op, choices));
    // No new crease: the same creases, folded and flat, as its parent.
    expect(calls.summary(folded.state).creases).toEqual(calls.summary(strips).creases);
    const stored = throughTheFile(op, choices);
    expect(stored.op).toEqual(op);
    expect(landed(calls.step(strips, stored.op, stored.choices)).fingerprint).toBe(folded.fingerprint);
    // Its own orders are the tuck's alone.
    expect(landed(orders.orderSelection(strips, op, choices, { index: 0, batch: 0 })).count).toEqual({ orders: 1, exact: true });
  });

  it('refuses a landing in place along a line no fold of the flap runs along', () => {
    const op: FoldOp = {
      kind: 'valley',
      line: { via: 'free', through: [[0.2, 0.5], [0.8, 0.5]] },
      moving: [0.5, 0.9],
      seed: { scope: 'flaps', at: [[0.5, 0.9]] },
      landing: { kind: 'in_place', targets: [[0.5, 0.15]], moves: 'flap' },
    };
    const outcome = calls.step(strips, op);
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') expect(outcome.refusal.code).toBe('tuck_not_at_fold');
  });
});
