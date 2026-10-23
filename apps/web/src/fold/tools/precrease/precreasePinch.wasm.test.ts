import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../../i18n';
import { foldSessionDocumentSource } from '../../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../../store/workspaceStore/store';
import { foldAlongLine, resolveAlongPick } from '../../canvas/foldAlongLine';
import { creasePatternPaneLines } from '../../canvas/foldCreasePatternLines';
import { FOLD_PANE_DISPLAY_DEFAULT } from '../../canvas/foldPaneScenes';
import { foldPickIndex, resolveFoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldOp } from '../../document/foldSequenceDocument';
import { createFoldEngineCalls } from '../../engine/foldEngineCalls';
import type { FoldSceneCreaseMark } from '../../engine/foldEngineWire';
import { foldCreaseDiff } from '../../sequence/foldStepDiff';
import { createFoldSession, type FoldSession } from '../../session/foldSession';
import { inProcessFoldRuntime, settle } from '../../session/foldSession.fixtures';
import { FOLD_PINCH_LENGTH_QUERY, FOLD_SCENE_QUERY } from '../../session/foldStateQueries';
import { selectFoldCursorNode } from '../../session/foldSessionState';
import { creaseDiffLines } from '../../stepWords';
import { buildFoldStep, type FoldStepIntent } from '../foldStepBuilder';
import { createFoldTools, FOLD_TOOL_INITIAL } from '../foldToolState';
import { lineSectionProbe, topFlapSeed } from '../topFlapSeed';
import { foldExtentState } from './precreaseExtent';

/**
 * The classic pinch, through the session over the real bridge and the tools'
 * own pipeline — the picks resolved on the engine's scene and landmarks, the
 * pinch's point clicked along the located line, its length the engine's —
 * as the canvas makes it: fold the square in half on a diagonal, pinch the
 * other diagonal through both layers at its middle, unfold. The two marks lie
 * at the other diagonal's quarter points, one of each letter as seen from the
 * front.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);
const t = i18n.t.bind(i18n);
const RADII = { point: 0.02, line: 0.02 };

/** The square in half on its diagonal y = x: the top-left half over the bottom-right. */
const DIAGONAL: FoldOp = {
  kind: 'valley',
  line: { via: 'free', through: [[0, 0], [1, 1]] },
  moving: [0.25, 0.75],
  seed: { scope: 'all' },
};

async function bridge() {
  const wasm = await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return inProcessFoldRuntime(() => createFoldEngineCalls(new wasm.FoldEngine()), wasm.fold_engine_version());
}

let session: FoldSession;

const cursor = () => selectFoldCursorNode(session.store.getState());

/** The step on screen as the canvas indexes it: its scene and its landmarks. */
async function shownIndex(): Promise<FoldPickIndex> {
  const scene = await session.withCursor((engine, at) => engine.scene(at));
  const landmarks = await session.withCursor((engine, at) => engine.landmarks(at, []));
  if (scene.status !== 'answered' || landmarks.status !== 'answered') throw new Error('no scene');
  return foldPickIndex(scene.value, landmarks.value, []);
}

/** Preview a step, commit it, and wait for the session to settle on it. */
async function fold(op: FoldOp) {
  const preview = await session.preview(op);
  if (preview.status !== 'landed') throw new Error(JSON.stringify(preview));
  const committed = await session.commitStep(op);
  if (committed.status !== 'committed') throw new Error(committed.status);
  await settle();
  return preview;
}

const centre = (mark: FoldSceneCreaseMark) => [(mark.from.x + mark.to.x) / 2, (mark.from.y + mark.to.y) / 2];
const length = (mark: FoldSceneCreaseMark) => Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y);

describe.skipIf(!available)('the classic pinch, through the session and the tools', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: await bridge() });
    session.retain();
    await settle();
  });

  afterEach(() => {
    session.dispose();
  });

  it('folds in half on a diagonal, pinches the other through both layers, and unfolds to two quarter-point marks', async () => {
    await fold(DIAGONAL);
    const folded = await shownIndex();

    // The Precrease tool, a pinch, its line the other diagonal: from the
    // folded triangle's corner (1, 0) through the folded edge's middle.
    const tools = createFoldTools({ ...FOLD_TOOL_INITIAL, tool: 'precrease', lineMode: 'free', extent: 'pinch' });
    for (const at of [{ x: 1, y: 0 }, { x: 0.5, y: 0.5 }]) {
      const pick = resolveFoldPick(folded, 'folded', at, RADII, { snap: 'free', edges: false, free: false });
      if (!pick) throw new Error('no pick');
      tools.pick(pick);
    }
    // The default seed, the top flap, resolved against the engine's section
    // at the line as the canvas resolves it (`useFoldLineSection`): across the
    // triangle the moving side is one flap, its two layers joined by the fold,
    // so its top flap is both layers.
    const probe = lineSectionProbe(tools.store.getState(), folded, null);
    if (!probe) throw new Error('no line to section');
    const sectioned = await session.withCursor((engine, at) => engine.crossSection(at, probe.line, probe.side));
    if (sectioned.status !== 'answered' || sectioned.value.status !== 'ok') throw new Error('no section');
    expect(sectioned.value.section.flaps).toHaveLength(1);
    expect(sectioned.value.section.rows).toHaveLength(2);
    const seed = topFlapSeed(sectioned.value.section);
    expect(seed).toEqual({ scope: 'all' });
    const intent = (): FoldStepIntent => {
      const state = tools.store.getState();
      return { kind: 'precrease', lineMode: state.lineMode, picks: state.picks, candidate: null, swapped: false, seed, precreaseDirection: 'valley' };
    };
    const whole = buildFoldStep(intent(), folded);
    if (whole.status !== 'built') throw new Error(whole.status);

    // The pinch's point, clicked along the line: its middle across the
    // triangle, named on the layer on top, which is the moved one.
    const along = foldAlongLine(folded, whole.sceneLine, 'folded');
    const middle = resolveAlongPick(folded, along, { x: 0.76, y: 0.245 }, RADII, false);
    expect(middle).toMatchObject({ provenance: 'midpoint' });
    if (!middle) throw new Error('no point along the line');
    tools.pickAlong(middle);
    expect(middle.sheet[0]).toBeCloseTo(0.25, 9);
    expect(middle.sheet[1]).toBeCloseTo(0.75, 9);

    // The engine's pinch length, a sixteenth of the side, which the step stores.
    const asked = await session.query(cursor().state!, FOLD_PINCH_LENGTH_QUERY);
    if (asked.status !== 'answered') throw new Error('no length');
    expect(asked.value).toBe(1 / 16);
    const extent = foldExtentState('pinch', tools.store.getState().extentPicks, asked.value);
    if (extent.status !== 'ready') throw new Error(extent.status);
    const pinch = buildFoldStep({ ...intent(), extent: extent.extent }, folded);
    if (pinch.status !== 'built') throw new Error(pinch.status);
    expect(pinch.op).toMatchObject({ kind: 'precrease', extent: { kind: 'pinch', length: 1 / 16 } });

    // Through both layers: two marks, and no crease.
    const pinched = await fold(pinch.op);
    expect(pinched.summary.crease_marks).toBe(2);
    expect(pinched.summary.faces).toBe(2);
    const summary = await session.withCursor((engine, at) => engine.stepSummary(at));
    if (summary.status !== 'answered' || summary.value.status !== 'ok' || !summary.value.summary) throw new Error('no summary');
    const diff = foldCreaseDiff(summary.value.summary, new Map());
    expect(creaseDiffLines(t, diff!, { op: 'precrease', direction: 'valley', line: { via: 'free' }, scope: { kind: 'all' }, extent: { kind: 'pinch', at: { kind: 'point' } } })).toEqual([
      'Adds 2 pinch marks',
    ]);

    // Unfold along the diagonal bend, as the existing-crease line mode does.
    const shown = await shownIndex();
    const bend = resolveFoldPick(shown, 'folded', { x: 0.3, y: 0.3 }, RADII, { snap: 'crease-required', edges: false, free: false });
    expect(bend).toMatchObject({ kind: 'segment', segment: 'bend' });
    const unfold = buildFoldStep(
      { kind: 'valley', lineMode: 'crease', picks: [bend!], candidate: null, swapped: false, seed: { scope: 'all' }, precreaseDirection: 'valley' },
      shown
    );
    if (unfold.status !== 'built') throw new Error(unfold.status);
    expect(unfold.op.kind).toBe('valley');
    await fold(unfold.op);
    expect(cursor().summary?.faces).toBe(2);

    // The flat square: two marks at the other diagonal's quarter points, a
    // pinch's length each, across it — one of each letter from the front.
    const scene = await session.query(cursor().state!, FOLD_SCENE_QUERY);
    if (scene.status !== 'answered') throw new Error('no scene');
    const marks = [...(scene.value.crease_marks ?? [])].sort((a, b) => centre(a)[0]! - centre(b)[0]!);
    expect(marks).toHaveLength(2);
    expect(centre(marks[0]!)[0]).toBeCloseTo(0.25, 9);
    expect(centre(marks[0]!)[1]).toBeCloseTo(0.75, 9);
    expect(centre(marks[1]!)[0]).toBeCloseTo(0.75, 9);
    expect(centre(marks[1]!)[1]).toBeCloseTo(0.25, 9);
    for (const mark of marks) expect(length(mark)).toBeCloseTo(1 / 16, 9);
    expect(marks.map((mark) => mark.letter).sort()).toEqual(['mountain', 'valley']);
    // Along the diagonal x + y = 1, square to the crease they were pinched across.
    for (const mark of marks) expect(mark.from.x + mark.from.y).toBeCloseTo(1, 9);
    // The crease-pattern pane draws both as Edit's auxiliary lines, as Send to Edit lands them.
    const lines = creasePatternPaneLines(scene.value, { display: FOLD_PANE_DISPLAY_DEFAULT, step: 4, instruction: null });
    for (const mark of marks) {
      const drawn = lines.creases.filter((line) => line.a.x === mark.from.x && line.a.y === mark.from.y && line.b.x === mark.to.x && line.b.y === mark.to.y);
      expect(drawn.map((line) => line.color)).toEqual(['Cyan3']);
    }
  });
});
