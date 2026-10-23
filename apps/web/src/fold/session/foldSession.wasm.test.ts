import { DEFAULT_LAYER_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import type { FoldMark, FoldOp, FoldReturnOp, FoldSequenceDocument } from '../document/foldSequenceDocument';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { createFoldSession, type FoldSession } from './foldSession';
import { inProcessFoldRuntime, settle } from './foldSession.fixtures';
import { selectFoldCursorNode } from './foldSessionState';

/**
 * The Fold session over the real bridge, in-process — exactly the calls the
 * worker runs, minus comlink — and the real Fold slice: the engine's
 * kite-base classic folded as a user folds it, previewed and committed step
 * by step, then undone, redone, and replayed into a fresh engine.
 *
 * The classic's fixture (`crates/oristudio-fold/tests/classics.rs`) records
 * its folds as model lines; here each is the document's free line through two
 * sheet points on it, with a sheet point on the moving side, as the tools
 * store them. Every one of those points lies in paper that has not moved, so
 * its sheet and model positions agree.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const KITE = resolve(ROOT, '../../crates/oristudio-fold/tests/fixtures/classics/kite-base.json');
const available = existsSync(WASM) && existsSync(KITE);

const T = Math.tan(Math.PI / 8);

/** The kite base: precrease the diagonal, then fold each lower edge to it. */
const KITE_STEPS: FoldOp[] = [
  {
    kind: 'precrease',
    direction: 'valley',
    line: { via: 'free', through: [[0, 0], [1, 1]] },
    moving: [0.75, 0.25],
    seed: { scope: 'all' },
  },
  { kind: 'valley', line: { via: 'free', through: [[0, 0], [1, T]] }, moving: [0.9, 0.1], seed: { scope: 'all' } },
  { kind: 'valley', line: { via: 'free', through: [[0, 0], [T, 1]] }, moving: [0.1, 0.9], seed: { scope: 'all' } },
];

const TURN_OVER: FoldOp = { kind: 'turn', axis: 'vertical' };

interface Recorded {
  faces: number;
  pairs: number;
}

/** What the classic's fixture records for its first steps. */
function recorded(): Recorded[] {
  const fixture = JSON.parse(readFileSync(KITE, 'utf8')) as { steps: [unknown, Recorded][] };
  return fixture.steps.slice(0, KITE_STEPS.length).map(([, { faces, pairs }]) => ({ faces, pairs }));
}

async function bridge() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return inProcessFoldRuntime(() => createFoldEngineCalls(new wasm.FoldEngine()), wasm.fold_engine_version());
}

const state = () => useWorkspaceStore.getState();

let session: FoldSession;
let runtime: Awaited<ReturnType<typeof bridge>>;

const snapshot = () => session.store.getState();
const cursor = () => selectFoldCursorNode(snapshot());
const statuses = () => [...snapshot().nodes.values()].map((node) => node.status);

describe.skipIf(!available)('the Fold session over the real bridge', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    runtime = await bridge();
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime });
    session.retain();
    await settle();
  });

  afterEach(() => {
    session.dispose();
  });

  it('appends a return, adopts its preview, preserves branches, and reopens it in a fresh engine', async () => {
    for (const op of KITE_STEPS) expect((await session.commitStep(op)).status).toBe('committed');
    await settle();
    const old = snapshot().sequence!;
    const source = cursor();
    const target = old.steps[0]!.id;
    const op: FoldReturnOp = { kind: 'unfold-to', target, source: {
      path: source.path!, state: source.fingerprint!, targetState: snapshot().nodes.get(target)!.fingerprint!,
    } };
    const preview = await session.preview(op);
    expect(preview.status).toBe('landed');
    if (preview.status !== 'landed') throw new Error(JSON.stringify(preview));
    expect(preview.summary.faces).toBe(source.summary!.faces);
    const saved = await session.commitStep(op);
    expect(saved.status).toBe('committed');
    await settle();
    expect(cursor().state).toEqual(preview.state);
    expect(snapshot().sequence!.steps.slice(0, 3)).toEqual(old.steps);
    const fingerprint = cursor().fingerprint;
    expect(state().undoFold()).toBe(true);
    await settle();
    expect(snapshot().sequence!.steps).toEqual(old.steps);
    expect(state().redoFold()).toBe(true);
    await settle();
    expect(cursor().fingerprint).toBe(fingerprint);
    const file = writeFoldSequence({ document: snapshot().sequence!, readOnlyRaw: null });
    const reopened = readFoldSequence(JSON.parse(JSON.stringify(file)))!;
    expect(reopened.document.steps.at(-1)!.op).toEqual(op);
    state().installFoldSequences([reopened], null);
    runtime.lose('crashed');
    await settle(12);
    expect(statuses()).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect([...snapshot().nodes.values()].at(-1)!.fingerprint).toBe(fingerprint);
    const sourceId = old.steps.at(-1)!.id;
    state().moveFoldCursor(sourceId);
    await settle();
    expect((await session.commitStep(TURN_OVER)).status).toBe('committed');
    await settle();
    expect(snapshot().sequence!.steps.filter((n) => n.parent === sourceId)).toHaveLength(2);
  });

  it('refuses a stale return and lets an explicit rebuild keep its ID and annotations', async () => {
    for (const op of KITE_STEPS) await session.commitStep(op);
    await settle();
    const source = cursor();
    const op: FoldReturnOp = { kind: 'unfold-to', target: null, source: {
      path: source.path!, state: source.fingerprint!, targetState: snapshot().sheet.fingerprint!,
    } };
    const committed = await session.commitStep(op);
    if (committed.status !== 'committed') throw new Error(committed.status);
    await settle();
    const doc = snapshot().sequence!;
    const changed = { ...doc, steps: doc.steps.map((n) => n.id === committed.stepId && n.op
      ? { ...n, note: 'Keep my annotation', op: { ...op, source: { ...op.source, state: 'fs1:stale' } } } : n) };
    state().installFoldSequences([{ document: changed, readOnlyRaw: null }], null);
    await settle();
    expect(snapshot().nodes.get(committed.stepId)).toMatchObject({ status: 'broken', refusal: { code: 'return_source_changed' } });
    const expected = changed.steps.at(-1)!.op as FoldReturnOp;
    expect(state().updateFoldReturn(committed.stepId, expected, op, committed.fingerprint)).toBe(true);
    await settle();
    expect(snapshot().nodes.get(committed.stepId)?.status).toBe('ok');
    expect(snapshot().sequence!.steps.at(-1)).toMatchObject({ id: committed.stepId, note: 'Keep my annotation' });
  });

  it('folds the kite base as a user does, to the outcomes the classic records', async () => {
    expect(snapshot().sheet).toMatchObject({ status: 'ok', summary: { faces: 1, step: 0 } });

    for (const [k, op] of KITE_STEPS.entries()) {
      const where = `step ${k + 1}`;
      const preview = await session.preview(op);
      if (preview.status !== 'landed') throw new Error(`${where}: ${JSON.stringify(preview)}`);
      expect(preview.summary, where).toMatchObject(recorded()[k]!);
      const committed = await session.commitStep(op);
      if (committed.status !== 'committed') throw new Error(`${where}: ${committed.status}`);
      await settle();
      // The step on screen is the state the preview showed, at the fingerprint it was committed at.
      expect(cursor(), where).toMatchObject({
        status: 'ok',
        state: preview.state,
        fingerprint: committed.fingerprint,
      });
      expect(cursor().summary, where).toMatchObject({ ...recorded()[k], step: k + 1 });
    }

    // A step committed without a preview: the turn over.
    const turned = await session.commitStep(TURN_OVER);
    expect(turned.status).toBe('committed');
    await settle();
    expect(cursor().summary?.view.flipped).toBe(true);
    expect(cursor().report).toBeNull();
    expect(statuses()).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(snapshot().progress).toMatchObject({ done: true, activeSettled: 4, activeTotal: 4 });
  });

  it('undoes and redoes without folding, and replays every step into a fresh engine at the state it expects', async () => {
    for (const op of KITE_STEPS) await session.commitStep(op);
    await settle();
    const fingerprints = [...snapshot().nodes.values()].map((node) => node.fingerprint);
    const live = runtime.engine().live();

    expect(state().undoFold()).toBe(true);
    await settle();
    expect(snapshot().cursor).toBe(snapshot().activePath[1]);
    expect(state().redoFold()).toBe(true);
    await settle();
    expect(cursor().summary).toMatchObject(recorded()[2]!);
    // Undo and redo were served from the cache.
    expect(runtime.engine().live()).toBe(live);

    runtime.lose('crashed');
    expect(statuses()).toEqual(['pending', 'pending', 'pending']);
    await settle();
    // Not `changed`: the new engine landed each step at the fingerprint it was committed at.
    expect(statuses()).toEqual(['ok', 'ok', 'ok']);
    expect([...snapshot().nodes.values()].map((node) => node.fingerprint)).toEqual(fingerprints);
    expect(cursor().state?.generation).toBe(1);
  });

  it('keeps every node, and so the motion built from it, through an edit of how a step is shown', async () => {
    for (const op of KITE_STEPS) await session.commitStep(op);
    await settle();
    const nodes = snapshot().nodes;
    const [first, second] = [...nodes.keys()];
    const mark: FoldMark = { id: 'fmark-1', from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 3 } };
    expect(state().setFoldMarks(first!, [mark])).toBe(true);
    await settle();
    expect(state().setFoldStepSpread(second!, DEFAULT_LAYER_SPREAD)).toBe(true);
    await settle();
    // The replay each edit asks for lands the same paths at the same states:
    // the session hands out the very nodes, reports and compounds it had.
    expect(snapshot().sequence?.steps[0]).toMatchObject({ marks: [mark] });
    expect(snapshot().nodes).toBe(nodes);
    for (const [id, node] of nodes) expect(snapshot().nodes.get(id), id).toBe(node);
  });

  it('marks drift as changed and a step that no longer resolves as broken, with the engine’s code', async () => {
    const steps: FoldSequenceDocument['steps'] = [
      { id: 'fstep-a', parent: null, op: KITE_STEPS[0]!, expect: 'fs1:0000000000000000' },
      { id: 'fstep-b', parent: 'fstep-a', op: KITE_STEPS[1]! },
      // No crease runs through this point of the sheet.
      {
        id: 'fstep-c',
        parent: 'fstep-a',
        op: { kind: 'refold', crease: [0.3, 0.6], direction: 'valley', moving: [0.1, 0.9], seed: { scope: 'all' } },
      },
      { id: 'fstep-d', parent: 'fstep-c', op: TURN_OVER },
    ];
    const document: FoldSequenceDocument = {
      formatVersion: 1,
      id: 'fold-drift',
      title: '',
      paper: { shape: { kind: 'square' }, startSide: 'front' },
      steps,
    };
    state().installFoldSequences([{ document, readOnlyRaw: null }], null);
    await settle();
    const node = (id: string) => snapshot().nodes.get(id);
    expect(node('fstep-a')?.status).toBe('changed');
    expect(node('fstep-b')?.status).toBe('ok');
    expect(node('fstep-c')).toMatchObject({ status: 'broken', refusal: { at: 'fstep-c', code: 'crease_not_found' } });
    expect(node('fstep-d')).toMatchObject({ status: 'broken', refusal: { at: 'fstep-c' } });
  });
});
