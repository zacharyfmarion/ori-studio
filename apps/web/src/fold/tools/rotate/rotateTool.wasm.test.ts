import { normalizeFoldLandingOp } from '../../document/foldLandingMigration';
import type { FoldStep } from '../../document/foldSequenceDocument';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../../i18n';
import { turnName } from '../../../lib/steps/turnWords';
import { foldSessionDocumentSource } from '../../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../../store/workspaceStore/store';
import { foldNodeDigest } from '../../document/foldDigest';
import { isLockedStep, turnKindOf, type FoldOp, type FoldRotateOp } from '../../document/foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from '../../document/foldSequenceFile';
import { createFoldEngineCalls } from '../../engine/foldEngineCalls';
import { foldSentenceStepOf } from '../../sequence/foldSentenceStep';
import { createFoldSession, type FoldSession } from '../../session/foldSession';
import { inProcessFoldRuntime, settle } from '../../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../../session/foldSessionState';
import { foldStepSentence } from '../../stepSentence';
import { rotateStepOp } from './rotateTool';

/**
 * The Rotate tool's turn through the real bridge, in-process: previewed as
 * the tool previews it (the session's pending step), by a preset and by an
 * exact angle, then applied, stored, written, read back and replayed into a
 * fresh engine — and named as the Step pane and the Diagram name it.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);
const t = i18n.t.bind(i18n);

const BOOK: FoldOp = {
  kind: 'valley',
  line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
  moving: [0.75, 0.5],
  seed: { scope: 'all' },
};

async function bridge() {
  const wasm = await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return inProcessFoldRuntime(() => createFoldEngineCalls(new wasm.FoldEngine()), wasm.fold_engine_version());
}

const state = () => useWorkspaceStore.getState();
const shown = () => state().foldSequences[0]!.document;

let session: FoldSession;
let runtime: Awaited<ReturnType<typeof bridge>>;

/** The view's rotation a preview of `op` lands, from the book: radians, counter-clockwise. */
async function previewRotation(op: FoldOp): Promise<number> {
  const landed = await session.preview(op);
  if (landed.status !== 'landed') throw new Error(JSON.stringify(landed));
  return landed.summary.view.rotation;
}

describe.skipIf(!available)('the Rotate tool over the real bridge', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    runtime = await bridge();
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime });
    session.retain();
    await settle();
    await session.commitStep(BOOK);
    await settle();
  });

  afterEach(() => {
    session.dispose();
  });

  it('previews a preset and an exact angle, either way round, as the engine turns the view', async () => {
    expect(await previewRotation(rotateStepOp({ amount: 'eighth', direction: 'ccw' }))).toBeCloseTo(Math.PI / 4, 12);
    expect(await previewRotation(rotateStepOp({ amount: 'quarter', direction: 'cw' }))).toBeCloseTo(-Math.PI / 2, 12);
    expect(await previewRotation(rotateStepOp({ amount: 'degrees', degrees: 30, direction: 'cw' }))).toBeCloseTo(-Math.PI / 6, 12);
    expect(await previewRotation(rotateStepOp({ amount: 'degrees', degrees: 22.5, direction: 'ccw' }))).toBeCloseTo(Math.PI / 8, 12);
    // A turn moves no paper: the landed state folds nothing new.
    const landed = await session.preview(rotateStepOp({ amount: 'degrees', degrees: 30, direction: 'cw' }));
    expect(landed.status === 'landed' && landed.summary).toMatchObject({ faces: 2, step: 2 });
  });

  it('applies an exact angle as a step that writes, reads back, replays and is named by its degrees', async () => {
    const op = rotateStepOp({ amount: 'degrees', degrees: 30, direction: 'cw' });
    await previewRotation(op);
    const committed = await session.commitStep(op);
    expect(committed.status).toBe('committed');
    await settle();
    const node = selectFoldCursorNode(session.store.getState());
    expect(node.status).toBe('ok');
    expect(node.summary?.view.rotation).toBeCloseTo(-Math.PI / 6, 12);

    // Stored as the shared turn type spells it, and written with its degrees between.
    const document = shown();
    const step = document.steps.at(-1)!;
    expect(isLockedStep(step) ? null : step.op).toEqual(op);
    const written = JSON.parse(JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null })));
    expect(written.steps.at(-1).op).toEqual({ kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } });
    const read = readFoldSequence(written)!;
    expect(read.document).toEqual({ ...document, steps: document.steps.map((s) => ({ ...s, op: normalizeFoldLandingOp((s as FoldStep).op) })) });
    expect(foldNodeDigest(read.document, step.id)).toBe(foldNodeDigest(document, step.id));

    // Replayed into a fresh engine at the state it was committed at.
    const fingerprint = node.fingerprint;
    runtime.lose('crashed');
    await settle();
    expect(selectFoldCursorNode(session.store.getState())).toMatchObject({ status: 'ok', fingerprint });

    // Named by its degrees in the Step pane's sentence and on the Diagram's turn card.
    const sentence = foldStepSentence(t, foldSentenceStepOf(op, { parent: null, child: null, report: null }));
    expect(sentence).toBe('Rotate 30° clockwise.');
    expect(turnName(turnKindOf(op as FoldRotateOp), t)).toBe('Rotate 30° clockwise');
  });
});
