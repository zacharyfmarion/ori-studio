import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foldNodeDigest } from '../../fold/document/foldDigest';
import { SQUARE_PAPER, type FoldOp, type FoldStepNode } from '../../fold/document/foldSequenceDocument';
import { createFoldEngineCalls } from '../../fold/engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../../fold/engine/foldEngineCompoundCalls';
import { prepareRepeat } from '../../fold/repeat/repeatPreparation';
import { createFoldSession, type FoldSession } from '../../fold/session/foldSession';
import { inProcessFoldRuntime, settle } from '../../fold/session/foldSession.fixtures';
import type { PaperScene } from '../../lib/paper/paperScene';
import { isKnownAnnotation, isStep, type DiagramFoldStepSource, type DiagramStep } from '../document/diagramDocument';
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { resolveTitleBlock } from '../pages/titleBlockContent';
import { storedScene } from '../pictures/pictureFrame';

/**
 * Merge symmetric precreases end to end, over the real Fold bridge
 * in-process and the real store: the kite's diagonal precreased, then the
 * bottom edge precreased to it, and its mirror image — Repeated across the
 * diagonal, or precreased by hand on the left — found, pulled as one Diagram
 * step, saved and opened, turned stale upstream and refreshed, and sent from
 * Fold with the option on and off. What does not mirror, or moves paper, is
 * never merged.
 *
 * The app's one session (`foldSession()`) is this test's. Skipped when the
 * bridge has not been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

const held = vi.hoisted(() => ({ session: null as FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => {
    if (!held.session) throw new Error('no test session');
    return held.session;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const { useWorkspaceStore } = await import('../../store/workspaceStore/store');
const { useSettingsStore } = await import('../../store/settingsStore');
const { foldSessionDocumentSource } = await import('../../store/workspaceStore/foldSession');
const { pullFromFold, sendFoldStepsToDiagram } = await import('./foldBrowserActions');
const { openDiagramStepInFold, refreshDiagramFoldStep, showFoldStepAs } = await import('./foldStepActions');
const { foldLinkContextNow } = await import('./useFoldLinkContext');
const { foldStepLinkStatus } = await import('./foldStepLink');
const { foldPrecreaseMerges, forgetPrecreaseMirrorsForTest } = await import('./foldPrecreaseMirrors');

const T = Math.tan(Math.PI / 8);
/** The diagonal the kite folds to, across which its two halves mirror. */
const DIAGONAL = { n: [Math.SQRT1_2, -Math.SQRT1_2] as const, d: 0 };

const precrease = (through: [[number, number], [number, number]], moving: [number, number]): FoldOp => ({
  kind: 'precrease',
  direction: 'valley',
  line: { via: 'free', through },
  moving,
  seed: { scope: 'all' },
});
const DIAG = precrease([[0, 0], [1, 1]], [0.75, 0.25]);
/** The bottom edge to the diagonal, folded and unfolded. */
const BOTTOM = precrease([[0, 0], [1, T]], [0.9, 0.1]);
/** Its mirror image: the left edge to the diagonal. */
const LEFT = precrease([[0, 0], [T, 1]], [0.1, 0.9]);
/** A second precrease in the bottom half, parallel to the diagonal. */
const PARALLEL = precrease([[0.5, 0], [1, 0.5]], [0.9, 0.1]);
/** Another precrease, through the same corner, mirroring nothing. */
const OTHER = precrease([[0, 0], [1, 0.2]], [0.9, 0.05]);
/** The left edge to the diagonal, folded flat: it moves paper. */
const LEFT_FOLDED: FoldOp = { kind: 'valley', line: { via: 'free', through: [[0, 0], [T, 1]] }, moving: [0.1, 0.9], seed: { scope: 'all' } };
const BOTTOM_FOLDED: FoldOp = { kind: 'valley', line: { via: 'free', through: [[0, 0], [1, T]] }, moving: [0.9, 0.1], seed: { scope: 'all' } };

async function wasm() {
  const module = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  module.initSync({ module: readFileSync(WASM) });
  return module;
}

const state = () => useWorkspaceStore.getState();
const steps = () => state().foldSequences[0]!.document.steps;
const diagramSteps = () => state().diagram?.steps.filter(isStep) ?? [];
const statusOf = (step: DiagramStep) => foldStepLinkStatus(step.source as DiagramFoldStepSource, foldLinkContextNow());

/** Commit `ops` through the session, one after another; then a Repeat of the last `repeat` of them across the diagonal. */
async function fold(ops: FoldOp[], repeatLast: boolean | number = false): Promise<FoldStepNode[]> {
  for (const op of ops) {
    const committed = await held.session!.commitStep(op);
    if (committed.status !== 'committed') throw new Error(`commit: ${committed.status}`);
    await settle();
  }
  const repeated = repeatLast === true ? 1 : repeatLast === false ? 0 : repeatLast;
  if (repeated > 0) {
    const module = await wasm();
    const raw = new module.FoldEngine();
    const engine = { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
    const sheet = engine.sheet(SQUARE_PAPER);
    if (sheet.status !== 'ok') throw new Error('sheet');
    const landed = [sheet.state];
    for (const op of ops) {
      const next = engine.step(landed.at(-1)!, op);
      if (next.status !== 'ok') throw new Error(JSON.stringify(next));
      landed.push(next.state);
    }
    const sources = steps().slice(-repeated);
    const from = ops.length - repeated;
    const recipe = prepareRepeat(engine, {
      parent: landed.at(-1)!,
      steps: sources.map((source, k) => ({ id: source.id, before: landed[from + k]!, after: landed[from + k + 1]!, op: ops[from + k]! })),
      axis: DIAGONAL,
      source: {
        first: sources[0]!.id,
        last: sources.at(-1)!.id,
        revision: foldNodeDigest(state().foldSequences[0]!.document, sources.at(-1)!.id)!,
      },
    });
    engine.clear();
    raw.free();
    if (recipe.status !== 'ready') throw new Error(JSON.stringify(recipe));
    const committed = await held.session!.commitStep(recipe.op);
    if (committed.status !== 'committed') throw new Error(`commit repeat: ${committed.status}`);
    await settle(10);
  }
  return [...steps()];
}

/** The marks a step brought, by kind. */
const kinds = (step: DiagramStep) => step.annotations.map((mark) => (mark.unknown ? 'unknown' : mark.kind));

/** The instruction's creases in a crease-pattern picture: the lines in the diagram pens. */
function instructionLines(step: DiagramStep): number {
  const picture = step.picture;
  const scene: PaperScene | null = picture?.kind === 'scene' ? storedScene(picture) : null;
  return scene?.items.filter((item) => item.kind === 'line' && item.role.startsWith('diagram-')).length ?? -1;
}

describe.skipIf(!available)('merging a precrease and its mirror image into one Diagram step', () => {
  beforeEach(async () => {
    forgetPrecreaseMirrorsForTest();
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    useSettingsStore.getState().setDiagramFoldMergePrecreases(true);
    const module = await wasm();
    held.session = createFoldSession({
      document: foldSessionDocumentSource(useWorkspaceStore),
      runtime: inProcessFoldRuntime(() => createFoldEngineCalls(new module.FoldEngine()), module.fold_engine_version()),
    });
    held.session.retain();
    await settle();
  });

  afterEach(() => {
    held.session?.dispose();
    held.session = null;
  });

  const mergesOf = (path: readonly FoldStepNode[]) => foldPrecreaseMerges(held.session!, state().foldSequences[0]!.document.id, path);

  it('finds a precrease and the Repeat of it, from the document', async () => {
    const [, bottom, repeat] = await fold([DIAG, BOTTOM], true);
    expect(await mergesOf(steps())).toEqual([{ steps: [bottom!.id, repeat!.id], kind: 'repeat' }]);
  });

  it('finds two precreases that mirror each other across the diagonal, by Repeat’s own check', async () => {
    const [, bottom, left] = await fold([DIAG, BOTTOM, LEFT]);
    expect(await mergesOf(steps())).toEqual([{ steps: [bottom!.id, left!.id], kind: 'mirror' }]);
  });

  it.each([
    ['two precreases that do not mirror', [DIAG, BOTTOM, OTHER], false],
    ['a precrease and the mirror of it folded flat, which moves paper', [DIAG, BOTTOM, LEFT_FOLDED], false],
    ['a Repeat of a fold that moves paper', [DIAG, BOTTOM_FOLDED], true],
  ] as const)('merges nothing for %s', async (_label, ops, repeatLast) => {
    await fold([...ops], repeatLast);
    expect(await mergesOf(steps())).toEqual([]);
  });

  it('pulls a precrease and its Repeat as one step: the state before, both creases’ lines and arrows, no callout, said once', async () => {
    const [diag, bottom, repeat] = await fold([DIAG, BOTTOM], true);
    expect(await pullFromFold([{ kind: 'step', step: bottom!.id, moment: 'before' }], { kind: 'end' }, { via: 'diagram_browser' })).toBe(1);
    const single = diagramSteps()[0]!;
    const target = { kind: 'step' as const, step: bottom!.id, through: repeat!.id, moment: 'before' as const };
    expect(await pullFromFold([target], { kind: 'end' }, { via: 'diagram_browser' })).toBe(1);
    const merged = diagramSteps()[1]!;
    const source = merged.source as DiagramFoldStepSource;
    expect(source).toMatchObject({ kind: 'fold-step', step: bottom!.id, through: repeat!.id, moment: 'before' });
    // The picture is the state before the first: the one a single step's shows, the diagonal precreased.
    expect(source.state).toBe(held.session!.store.getState().nodes.get(diag!.id)?.fingerprint);
    expect(source.state).toBe((single.source as DiagramFoldStepSource).state);
    expect(source.path).toBe(foldNodeDigest(state().foldSequences[0]!.document, repeat!.id));
    // Both sides' fold-and-unfold arrows, each the mirror of the other; no Repeat callout.
    expect(kinds(single).filter((kind) => kind === 'fold-unfold-arrow')).toHaveLength(1);
    expect(kinds(merged).filter((kind) => kind === 'fold-unfold-arrow')).toHaveLength(2);
    expect(kinds(merged)).not.toContain('callout');
    expect(kinds(merged).filter((kind) => kind.endsWith('-line')).length).toBe(2 * kinds(single).filter((kind) => kind.endsWith('-line')).length);
    const arrows = merged.annotations.filter(isKnownAnnotation).filter((mark) => mark.kind === 'fold-unfold-arrow');
    const [a, b] = arrows.map((mark) => mark.from);
    // Mirrored across the sheet's diagonal, which runs up to the right: in the picture, y down, the other one.
    expect(a![0]).toBeCloseTo(1 - b![1], 3);
    expect(a![1]).toBeCloseTo(1 - b![0], 3);
    expect(merged.annotations.every((mark) => !mark.unknown && mark.imported === 'untouched')).toBe(true);
    expect(single.text).toBe('Fold and unfold.');
    expect(merged.text).toBe('Fold and unfold on both sides.');
    expect(statusOf(merged)).toBe('current');

    // As a crease pattern, both creases are the instruction.
    expect(await showFoldStepAs(single.id, 'crease-pattern')).toBe(true);
    expect(await showFoldStepAs(merged.id, 'crease-pattern')).toBe(true);
    expect(instructionLines(diagramSteps()[1]!)).toBe(2 * instructionLines(diagramSteps()[0]!));
    expect(instructionLines(diagramSteps()[0]!)).toBeGreaterThan(0);
    expect((diagramSteps()[1]!.source as DiagramFoldStepSource).through).toBe(repeat!.id);
  });

  it('pulls a run of precreases and the Repeat of the whole run as one step: every Repeated step drawn on the state it folds from', async () => {
    const [, bottom, second, repeat] = await fold([DIAG, BOTTOM, PARALLEL], 2);
    expect(await mergesOf(steps())).toEqual([{ steps: [bottom!.id, second!.id, repeat!.id], kind: 'repeat' }]);
    const target = { kind: 'step' as const, step: bottom!.id, through: repeat!.id, moment: 'before' as const };
    expect(await pullFromFold([target], { kind: 'end' }, { via: 'diagram_browser' })).toBe(1);
    const merged = diagramSteps()[0]!;
    expect(kinds(merged).filter((kind) => kind === 'fold-unfold-arrow')).toHaveLength(4);
    // Precreases of one kind, said once, for both sides.
    expect(merged.text).toBe('Fold and unfold on both sides.');
    // The states the Repeat's later steps were drawn on are let go.
    const live = await held.session!.withNode(null, (engine) => engine.live());
    await pullFromFold([target], { kind: 'end' }, { via: 'diagram_browser' });
    expect(await held.session!.withNode(null, (engine) => engine.live())).toEqual(live);
  });

  it('pulls two precreases that mirror each other as one step, both creases on it', async () => {
    const [, bottom, left] = await fold([DIAG, BOTTOM, LEFT]);
    const target = { kind: 'step' as const, step: bottom!.id, through: left!.id, moment: 'before' as const };
    expect(await pullFromFold([target], { kind: 'end' }, { via: 'diagram_browser' })).toBe(1);
    const merged = diagramSteps()[0]!;
    expect(kinds(merged).filter((kind) => kind === 'fold-unfold-arrow')).toHaveLength(2);
    expect(merged.text).toBe('Fold and unfold on both sides.');
    expect(statusOf(merged)).toBe('current');
    // The title block's pattern is the state the run's last step lands: all three precreases, lying flat.
    const { pattern } = resolveTitleBlock(state().diagram!);
    expect(pattern.step?.id).toBe(merged.id);
    const lines = (pattern.scene?.items ?? []).flatMap((item) => (item.kind === 'line' && item.role !== 'edge' ? [item.role] : []));
    expect(lines).toEqual(['aux', 'aux', 'aux']);
  });

  it('keeps the run through a save and an open, opens its last step in Fold, and is missing once the Repeat no longer folds', async () => {
    const [, bottom, repeat] = await fold([DIAG, BOTTOM], true);
    await pullFromFold([{ kind: 'step', step: bottom!.id, through: repeat!.id, moment: 'before' }], { kind: 'end' }, { via: 'fold' });
    const written = JSON.parse(JSON.stringify(writeDiagram(state().diagram!)));
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(read.document.steps).toEqual(state().diagram!.steps);
    expect((read.document.steps.filter(isStep)[0]!.source as DiagramFoldStepSource).through).toBe(repeat!.id);
    expect(statusOf(diagramSteps()[0]!)).toBe('current');

    state().moveFoldCursor(null);
    openDiagramStepInFold(diagramSteps()[0]!.id);
    expect(state().foldReader?.cursor).toBe(repeat!.id);

    // Back up mirrors the state the Repeat was prepared on, which it no longer folds from until it is rebuilt.
    expect(state().setFoldStartSide('back')).toBe(true);
    await settle(10);
    expect(statusOf(diagramSteps()[0]!)).toBe('missing');
  });

  it('goes stale when either step changes upstream, and refreshes as one run', async () => {
    const [, bottom, left] = await fold([DIAG, BOTTOM, LEFT]);
    await pullFromFold([{ kind: 'step', step: bottom!.id, through: left!.id, moment: 'before' }], { kind: 'end' }, { via: 'fold' });
    expect(statusOf(diagramSteps()[0]!)).toBe('current');
    // Upstream: Back up keeps both steps and mirrors what each folds.
    expect(state().setFoldStartSide('back')).toBe(true);
    await settle(10);
    expect(statusOf(diagramSteps()[0]!)).toBe('stale');
    expect(await refreshDiagramFoldStep(diagramSteps()[0]!.id)).toMatchObject({ status: 'captured', changed: true });
    const refreshed = diagramSteps()[0]!;
    expect(statusOf(refreshed)).toBe('current');
    expect((refreshed.source as DiagramFoldStepSource).through).toBe(left!.id);
    expect(kinds(refreshed).filter((kind) => kind === 'fold-unfold-arrow')).toHaveLength(2);

    // Its last step gone: the run is.
    expect(state().deleteFoldStep(left!.id)).toBe(true);
    await settle();
    expect(statusOf(diagramSteps()[0]!)).toBe('missing');
  });

  it('sends the path from Fold merged with the option on, and step by step with it off', async () => {
    const [diag, bottom, repeat] = await fold([DIAG, BOTTOM], true);
    state().moveFoldCursor(repeat!.id);
    expect(await sendFoldStepsToDiagram('path')).toBe(true);
    const sources = () => diagramSteps().map((step) => step.source as DiagramFoldStepSource);
    expect(sources().map(({ step, through, moment }) => [step, through ?? null, moment])).toEqual([
      [diag!.id, null, 'before'],
      [bottom!.id, repeat!.id, 'before'],
      [repeat!.id, null, 'after'],
    ]);

    useWorkspaceStore.setState({ diagram: null });
    useSettingsStore.getState().setDiagramFoldMergePrecreases(false);
    expect(await sendFoldStepsToDiagram('path')).toBe(true);
    expect(sources().map(({ step, through, moment }) => [step, through ?? null, moment])).toEqual([
      [diag!.id, null, 'before'],
      [bottom!.id, null, 'before'],
      [repeat!.id, null, 'before'],
      [repeat!.id, null, 'after'],
    ]);
  });
});
