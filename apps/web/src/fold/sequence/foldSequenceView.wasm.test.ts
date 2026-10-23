import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import type { FoldOp } from '../document/foldSequenceDocument';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import type { FoldAxiomLine, FoldScene } from '../engine/foldEngineWire';
import { createFoldSession, type FoldSession, type FoldStateCall } from '../session/foldSession';
import { inProcessFoldRuntime, settle } from '../session/foldSession.fixtures';
import { foldStepSentence } from '../stepSentence';
import { creaseDiffLines } from '../stepWords';
import { foldNodeSentenceStep } from './foldSentenceStep';
import { foldStateFrame, type FoldStateFrame } from './foldStateFrame';
import { foldCreaseDiff } from './foldStepDiff';

/**
 * The sequence chrome's reading of real states: the session over the real
 * bridge, in-process, and the real Fold slice — what the strip and the Step
 * pane say of a step, from the scenes and summaries the engine
 * actually gives.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);
const t = i18n.t.bind(i18n);

/** O2, the bottom-right corner onto the top-left: the corner the axiom carries is its first input. */
const CORNER_TO_CORNER: FoldAxiomLine = {
  via: 'axiom',
  axiom: 2,
  inputs: [
    { kind: 'point', at: [1, 0] },
    { kind: 'point', at: [0, 1] },
  ],
};

/** The book fold: x = 0.5, the right half over the left. */
const BOOK: FoldOp = {
  kind: 'valley',
  line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
  moving: [0.75, 0.5],
  seed: { scope: 'all' },
};

const askScene: FoldStateCall<FoldScene> = (engine, state) => engine.scene(state);

let session: FoldSession;

async function frameOf(id: string | null): Promise<FoldStateFrame> {
  const answer = await session.withNode(id, askScene);
  if (answer.status !== 'answered') throw new Error(`no scene for ${id}: ${answer.reason}`);
  return foldStateFrame(answer.value);
}

/** The sentence the strip and the Step pane read for a step from the sheet. */
async function sentenceOf(id: string): Promise<string> {
  const node = useWorkspaceStore.getState().foldSequences[0]!.document.steps.find((each) => each.id === id)!;
  const words = foldNodeSentenceStep(node, {
    parent: await frameOf(null),
    child: await frameOf(id),
    report: session.store.getState().nodes.get(id)?.report ?? null,
  });
  return foldStepSentence(t, words);
}

describe.skipIf(!available)('the sequence chrome over the real bridge', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    const runtime = inProcessFoldRuntime(() => createFoldEngineCalls(new wasm.FoldEngine()), wasm.fold_engine_version());
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime });
    session.retain();
    await settle();
  });

  afterEach(() => {
    session.dispose();
  });

  it('says a corner folded onto the opposite one as the folder would, in half, mover first', async () => {
    const sheet = session.store.getState().sheet.state!;
    const candidates = await session.withState(sheet, (engine, state) => engine.axiomCandidates(state, CORNER_TO_CORNER));
    if (candidates.status !== 'answered' || candidates.value.status !== 'ok') throw new Error('no candidates');
    const root = candidates.value.candidates[0]!.line;
    const committed = await session.commitStep({ kind: 'valley', line: CORNER_TO_CORNER, seed: { scope: 'all' } }, { root });
    if (committed.status !== 'committed') throw new Error(committed.status);
    await settle();

    expect(await sentenceOf(committed.stepId)).toBe(
      'Valley fold in half, bringing the bottom-right corner onto the top-left corner, through all layers.'
    );
    const folded = await frameOf(committed.stepId);
    expect(folded.area).toBeCloseTo(0.5, 6);
    expect(folded.rectangular).toBe(false);
    // The folded form is the triangle on top; the crease pattern, the square and its diagonal.
    expect(folded.form?.strokes).toHaveLength(3);
    expect(folded.pattern?.strokes.map((stroke) => stroke.role).sort()).toEqual(['edge', 'edge', 'edge', 'edge', 'valley']);

    const summary = await session.withNode(committed.stepId, (engine, state) => engine.stepSummary(state));
    if (summary.status !== 'answered' || summary.value.status !== 'ok' || !summary.value.summary) throw new Error('no summary');
    expect(summary.value.summary.layers).toBe(1);
    expect(creaseDiffLines(t, foldCreaseDiff(summary.value.summary, folded.creases)!)).toEqual([
      'Adds 1 crease (0 M, 1 V)',
    ]);
  });

  it('names the corners of a folded rectangle as a reader sees them', async () => {
    const book = await session.commitStep(BOOK);
    if (book.status !== 'committed') throw new Error(book.status);
    await settle();
    const rectangle = await frameOf(book.stepId);
    expect(rectangle.rectangular).toBe(true);
    expect(rectangle.area).toBeCloseTo(0.5, 6);
    expect(await sentenceOf(book.stepId)).toBe('Valley fold along the line drawn, through all layers.');
  });
});
