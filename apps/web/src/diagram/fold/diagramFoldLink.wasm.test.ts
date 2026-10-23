import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldOp } from '../../fold/document/foldSequenceDocument';
import { createFoldEngineCalls } from '../../fold/engine/foldEngineCalls';
import { createFoldSession, type FoldSession } from '../../fold/session/foldSession';
import { inProcessFoldRuntime, settle } from '../../fold/session/foldSession.fixtures';
import type { PaperScene } from '../../lib/paper/paperScene';
import {
  DEFAULT_DIAGRAM_STYLE,
  isStep,
  setTitleBlockContent,
  type DiagramFoldStepSource,
  type DiagramStep,
} from '../document/diagramDocument';
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { resolveTitleBlock } from '../pages/titleBlockContent';
import { paintScene, stepPictureSource } from '../pictures/paintDiagramStep';

/**
 * The Diagram link end to end (plan D17), over the real Fold bridge in-process
 * and the real store: a three-step sequence folded in Fold, its second step
 * sent to the Diagram, drawn there; an edit upstream — the sheet's start side
 * flipped, which keeps every step and mirrors what it folds — turns the link
 * stale, Refresh brings it back current, and Open in Fold goes to the step.
 *
 * The app's one session (`foldSession()`) is this test's, over the bridge.
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

const held = vi.hoisted(() => ({ session: null as FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => {
    if (!held.session) throw new Error('no test session');
    return held.session;
  },
}));

const { useWorkspaceStore } = await import('../../store/workspaceStore/store');
const { foldSessionDocumentSource } = await import('../../store/workspaceStore/foldSession');
const { useLayoutStore } = await import('../../store/layoutStore');
const { pullFromFold, sendFoldStepsToDiagram } = await import('./foldBrowserActions');
const { openDiagramStepInFold, refreshDiagramFoldStep, spreadDiagramFoldStep } = await import('./foldStepActions');
const { foldLinkContextNow } = await import('./useFoldLinkContext');
const { foldStepLinkStatus } = await import('./foldStepLink');

const T = Math.tan(Math.PI / 8);

/** The kite base, as the tools store it: precrease the diagonal, then fold each lower edge to it. */
const KITE: FoldOp[] = [
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

async function bridge() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return inProcessFoldRuntime(() => createFoldEngineCalls(new wasm.FoldEngine()), wasm.fold_engine_version());
}

const state = () => useWorkspaceStore.getState();

/** The diagram's only step. */
function onlyStep(): DiagramStep {
  const steps = state().diagram?.steps.filter(isStep) ?? [];
  expect(steps).toHaveLength(1);
  return steps[0]!;
}

const statusOf = (step: DiagramStep) => foldStepLinkStatus(step.source as DiagramFoldStepSource, foldLinkContextNow());

describe.skipIf(!available)('a Fold step in the Diagram, over the real bridge (D17)', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    held.session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await bridge() });
    held.session.retain();
    await settle();
    for (const op of KITE) {
      const committed = await held.session.commitStep(op);
      if (committed.status !== 'committed') throw new Error(`commit: ${committed.status}`);
      await settle();
    }
  });

  afterEach(() => {
    held.session?.dispose();
    held.session = null;
  });

  it('draws a step sent from Fold on a page, turns it stale after an edit upstream, and refreshes it', async () => {
    const [, second] = state().foldSequences[0]!.document.steps;
    expect(await pullFromFold([{ kind: 'step', step: second!.id, moment: 'before' }], { kind: 'end' }, { via: 'fold' })).toBe(1);

    // Linked, drawn folded, with the fold's line and arrow, in Fold's words.
    const sent = onlyStep();
    const source = sent.source as DiagramFoldStepSource;
    expect(source).toMatchObject({ kind: 'fold-step', step: second!.id, moment: 'before' });
    expect(source.path).toMatch(/^fh1:/);
    expect(source.state).toMatch(/^fs1:/);
    expect(sent.text.length).toBeGreaterThan(0);
    expect(sent.annotations.map((mark) => (mark.unknown ? 'unknown' : mark.kind))).toEqual(
      expect.arrayContaining(['valley-line', 'valley-arrow'])
    );
    expect(sent.annotations.every((mark) => !mark.unknown && mark.imported === 'untouched')).toBe(true);
    const picture = stepPictureSource(sent, state().diagram!.assets);
    expect(picture).toMatchObject({ kind: 'scene', pattern: false });
    const painted = picture?.kind === 'scene' ? paintScene(picture, DEFAULT_DIAGRAM_STYLE) : null;
    expect(painted?.svg).toContain('<path');
    // And it is a file's: written and read back as it is.
    const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(state().diagram!))));
    expect(read?.document.steps).toEqual(state().diagram!.steps);

    expect(statusOf(sent)).toBe('current');

    // Upstream: Back up keeps the steps and mirrors what each folds.
    expect(state().setFoldStartSide('back')).toBe(true);
    await settle(10);
    expect(statusOf(onlyStep())).toBe('stale');

    const refreshed = await refreshDiagramFoldStep(sent.id);
    expect(refreshed).toMatchObject({ status: 'captured', changed: true });
    expect(statusOf(onlyStep())).toBe('current');
    // Its marks came again with the new state, still Fold's.
    expect(onlyStep().annotations.every((mark) => !mark.unknown && mark.imported === 'untouched')).toBe(true);
  });

  it('takes each state’s spread from Fold, and spreads a Fold step in the Diagram without leaving its link', async () => {
    const [, second, third] = state().foldSequences[0]!.document.steps;
    const depth = { kind: 'depth' as const, amount: 0.06, toward: 'down-right' as const };
    expect(state().setFoldStepSpread(second!.id, depth)).toBe(true);
    expect(state().setFoldStepSpread(third!.id, 'off')).toBe(true);
    await settle();
    const targets = [
      { kind: 'step' as const, step: third!.id, moment: 'before' as const },
      { kind: 'step' as const, step: third!.id, moment: 'after' as const },
    ];
    expect(await pullFromFold(targets, { kind: 'end' }, { via: 'fold' })).toBe(2);
    const [before, after] = state().diagram!.steps.filter(isStep);
    // The state before step 3 is step 2's picture, spread as step 2 is; the one after it, off as step 3 is.
    expect((before!.source as DiagramFoldStepSource).render).toEqual({
      mode: 'folded-flat',
      side: 'front',
      rotationDeg: 0,
      foldCase: 1,
      spread: depth,
    });
    expect((after!.source as DiagramFoldStepSource).render).not.toHaveProperty('spread');
    const marks = before!.annotations.length;
    expect(marks).toBeGreaterThan(0);

    // Posed in the Diagram: another kind, then off — each a capture, the link still current.
    expect(await spreadDiagramFoldStep(before!.id, { verb: 'spread-kind', kind: 'affine' })).toBe(true);
    let posed = state().diagram!.steps.filter(isStep)[0]!;
    expect((posed.source as DiagramFoldStepSource).render).toMatchObject({ spread: { kind: 'affine' } });
    expect(statusOf(posed)).toBe('current');
    expect(posed.annotations).toHaveLength(marks);
    expect(await spreadDiagramFoldStep(before!.id, { verb: 'spread-layers' })).toBe(true);
    posed = state().diagram!.steps.filter(isStep)[0]!;
    expect((posed.source as DiagramFoldStepSource).render).not.toHaveProperty('spread');
    expect(statusOf(posed)).toBe('current');
    // Its marks went with the paper, and are still Fold's.
    expect(posed.annotations.every((mark) => !mark.unknown && mark.imported === 'untouched')).toBe(true);
  });

  it('gives the title block the crease pattern of the last step sent, every crease so far, and of a step chosen', async () => {
    const [, second, third] = state().foldSequences[0]!.document.steps;
    state().moveFoldCursor(third!.id);
    expect(await sendFoldStepsToDiagram('path')).toBe(true);
    const diagram = state().diagram!;
    const sent = diagram.steps.filter(isStep);
    const roles = (scene: PaperScene | null) =>
      (scene?.items ?? []).flatMap((item) => (item.kind === 'line' ? [item.role] : [])).filter((role) => role !== 'edge');

    // Auto: the Finished step, the kite: both valleys folded, the diagonal lying flat in the aux pen.
    const auto = resolveTitleBlock(diagram).pattern;
    expect([auto.from, auto.step?.id]).toEqual(['auto', sent.at(-1)!.id]);
    expect(roles(auto.scene).sort()).toEqual(['aux', 'valley', 'valley']);

    // The second step's diagram step: the state it lands, the diagonal and one valley.
    const step = sent.find((each) => (each.source as DiagramFoldStepSource).step === second!.id)!;
    const chosen = resolveTitleBlock(setTitleBlockContent(diagram, { pattern: { kind: 'step', stepId: step.id } })).pattern;
    expect(chosen.step?.id).toBe(step.id);
    expect(roles(chosen.scene).sort()).toEqual(['aux', 'valley']);
  });

  it('goes back to its step in Fold, and is missing once the step is deleted there', async () => {
    const [, second] = state().foldSequences[0]!.document.steps;
    await pullFromFold([{ kind: 'step', step: second!.id, moment: 'before' }], { kind: 'end' }, { via: 'fold' });
    state().moveFoldCursor(null);
    openDiagramStepInFold(onlyStep().id);
    expect(state().foldReader?.cursor).toBe(second!.id);
    expect(useLayoutStore.getState().activeWorkspace).toBe('fold');

    expect(state().deleteFoldStep(second!.id)).toBe(true);
    await settle();
    expect(statusOf(onlyStep())).toBe('missing');
  });
});
