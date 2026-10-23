/**
 * The Repeat tool over the real engine and the session (plan
 * `fold-sequence-tools`): it previews as every tool does — prepared as soon
 * as the range and the axis settle, prepared anew when either changes — and
 * Enter adds what it previews; its axis is chosen, remembered from one repeat
 * to the next, or drawn as a free line through the view it was drawn on and
 * accepted only when it is a verified axis; Escape stops a preparation in the
 * engine, every trial state let go and nothing added, then lets go of a line
 * drawn, then puts Repeat down.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { sceneLineOf } from '../canvas/foldCanvasGeometry';
import { foldPickIndex, type FoldPick, type FoldPickIndex } from '../canvas/foldPicking';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import type { FoldModelLine, FoldOp, FoldSequenceDocument } from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import { createFoldSearchRunner, type FoldSearchTicket } from '../engine/foldSearch';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { inProcessFoldRuntime, settle } from '../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../session/foldSessionState';
import { useFoldSession } from '../session/useFoldSession';
import { foldTools, useFoldTools } from '../tools/foldToolState';
import { repeatSymmetries, type RepeatSymmetry } from './repeatGeometry';
import { prepareRepeatSearch, REPEAT_PREPARATION_MS, type RepeatRequest } from './repeatPreparation';
import { landedPreviewOf } from '../canvas/useFoldToolPreview';
import { FOLD_SCENE_QUERY, FOLD_STEP_SUMMARY_QUERY } from '../session/foldStateQueries';
import { repeatPreviewCreases } from './repeatCanvas';
import { sameRepeatLine } from './repeatRange';
import { REPEAT_PREPARE_DELAY_MS, useFoldRepeatTool } from './useFoldRepeatTool';
import i18n from '../../i18n';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { isLockedStep } from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { foldToolWindow, type FoldToolWindowVerbs, type FoldToolWindowView } from '../tools/foldToolWindow';

let session: FoldSession;
vi.mock('../../store/workspaceStore/foldSession', async (original) => ({
  ...(await original<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => session,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');

/** A precrease then a corner fold on the right half: what Repeat mirrors across x = 1/2. */
const ops: FoldOp[] = [
  { kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[0.75, 0], [0.75, 1]] }, moving: [0.9, 0.5], seed: { scope: 'all' } },
  { kind: 'valley', line: { via: 'free', through: [[0.6, 1], [1, 0.6]] }, moving: [0.95, 0.95], seed: { scope: 'all' } },
];
const document: FoldSequenceDocument = {
  formatVersion: 1,
  id: 'repeat-stop',
  title: '',
  paper: { shape: { kind: 'square' }, startSide: 'front' },
  steps: ops.map((op, i) => ({ id: `s${i}`, parent: i ? `s${i - 1}` : null, op })),
};

/** The sheet's vertical middle, as a sheet line: the axis the corner fold mirrors across. */
const MIDDLE: FoldModelLine = { n: [1, 0], d: 0.5 };
const isMiddle = (axis: RepeatSymmetry) => sameRepeatLine(axis.sheet, MIDDLE);

/** What the folded pane picks on: the step on screen's scene, indexed once it has landed. */
let picking: FoldPickIndex | null = null;

/**
 * The worker's calls in-process, its searches run by a runner that pauses
 * between slices while `paused`, for the test to stop one in the middle; the
 * axes it last found, as the tool was told them.
 */
async function bridge() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const raw = new wasm.FoldEngine();
  let paused = false;
  let resume: (() => void) | null = null;
  let found: readonly RepeatSymmetry[] | null = null;
  const runner = createFoldSearchRunner({
    sliceMs: 0,
    yieldTask: () => (paused ? new Promise<void>((done) => (resume = done)) : Promise.resolve()),
  });
  const calls = { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
  const worker = Object.assign(calls, {
    repeatAxes: (state: number) => (found = repeatSymmetries(calls.scene(state), calls.summary(state).sheet)),
    prepareRepeat: (request: RepeatRequest, ticket?: FoldSearchTicket) =>
      runner.run(prepareRepeatSearch(calls, request), REPEAT_PREPARATION_MS, ticket),
    cancelSearch: (id: number) => runner.cancel(id),
  });
  const runtime = inProcessFoldRuntime((): FoldEngineCalls => worker, wasm.fold_engine_version());
  return {
    runtime,
    live: () => raw.live(),
    scene: (state: number) => calls.scene(state),
    axes: () => found,
    pause: (on: boolean) => (paused = on),
    /** The search is waiting between two slices. */
    waiting: () => resume !== null,
    resume: () => {
      const go = resume;
      resume = null;
      go?.();
    },
  };
}

/** Wait, in real time — Repeat prepares after a pause (`REPEAT_PREPARE_DELAY_MS`) — for `ready` to hold. */
async function until<T>(ready: () => T | null | undefined | false, what: string): Promise<T> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const value = ready();
    if (value) return value;
    await act(async () => settle(2));
  }
  throw new Error(`timed out waiting for ${what}`);
}

let seen: ReturnType<typeof useFoldRepeatTool> | null = null;
function Probe() {
  const surface = useFoldSession();
  const tools = useFoldTools((state) => state);
  const repeat = useFoldRepeatTool(surface, tools, picking);
  useEffect(() => {
    seen = repeat;
  });
  return null;
}

let root: Root;
let engine: Awaited<ReturnType<typeof bridge>>;

beforeEach(async () => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  engine = await bridge();
  session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime: engine.runtime });
  session.retain();
  useWorkspaceStore
    .getState()
    .installFoldSequences([{ document, readOnlyRaw: null }], withFoldCursor(initialFoldReaderState(document.id), document, 's1'));
  await until(() => session.store.getState().cursor === 's1' && selectFoldCursorNode(session.store.getState()).status === 'ok', 'the replay');
  const onScreen = selectFoldCursorNode(session.store.getState()).state;
  picking = onScreen ? foldPickIndex(engine.scene(onScreen.id), null, []) : null;
  root = createRoot(window.document.createElement('div'));
  seen = null;
  act(() => {
    foldTools().selectTool('valley');
    // No axis remembered from another test.
    foldTools().store.setState({ repeatAxis: null, repeatIndividual: false });
  });
});

afterEach(() => {
  act(() => root.unmount());
  act(() => foldTools().selectTool('valley'));
  session.dispose();
});

/** Repeat in hand on both steps, the axis remembered `remembered`, its axes found. */
async function taken(remembered: FoldModelLine | null = null): Promise<readonly RepeatSymmetry[]> {
  act(() => {
    if (remembered) foldTools().setRepeatAxis(remembered);
    foldTools().selectTool('repeat');
  });
  await act(async () => root.render(<Probe />));
  act(() => foldTools().setRepeatFirst('s0'));
  // The sheet before the range, whose axes are asked.
  await until(() => seen && seen.view.range?.first === 's0' && seen.view.axes !== null, 'the axes');
  const axes = engine.axes();
  expect(axes?.length).toBeGreaterThan(1);
  return axes!;
}

/** Let the paused preparation go from slice to slice until it holds a trial state: the middle of it. */
function untilHolding(live: number) {
  return until(() => {
    if (!engine.waiting()) return false;
    if (engine.live() > live) return true;
    engine.resume();
    return false;
  }, 'a preparation holding a trial state');
}

/** The repeat the session previews, once it has landed. */
const previewed = () => {
  const pending = session.store.getState().pending;
  return pending.status === 'landed' && pending.request.op.kind === 'repeat' ? pending.request.op : null;
};

/** A free line clicked on the folded pane through two scene points, Locate line set to Free line (Repeat stays in hand). */
function draw(a: { x: number; y: number }, b: { x: number; y: number }) {
  act(() => foldTools().selectLineMode('free'));
  expect(foldTools().store.getState().tool).toBe('repeat');
  for (const scene of [a, b]) {
    const pick: FoldPick = { kind: 'free', pane: 'folded', scene, sheet: null };
    act(() => {
      foldTools().pick(pick);
    });
  }
}

/** Two points on a scene line, a little way either side of its foot. */
function along(line: FoldModelLine): [{ x: number; y: number }, { x: number; y: number }] {
  const foot = { x: line.n[0] * line.d, y: line.n[1] * line.d };
  const direction = { x: -line.n[1], y: line.n[0] };
  return [
    { x: foot.x - 0.3 * direction.x, y: foot.y - 0.3 * direction.y },
    { x: foot.x + 0.3 * direction.x, y: foot.y + 0.3 * direction.y },
  ];
}

describe('the Repeat tool', () => {
  it('previews the repeat as soon as the range and the axis are set, and adds it on Enter, then is put down', async () => {
    await taken(MIDDLE);
    // Nothing pressed: the preview comes of its own accord, its step the session's to show.
    const op = await until(() => seen?.view.phase.kind === 'ready' && previewed(), 'the preview');
    expect(sameRepeatLine(op.axis, MIDDLE)).toBe(true);
    expect(seen!.step?.op).toEqual(op);
    // What the canvas draws of it: the creases it adds — the engine keeps no step summary for a repeat, so
    // the ones made after the step it is folded from — each in the letter the folder makes it with, valley, on
    // the paper it folds; the corner fold's on the folded edge too, where its flap shows the paper's back.
    const pending = session.store.getState().pending;
    if (pending.status !== 'landed') throw new Error('no landed preview');
    const cursor = selectFoldCursorNode(session.store.getState());
    const [scene, summary, before] = await act(async () =>
      Promise.all([
        session.query(pending.state, FOLD_SCENE_QUERY),
        session.query(pending.state, FOLD_STEP_SUMMARY_QUERY),
        session.query(cursor.state!, FOLD_SCENE_QUERY),
      ])
    );
    if (scene.status !== 'answered' || before.status !== 'answered') throw new Error('no scenes');
    expect(summary.status === 'answered' ? summary.value.summary : null).toBeNull();
    const landed = landedPreviewOf(pending.summary, scene.value, null, cursor.summary!.step);
    // The mirrored precrease and corner fold, each in two where the other crosses it: the precrease's made
    // a step before the corner fold's, as the engine counts the repeat's operations one by one.
    expect(landed.added.size).toBe(4);
    const made = scene.value.creases.filter((crease) => landed.added.has(crease.id)).map((crease) => crease.made_at);
    expect(new Set(made).size).toBe(2);
    const creases = repeatPreviewCreases(landed.scene, landed.added, before.value);
    expect(creases.folded.map((line) => line.letter)).toEqual(['valley', 'valley', 'valley', 'valley']);
    act(() => {
      expect(seen!.primary()).toBe(true);
    });
    await until(() => useWorkspaceStore.getState().foldSequences[0]!.document.steps.length === 3, 'the added repeat');
    const added = useWorkspaceStore.getState().foldSequences[0]!.document.steps[2]!;
    expect(added.op?.kind).toBe('repeat');
    expect(foldTools().store.getState().tool).toBe('valley');
  });

  it('prepares anew when the axis changes, letting the last preview go', async () => {
    const axes = await taken(MIDDLE);
    await until(() => seen?.view.phase.kind === 'ready' && previewed(), 'the first preview');
    const other = axes.findIndex((axis) => !isMiddle(axis));
    act(() => seen!.verbs.setAxis(other));
    await until(() => seen?.view.axis === other, 'the other axis');
    // At once: the last preview let go, and the new one on its way.
    expect(seen!.view.phase.kind).toBe('preparing');
    expect(seen!.step).toBeNull();
    expect(previewed()).toBeNull();
    // Whatever that axis makes of the range, it is the one prepared.
    await until(() => seen && seen.view.phase.kind !== 'preparing', 'the new preparation');
    const op = previewed();
    if (op) expect(sameRepeatLine(op.axis, axes[other]!.sheet)).toBe(true);
  });

  it('takes the axis last chosen from one repeat to the next', async () => {
    const axes = await taken();
    // Before any is chosen, the first verified axis whose repeat lands: here the first.
    await until(() => seen?.view.states?.every((state) => state.kind !== 'unknown'), 'every axis prepared');
    expect(seen!.view.axis).toBe(0);
    // Another axis whose repeat lands.
    const other = seen!.view.states!.findIndex((state, k) => k > 0 && state.kind === 'lands');
    expect(other).toBeGreaterThan(0);
    act(() => seen!.verbs.setAxis(other));
    await until(() => seen?.view.axis === other, 'the axis chosen');
    const chosen = axes[other]!.sheet;
    // Put down and taken up again: the axis chosen is taken again, the range back to the step on screen.
    act(() => {
      foldTools().putDown();
    });
    act(() => foldTools().selectTool('repeat'));
    await until(() => seen?.view.range?.first === 's1' && seen.view.axes !== null, 'the axes of the range of one');
    // Whether or not that range has the axis, it stays the one remembered.
    expect(foldTools().store.getState().repeatAxis).toEqual(chosen);
    act(() => foldTools().setRepeatFirst('s0'));
    await until(() => seen?.view.range?.first === 's0' && seen.view.axes !== null, 'the axes again');
    expect(seen!.view.axis).toBe(other);
  });

  it('takes a line drawn along a verified axis, read on the top layer under it, and refuses one that is none', async () => {
    const axes = await taken();
    const middle = axes.findIndex(isMiddle);
    const other = axes.findIndex((axis) => !isMiddle(axis));
    act(() => seen!.verbs.setAxis(other));
    await until(() => seen?.view.axis === other, 'another axis');
    expect(foldTools().store.getState().repeatAxisSource).toBe('listed');
    // Along the middle axis, as the folded pane shows it: taken, drawn on the folded pane, and the line let go.
    const shown = sceneLineOf(picking!.scene.view_transform, MIDDLE);
    draw(...along(shown));
    await until(() => seen?.view.axis === middle && foldTools().store.getState().picks.length === 0, 'the drawn axis');
    expect(foldTools().store.getState().repeatAxisSource).toBe('drawn_folded');
    expect(seen!.view.drawn).toBeNull();
    expect(seen!.marks?.drawn).toBeNull();
    // A degree off the middle: no axis, so refused, and the middle offered in its place.
    const tilt = Math.PI / 180;
    const tilted: FoldModelLine = {
      n: [shown.n[0] * Math.cos(tilt) - shown.n[1] * Math.sin(tilt), shown.n[0] * Math.sin(tilt) + shown.n[1] * Math.cos(tilt)],
      d: shown.d,
    };
    draw(...along(tilted));
    await until(() => seen?.view.drawn, 'the refusal');
    expect(seen!.view.drawn).toEqual({ nearest: middle, line: true });
    // The canvas draws the refused line where it was drawn; the axis taken stays.
    expect(seen!.marks?.drawn?.pane).toBe('folded');
    expect(seen!.view.axis).toBe(middle);
  });

  it('previews an axis under the pointer in the taken one’s place, and takes it back when the pointer leaves', async () => {
    const axes = await taken(MIDDLE);
    const middle = axes.findIndex(isMiddle);
    const other = axes.findIndex((axis) => !isMiddle(axis));
    const first = await until(() => seen?.view.phase.kind === 'ready' && previewed(), 'the preview of the middle');
    expect(sameRepeatLine(first.axis, MIDDLE)).toBe(true);
    act(() => seen!.verbs.hoverAxis(other));
    expect(seen!.view.hovered).toBe(other);
    expect(seen!.marks).toMatchObject({ taken: middle, hovered: other });
    const hovered = await until(() => previewed() && !sameRepeatLine(previewed()!.axis, MIDDLE) && previewed(), 'the hovered preview');
    expect(sameRepeatLine(hovered.axis, axes[other]!.sheet)).toBe(true);
    // The axis taken stays the one chosen.
    expect(seen!.view.axis).toBe(middle);
    act(() => seen!.verbs.hoverAxis(null));
    await until(() => previewed() && sameRepeatLine(previewed()!.axis, MIDDLE), 'the middle again');
  });

  it('on Escape stops the preparation in the engine, then lets go of a line drawn, then is put down', async () => {
    const live = engine.live();
    const history = useWorkspaceStore.getState().foldHistory.past.length;
    engine.pause(true);
    await taken(MIDDLE);
    // In the middle of the preparation it began of its own accord: paused between engine calls, holding a trial state.
    await untilHolding(live);
    expect(seen?.view.phase.kind).toBe('preparing');
    // A line drawn while it prepares, that is no axis.
    draw({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.3 });
    await until(() => seen?.view.drawn, 'the refused line');

    act(() => {
      expect(seen!.cancel()).toBe(true);
    });
    engine.pause(false);
    engine.resume();
    await until(() => seen?.view.phase.kind === 'stopped', 'the stop');
    expect(engine.live()).toBe(live);
    expect(useWorkspaceStore.getState().foldHistory.past).toHaveLength(history);
    expect(useWorkspaceStore.getState().foldSequences[0]!.document.steps).toHaveLength(2);
    expect(session.store.getState().pending.status).toBe('idle');
    // Stopped, it is not prepared again until asked.
    await act(async () => settle(20));
    expect(seen?.view.phase.kind).toBe('stopped');
    expect(foldTools().store.getState()).toMatchObject({ tool: 'repeat' });
    expect(foldTools().store.getState().picks).toHaveLength(2);

    // Then the line drawn goes, Repeat still in hand.
    act(() => {
      expect(seen!.cancel()).toBe(true);
    });
    expect(foldTools().store.getState()).toMatchObject({ tool: 'repeat', picks: [] });
    // Nothing is under way now: Escape puts Repeat down.
    act(() => {
      seen!.cancel();
    });
    expect(foldTools().store.getState().tool).toBe('valley');
  });

  it('stops on Escape while the axes are still being prepared, as the window shows it preparing', async () => {
    const live = engine.live();
    engine.pause(true);
    await taken(MIDDLE);
    // The axes prepared up front, the remembered one first, held between engine calls: shown as preparing,
    // and stopped by Escape, not put down.
    expect(seen!.view.phase.kind).toBe('preparing');
    act(() => {
      expect(seen!.cancel()).toBe(true);
    });
    expect(seen!.view.phase.kind).toBe('stopped');
    expect(foldTools().store.getState().tool).toBe('repeat');
    engine.pause(false);
    engine.resume();
    // Past the pause: nothing prepared, nothing previewed, every trial state let go.
    await act(async () => new Promise((done) => setTimeout(done, 2 * REPEAT_PREPARE_DELAY_MS)));
    expect(seen!.view.phase.kind).toBe('stopped');
    expect(previewed()).toBeNull();
    await until(() => engine.live() === live, 'the trial states to go');
  });

  it('prepares again on Enter once stopped', async () => {
    const live = engine.live();
    engine.pause(true);
    await taken(MIDDLE);
    await untilHolding(live);
    act(() => {
      seen!.cancel();
    });
    engine.pause(false);
    engine.resume();
    await until(() => seen?.view.phase.kind === 'stopped', 'the stop');
    act(() => {
      expect(seen!.primary()).toBe(true);
    });
    await until(() => seen?.view.phase.kind === 'ready' && previewed(), 'the preview');
  });

  it('stops the preparation in the engine when Repeat is put down under it', async () => {
    const live = engine.live();
    engine.pause(true);
    await taken(MIDDLE);
    await untilHolding(live);
    act(() => foldTools().selectTool('mountain'));
    engine.pause(false);
    engine.resume();
    await until(() => engine.live() === live, 'the trial states to go');
    expect(seen).toBeNull();
  });

  it('opens on the one axis whose repeat lands — behind — the other offered disabled, with why, on the list and the panes', async () => {
    // The repeat-behind regression: a preliminary base, the front flap's kites and petal fold. Across the
    // other diagonal the range mirrors the front flap onto itself, and is refused at its first operation.
    const project = parseNativeProjectFile(readFileSync(resolve(process.cwd(), '../../tests/fixtures/fold-regressions/repeat-behind-diagonal.osf'), 'utf8'));
    const saved = readFoldSequences(project.workspace.foldSequences)[0]!.document;
    const bird: FoldSequenceDocument = { ...saved, steps: saved.steps.filter((step) => !isLockedStep(step) && step.op.kind !== 'repeat') };
    const petal = bird.steps.at(-1)!.id;
    act(() => {
      useWorkspaceStore.getState().installFoldSequences([{ document: bird, readOnlyRaw: null }], withFoldCursor(initialFoldReaderState(bird.id), bird, petal));
    });
    await until(() => session.store.getState().cursor === petal && selectFoldCursorNode(session.store.getState()).status === 'ok', 'the bird base replay');
    // The same-side axis remembered from before: it is not the one taken, since its repeat does not land.
    act(() => {
      foldTools().setRepeatAxis({ n: [Math.SQRT1_2, Math.SQRT1_2], d: Math.SQRT1_2 });
      foldTools().selectTool('repeat');
    });
    await act(async () => root.render(<Probe />));
    act(() => foldTools().setRepeatFirst(bird.steps.at(-3)!.id));
    await until(() => seen?.view.range?.count === 3 && seen.view.states?.length === 2 && seen.view.states.every((state) => state.kind !== 'unknown'), 'both axes prepared');
    const behind = seen!.view.axes!.findIndex((axis) => axis.side === 'behind');
    const same = 1 - behind;
    expect(seen!.view.states![behind]!.kind).toBe('lands');
    expect(seen!.view.states![same]!).toMatchObject({ kind: 'refused', step: 0 });
    expect(seen!.view.axis).toBe(behind);
    await until(() => seen?.view.phase.kind === 'ready' && previewed(), 'the repeat behind previewed');
    expect(previewed()!.side).toBe('behind');
    // The window: the axis taken is the one that lands, the other there but disabled, with its reason.
    const view: FoldToolWindowView = { tool: 'repeat', lineMode: 'crease', readOnly: null, picks: 0, preview: null, freeLineSnap: false, repeat: seen!.view };
    const model = foldToolWindow(i18n.t.bind(i18n), view, { repeat: seen!.verbs } as unknown as FoldToolWindowVerbs, { coarse: false, alt: 'Option' })!;
    expect(model.repeat?.axis.value).toBe(String(behind));
    expect(model.repeat?.axis.options[behind]).toEqual({ id: String(behind), label: 'Diagonal, bottom left to top right' });
    expect(model.repeat?.axis.options[same]).toMatchObject({ id: String(same), label: 'Diagonal, top left to bottom right', disabled: true });
    expect(model.repeat?.axis.options[same]!.description).toMatch(/^Stops at operation 1: /);
    expect(model.footer?.commit.label).toBe('Repeat behind');
    expect(model.refusal).toBeNull();
    // Taking the refused axis does nothing; on the panes it is drawn dimmer, and never under the pointer.
    act(() => seen!.verbs.setAxis(same));
    expect(seen!.view.axis).toBe(behind);
    expect(seen!.marks).toMatchObject({ taken: behind, refused: [same] });
  });
});
