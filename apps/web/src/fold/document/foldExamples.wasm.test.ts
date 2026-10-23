import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEnginePort, type FoldEngineSource } from '../engine/foldEnginePort';
import { createFoldReplayer } from './foldReplay';
import {
  isLockedStep,
  isSwivelEdgeOp,
  isSwivelOnFoldOp,
  swivelKindOf,
  type FoldSequenceDocument,
  type FoldStep,
} from './foldSequenceDocument';
import { readFoldSequences } from './foldSequenceFile';

/**
 * The example projects in `tests/fixtures/fold-examples` — a petal fold to
 * the bird base, a swivel by its edge, a swivel on a folded edge open and
 * inside, an inside and an outside crimp — each built
 * through the real Fold tools and saved with File ▸ Save (see the folder's
 * README for the clicks). Each must open as the app reads a project and
 * replay every step to `ok` through the real bridge: none broken, locked or
 * changed, so the examples still show what their notes say after an engine
 * change, or say so here first.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const EXAMPLES = resolve(ROOT, '../../tests/fixtures/fold-examples');
const available = existsSync(WASM) && existsSync(EXAMPLES);

/**
 * The bird base's faces: 20, each petal fold's hinge creased through the top
 * layer it lifts alone — four fewer than with the hinge precreased through
 * every layer first, which split the layers below it too.
 */
const BIRD_FACES = 20;

async function engine(): Promise<{ calls: FoldEngineCalls; version: number }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return { calls: createFoldEngineCalls(new wasm.FoldEngine()), version: wasm.fold_engine_version() };
}

function sourceOf(calls: FoldEngineCalls): FoldEngineSource {
  return {
    generation: () => 0,
    sheet: async (paper) => calls.sheet(paper),
    step: async (state, op, choices) => calls.step(state, op, choices),
    release: async (states) => calls.release(states),
  };
}

/** The one sequence a saved example holds, read as the app opens a project. */
function opened(name: string): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(resolve(EXAMPLES, name), 'utf8'));
  const sequences = readFoldSequences(project.workspace.foldSequences);
  expect(sequences, name).toHaveLength(1);
  const [held] = sequences;
  if (!held) throw new Error(`${name}: no sequence`);
  expect(held.readOnlyRaw, name).toBeNull();
  return held.document;
}

function steps(document: FoldSequenceDocument): FoldStep[] {
  return document.steps.map((node) => {
    if (isLockedStep(node)) throw new Error(`${document.title}: ${node.id} is locked`);
    return node;
  });
}

describe.skipIf(!available)('the Fold example projects', () => {
  it('holds the five examples the README names, and nothing else', () => {
    expect(
      readdirSync(EXAMPLES)
        .filter((name) => name.endsWith('.osf'))
        .sort()
    ).toEqual(['crimp.osf', 'petal-fold.osf', 'swivel-fold.osf', 'swivel-inside.osf', 'swivel-on-edge.osf']);
  });

  it.each(['petal-fold.osf', 'swivel-fold.osf', 'swivel-on-edge.osf', 'swivel-inside.osf', 'crimp.osf'])(
    'opens %s and replays every step to ok, each with the note that says how it was made',
    async (name) => {
      const document = opened(name);
      const { calls, version } = await engine();
      const replayed = await createFoldReplayer(createFoldEnginePort(sourceOf(calls), version)).run({
        loadId: 1,
        sequence: document,
      });
      if (!replayed) throw new Error(`${name}: the replay was superseded`);
      expect(replayed.done).toBe(true);
      expect(replayed.sheet.status).toBe('ok');
      for (const step of steps(document)) {
        const node = replayed.steps.get(step.id);
        expect(node?.status, `${name} ${step.id} ${step.op.kind} ${JSON.stringify(node?.refusal)}`).toBe('ok');
        // Committed with its fingerprint, so drift would read as changed rather than pass.
        expect(step.expect, `${name} ${step.id}`).toMatch(/^fs1:/);
        expect(step.note?.trim().length ?? 0, `${name} ${step.id} has no note`).toBeGreaterThan(0);
      }
    }
  );

  it('shows each tool as its README says: the bird base, a swivel by its edge both ways, a swivel on a folded edge open and inside, an inside and an outside crimp', async () => {
    const { calls, version } = await engine();
    const replay = async (document: FoldSequenceDocument) => {
      const done = await createFoldReplayer(createFoldEnginePort(sourceOf(calls), version)).run({
        loadId: 1,
        sequence: document,
      });
      if (!done) throw new Error('superseded');
      return done;
    };

    // Two squashes to the preliminary base, the kites precreased, two petal
    // folds by their hinges' two endpoints to the bird base: no hinge precrease.
    const petal = opened('petal-fold.osf');
    const petalSteps = steps(petal);
    expect(petalSteps.map((step) => step.op.kind)).toEqual([
      'valley',
      'valley',
      'squash',
      'turn',
      'squash',
      'precrease',
      'precrease',
      'petal',
      'turn',
      'precrease',
      'precrease',
      'petal',
    ]);
    const petals = petalSteps.flatMap((step) => (step.op.kind === 'petal' ? [step.op] : []));
    expect(petals.map((op) => ('ends' in op ? 'ends' : 'crease'))).toEqual(['ends', 'ends']);
    const last = petalSteps.at(-1);
    const bird = last && (await replay(petal)).steps.get(last.id)?.state;
    if (!bird) throw new Error('the bird base did not land');
    expect(calls.summary(bird.id).faces).toBe(BIRD_FACES);

    // The diagonal precreased, then two branches from it: the bottom edge
    // swivelled onto it about one pivot, its ridge square to the edge, then
    // toward its end (stored as the ridge taken).
    const [diagonal, ...swivels] = steps(opened('swivel-fold.osf'));
    expect(diagonal?.op.kind).toBe('precrease');
    expect(swivels.map((step) => [step.parent, step.op.kind])).toEqual([
      [diagonal?.id, 'swivel'],
      [diagonal?.id, 'swivel'],
    ]);
    const edgeOps = swivels.map((step) => (isSwivelEdgeOp(step.op) ? step.op : null));
    expect(edgeOps.every((op) => op?.target.via === 'crease')).toBe(true);
    expect(edgeOps.map((op) => (op && 'ridge' in op && op.ridge ? 'end' : 'foot'))).toEqual(['foot', 'end']);

    // The owner's squashed preliminary base, then Abrashi's swivel: its
    // creases meet on the kite's upper-left edge, a folded edge.
    const onEdge = opened('swivel-on-edge.osf');
    const onEdgeSteps = steps(onEdge);
    expect(onEdgeSteps.map((step) => step.op.kind)).toEqual([
      'valley',
      'precrease',
      'inside-reverse',
      'inside-reverse',
      'rotate',
      'squash',
      'swivel',
    ]);
    const swivelled = onEdgeSteps.at(-1);
    expect(swivelled && isSwivelOnFoldOp(swivelled.op)).toBe(true);
    const swivelledState = swivelled && (await replay(onEdge)).steps.get(swivelled.id)?.state;
    if (!swivelledState) throw new Error('the swivel on the folded edge did not land');
    expect(calls.summary(swivelledState.id).faces).toBe(14);

    // The same squash, then Abrashi's inside swivel, his figure 2: the same
    // clicks, Kind Inside. The same steps before it, and a step that differs
    // only by its kind; it lands with the same faces, in another order.
    const tuckedIn = opened('swivel-inside.osf');
    const insideSteps = steps(tuckedIn);
    expect(insideSteps.map((step) => step.expect)).toEqual([
      ...onEdgeSteps.slice(0, -1).map((step) => step.expect),
      expect.stringMatching(/^fs1:/),
    ]);
    const tucked = insideSteps.at(-1);
    if (!tucked || !swivelled || !isSwivelOnFoldOp(tucked.op) || !isSwivelOnFoldOp(swivelled.op)) {
      throw new Error('the last step is no swivel on a folded edge');
    }
    expect(tucked.op.swivel).toBe('inside');
    expect(swivelKindOf(tucked.op)).toBe('inside');
    expect(swivelKindOf(swivelled.op)).toBe('open');
    expect(tucked.expect).not.toBe(swivelled.expect);
    const tuckedState = (await replay(tuckedIn)).steps.get(tucked.id)?.state;
    if (!tuckedState) throw new Error('the inside swivel did not land');
    expect(calls.summary(tuckedState.id).faces).toBe(14);

    // The book fold, then two branches from it: the inside crimp and the outside.
    const [book, inside, outside] = steps(opened('crimp.osf'));
    expect(book?.op.kind).toBe('valley');
    expect([inside?.parent, outside?.parent]).toEqual([book?.id, book?.id]);
    expect([inside?.op, outside?.op]).toMatchObject([
      { kind: 'crimp', crimp: 'inside' },
      { kind: 'crimp', crimp: 'outside' },
    ]);
  });
});
