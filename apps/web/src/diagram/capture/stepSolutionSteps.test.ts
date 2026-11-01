// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resetFoldedFigureHandles, setFoldedFigureHandleFree } from '../../cp-workspace/folded/foldedFigureHandles';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ensureCpSheetIndex, peekCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import {
  cpDocument,
  fakeCaptureRuntime,
  fakeFoldSource,
  fakeLayerOrderResolutions,
  movedLines,
  ORDERED_HANDLE,
  STEP_LAYER_ORDER,
  STEP_LAYER_ORDER_IN_SOURCE,
  stepLayerOrderJson,
  TWO_SQUARES,
  twoSquaresIndex,
} from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { captureModel } from './captureFolded';
import { layerOrderSummaryOf, stepLayerOrderOf } from './captureLayerOrder';
import { linkStatus } from './linkStatus';
import { buildDiagramLinkedPoseActions } from '../actions/diagramLinkedPoseActions';
import { setLinkedLayerOrder, stepById, type DiagramCpRender, type DiagramCpSource } from '../document/diagramDocument';
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { stepsIn } from '../document/diagramSteps.fixtures';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import type { LayerOrderSolutionStep } from '../../layer-order/host/hostEngineGateway';
import {
  scriptedSolutionCursor,
  solutionPosition,
  type ScriptedSolutionCursor,
  type ScriptedSolutionStep,
} from '../../layer-order/host/solutionCursorTable.fixtures';
import { SOLUTION_CURSOR_IDLE_MS } from '../../layer-order/host/solutionCursorTable';
import { useLayerOrderDialogStore } from '../../layer-order/dialog/layerOrderDialogStore';
import { useLayoutStore } from '../../store/layoutStore';
import { createPoseController, type PoseController } from './poseController';
import { linkDiagramStep, refreshDiagramStep, showLinkedStepAs } from './stepCaptureActions';
import { dropStepSolutionCursor, stepSolutionCursorStep, stepSolutionPlace } from './stepSolutionCursor';

/**
 * The Diagram's ‹ › within a constrained step's layer constraints
 * (`implementation-plans/layer-order-dialog.md`, row H9, D9), through Pose's
 * controller and the store, with the CP kernel and the host engine's
 * solutions cursor stood in for: the cursor is made on the first press and
 * never before, stepped by later ones, and let go whenever the step stops
 * holding what it last landed — an undo or a redo, an Apply, a Show as, a
 * Refresh, an edit to the pattern's lines, another step, a Delete, a diagram
 * closing. Each step that moved is one undo entry, a new fold of the step's
 * order with the step's record; every other answer writes nothing, and says
 * why when it is news. An unconstrained step makes exactly the kernel calls
 * it always made, and wraps as it always did (D23).
 */

const bindings = vi.hoisted(() => ({ runtime: null as CpCaptureRuntime | null }));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: () => bindings.runtime,
}));
vi.mock('../../cp-workspace/sheets/cpSheetIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/sheets/cpSheetIndex')>()),
  ensureCpSheetIndex: vi.fn(async () => sheets),
  peekCpSheetIndex: vi.fn(() => sheets),
}));
const toasts = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
// The host engine's door: each cursor a press opens is the test's to script; a capture's restore applies.
const hostEngine = vi.hoisted(() => ({ open: vi.fn(), resolveLayerOrder: vi.fn() }));
vi.mock('../../layer-order/host/hostEngineGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer-order/host/hostEngineGateway')>()),
  openLayerOrderSolutionCursor: (...args: unknown[]) => hostEngine.open(...args),
  resolveLayerOrder: hostEngine.resolveLayerOrder,
}));
const analytics = vi.hoisted(() => ({ trackDiagramPicturePosed: vi.fn(), trackLayerConstraintsNeedAttention: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
/** A browser that can stop a kernel fold, unless a test says it can't: the run's Stop reaches its signal. */
const cancellation = vi.hoisted(() => ({ next: 0, available: true }));
vi.mock('../../lib/foldCancellation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/foldCancellation')>()),
  beginFoldRun: () => ++cancellation.next,
  cancelFoldRun: () => {},
  foldCancellationAvailable: () => cancellation.available,
}));

const sheets = twoSquaresIndex();
const [left] = sheetRegions(sheets);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const document = cpDocument();
const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
const JSON_AT_REST = stepLayerOrderJson();

/** The orders the scripted cursor steps to, as the engine saves them (its points in the crease pattern's coordinates). */
const ORDER_2: LayerOrderRecord = { ...STEP_LAYER_ORDER_IN_SOURCE, order: [[0, 1, -1]] };
const ORDER_3: LayerOrderRecord = { ...STEP_LAYER_ORDER_IN_SOURCE, order: [] };
/** The same, as the step keeps them: in its paper frame, about the centre of the fake fold's box (50, 50). */
const kept = (record: LayerOrderRecord) => stepLayerOrderJson({ ...record, faces: STEP_LAYER_ORDER.faces });

/** The source the fake kernel folds the left square from, as the host engine takes it. */
const SOURCE: LayerOrderSource = layerOrderSourceOf(fakeFoldSource(), captureModel(document, 'front'));
const RELATIONS = Uint32Array.of(1, 0);

const moved = (record: LayerOrderRecord, index: number, n: number, exact = true): LayerOrderSolutionStep => ({
  outcome: 'moved',
  applied: { record, relations: RELATIONS, source: SOURCE },
  position: solutionPosition(index, n, exact),
  counted: true,
});
const end = (index: number, n: number, exact = true): LayerOrderSolutionStep => ({
  outcome: 'end',
  position: solutionPosition(index, n, exact),
  counted: true,
});

/** Each cursor a press opens, in turn. */
let cursors: ScriptedSolutionCursor[] = [];
function script(...steps: ScriptedSolutionStep[]): ScriptedSolutionCursor {
  const cursor = scriptedSolutionCursor(steps);
  cursors.push(cursor);
  hostEngine.open.mockReturnValueOnce(cursor);
  return cursor;
}

/** Ordered folds land on handles of their own, so each step's new fold is told from the last. */
let nextHandle = ORDERED_HANDLE;
function runtime(): CpCaptureRuntime {
  return fakeCaptureRuntime({
    foldWithOrder: vi.fn(async () => ({
      status: 'folded' as const,
      handle: nextHandle++,
      discoveredCases: 1,
      displayStyle: 'Paper5' as const,
      outcome: 'Solved' as const,
      currentCase: 1,
      hasNext: false,
    })),
  });
}

/**
 * A step linked to the left square, folded flat, then given a record as an
 * Apply leaves it (and a file opens it), selected, as a step open in Pose is.
 */
async function constrainedStep(json = JSON_AT_REST): Promise<string> {
  const stepId = state().addDiagramStep()!;
  await state().captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(left!) },
    render: FLAT,
    kind: 'diagram-capture',
    label: 'Link pattern',
  });
  useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, json) });
  state().selectDiagramStep(stepId);
  return stepId;
}

const listener = () => ({ spatial: vi.fn(), solutions: vi.fn(), mirrorAxes: vi.fn(), preview: vi.fn() });
const sourceOf = (stepId: string) => stepById(state().diagram!, stepId)!.source as DiagramCpSource;
const pictureOf = (stepId: string) => stepsIn(state().diagram!).find((step) => step.id === stepId)!.picture;
const labelsSince = (entries: number) => state().diagramHistory.past.slice(entries).map((entry) => entry.label);
const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))) as never;

/**
 * The pager's ‹ and › as the Step pane draws them for the step now: from the table, saved data and the
 * link's status (`useDiagramLinkedPose`), never the engine.
 */
function pager(stepId: string) {
  const source = sourceOf(stepId);
  const pattern = state().oristudioCpDocument?.document ?? null;
  const actions = buildDiagramLinkedPoseActions(
    {
      render: source.render,
      readOnly: false,
      busy: false,
      solutions: { discovered: 1, hasNext: false },
      constrained: source.layerOrder !== undefined,
      place: stepSolutionPlace(stepId, source),
      record: layerOrderSummaryOf(source),
      stale: linkStatus(source, pattern, peekCpSheetIndex(pattern)) === 'stale',
    },
    { t, pose: vi.fn() }
  );
  const verb = (id: string) => actions.find((action) => action.id === id)!;
  return { previous: verb('previous-solution'), next: verb('next-solution'), place: stepSolutionPlace(stepId, source) };
}

let controller: PoseController | null = null;
function poseOf(stepId: string): PoseController {
  controller = createPoseController(stepId, listener());
  return controller;
}

beforeEach(async () => {
  vi.clearAllMocks();
  cancellation.available = true;
  cursors = [];
  nextHandle = ORDERED_HANDLE;
  setFoldedFigureHandleFree(() => {});
  await resetFoldedFigureHandles();
  useWorkspaceStore.setState(initialState, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document, geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = runtime();
  // A capture's restore (Refresh, a pose in the record's order): applied, as the record says.
  hostEngine.resolveLayerOrder.mockImplementation(async (source: LayerOrderSource, record: LayerOrderRecord) =>
    fakeLayerOrderResolutions.applied(record, source)
  );
});

afterEach(() => {
  controller?.dispose();
  controller = null;
  dropStepSolutionCursor();
});

describe('the cursor’s life', () => {
  it('is made on the first press, never on opening the step, and the step lands as one entry with its own record', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    // Opening it in Pose and drawing its pager ask nothing of the engine: both verbs offered, nothing read out.
    expect(pager(stepId).place).toBeNull();
    expect(pager(stepId).next.disabled).toBe(false);
    expect(pager(stepId).previous.disabled).toBe(false);
    expect(hostEngine.open).not.toHaveBeenCalled();

    const cursor = script(moved(ORDER_2, 2, 3, false));
    const entries = state().diagramHistory.past.length;
    await pose.run({ verb: 'next-solution' });
    // Made from the step's creases, folded and freed, and its record in the crease pattern's coordinates.
    expect(hostEngine.open).toHaveBeenCalledOnce();
    expect(hostEngine.open).toHaveBeenCalledWith(SOURCE, STEP_LAYER_ORDER_IN_SOURCE);
    expect(cursor.asked).toEqual([{ direction: 'next', by: { picture: 'front' } }]);
    // The order it moved to, folded as an Apply's is: the cursor's relations on its source, a new fold.
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledWith(fakeFoldSource(), RELATIONS, captureModel(document, 'front'));
    // One undo step, as a constrained figure's step is named in Edit; the record the order's, its constraints kept.
    expect(labelsSince(entries)).toEqual(['Show another solution']);
    expect(sourceOf(stepId).layerOrder).toBe(kept(ORDER_2));
    expect(stepLayerOrderOf(sourceOf(stepId).layerOrder)?.record.constraints).toEqual(STEP_LAYER_ORDER.constraints);
    // Where it stands, once a press asked: the pager reads it, and goes on.
    expect(pager(stepId).place).toEqual({ position: solutionPosition(2, 3, false), counted: true });
    expect(stepSolutionCursorStep()).toBe(stepId);
    expect(cursor.closed).toBe(false);
    // Counted as Pose's step to another layer order, within constraints.
    expect(analytics.trackDiagramPicturePosed).toHaveBeenCalledWith('next_solution', 'flat', { constrained: true });
  });

  it('steps on and back with the same cursor, one entry a press, holding at each end it finds', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(moved(ORDER_2, 2, 3, false), moved(ORDER_3, 3, 3), end(3, 3), moved(ORDER_2, 2, 3), moved(STEP_LAYER_ORDER_IN_SOURCE, 1, 3));
    const entries = state().diagramHistory.past.length;
    await pose.run({ verb: 'next-solution' });
    await pose.run({ verb: 'next-solution' });
    expect(sourceOf(stepId).layerOrder).toBe(kept(ORDER_3));
    // The last, once the count is final: › waits there, saying why in the cursor's words (the solutions
    // that fit, never the fold's layer orders); it does not wrap round.
    expect(pager(stepId).next).toMatchObject({ disabled: true, hint: 'This is its last solution' });
    // Pressed at the end anyway (a surface that keeps it focusable): nothing written, nothing said.
    await pose.run({ verb: 'next-solution' });
    expect(labelsSince(entries)).toEqual(['Show another solution', 'Show another solution']);
    expect(toasts.message).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
    await pose.run({ verb: 'previous-solution' });
    await pose.run({ verb: 'previous-solution' });
    expect(sourceOf(stepId).layerOrder).toBe(kept(STEP_LAYER_ORDER_IN_SOURCE));
    expect(pager(stepId).previous).toMatchObject({ disabled: true, hint: 'This is its first solution' });
    expect(labelsSince(entries)).toEqual([
      'Show another solution',
      'Show another solution',
      'Show previous solution',
      'Show previous solution',
    ]);
    // One cursor, one worker, for all of them.
    expect(hostEngine.open).toHaveBeenCalledOnce();
    expect(cursor.asked.map((asked) => asked.direction)).toEqual(['next', 'next', 'next', 'previous', 'previous']);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenLastCalledWith('previous_solution', 'flat', { constrained: true });
  });

  it('waits at an end a press proved, whatever the count says, and says nothing (E9)', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    script(moved(ORDER_2, 2, 3, false), end(2, 3, false));
    const entries = state().diagramHistory.past.length;
    await pose.run({ verb: 'next-solution' });
    await pose.run({ verb: 'next-solution' });
    // The press that found the end wrote nothing and said nothing: asking again gains nothing.
    expect(labelsSince(entries)).toEqual(['Show another solution']);
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.message).not.toHaveBeenCalled();
    // The count has not settled, and still › waits there; ‹ goes back.
    expect(pager(stepId).place).toEqual({
      position: solutionPosition(2, 3, false),
      counted: true,
      ended: { previous: false, next: true },
    });
    expect(pager(stepId).next).toMatchObject({ disabled: true, hint: 'This is its last solution' });
    expect(pager(stepId).previous.disabled).toBe(false);
  });

  it('offers Keep trying when the next isn’t found in time, a toast a try, going on from what it proved', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const timedOut = { outcome: 'timed_out', stage: 'step' } as const;
    const cursor = script(timedOut, timedOut, moved(ORDER_2, 2, 2));
    const entries = state().diagramHistory.past.length;
    await pose.run({ verb: 'next-solution' });
    expect(state().diagramHistory.past).toHaveLength(entries);
    type Said = [string, { id: string; action: { label: string; onClick: () => void } }];
    // Said calmly: running out of time is an answer, not a fault.
    expect(toasts.error).not.toHaveBeenCalled();
    const [said, first] = toasts.message.mock.calls[0]! as Said;
    expect(said).toBe('Couldn’t find another solution in time, so this step wasn’t changed.');
    expect(first.action.label).toBe('Keep trying');
    expect(pager(stepId).next.disabled).toBe(false);
    // Keep trying: the same direction again, on the same worker, with longer limits; its toast a fresh one,
    // since clicking Keep trying dismisses the one it came from.
    first.action.onClick();
    await vi.waitFor(() => expect(toasts.message).toHaveBeenCalledTimes(2));
    const [, second] = toasts.message.mock.calls[1]! as Said;
    // Under an id of the calm kind's own: sonner would draw a message under an error's id as the error.
    expect([first.id, second.id]).toEqual(['diagram-layer-order-step-0-timed-out', 'diagram-layer-order-step-1-timed-out']);
    second.action.onClick();
    await vi.waitFor(() => expect(sourceOf(stepId).layerOrder).toBe(kept(ORDER_2)));
    expect(cursor.triesAsked).toEqual([0, 1, 2]);
    expect(cursor.asked.map((asked) => asked.direction)).toEqual(['next', 'next', 'next']);
    expect(hostEngine.open).toHaveBeenCalledOnce();
    expect(labelsSince(entries)).toEqual(['Show another solution']);
  });

  it('holds ‹ › while its record needs a look since an edit, pointing at Review…, and a press asks nothing of the engine', async () => {
    // Clashing (D10), or any other summary a capture wrote (D14): nothing to step through until reviewed.
    for (const attention of [{ reason: 'conflict', count: 1 }, { reason: 'timeout', count: 2 }] as const) {
      useWorkspaceStore.setState({ diagram: null });
      const stepId = await constrainedStep(stepLayerOrderJson({ ...STEP_LAYER_ORDER, attention }));
      for (const verb of [pager(stepId).previous, pager(stepId).next]) {
        expect(verb).toMatchObject({ disabled: true, hint: 'Review the layer constraints that need attention first' });
      }
      // A surface that keeps it focusable, pressed anyway: nothing made, nothing written, nothing said.
      const entries = state().diagramHistory.past.length;
      await poseOf(stepId).run({ verb: 'next-solution' });
      expect(hostEngine.open).not.toHaveBeenCalled();
      expect(state().diagramHistory.past).toHaveLength(entries);
      expect(toasts.error).not.toHaveBeenCalled();
      expect(toasts.message).not.toHaveBeenCalled();
      controller?.dispose();
      controller = null;
    }
  });

  it('is let go on an undo of a step, which shows the order before; redo brings the step back, and the next press makes a fresh one', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const first = script(moved(ORDER_2, 2, 3, false));
    await pose.run({ verb: 'next-solution' });
    pose.historyMoved();
    expect(state().undoDiagram()).toBe(true);
    expect(sourceOf(stepId).layerOrder).toBe(JSON_AT_REST);
    expect(first.closed).toBe(true);
    expect(pager(stepId).place).toBeNull();
    pose.historyMoved();
    expect(state().redoDiagram()).toBe(true);
    expect(sourceOf(stepId).layerOrder).toBe(kept(ORDER_2));
    // Redone, the step shows the order again, but no cursor stands on it: nothing read out until a press.
    expect(stepSolutionCursorStep()).toBeNull();
    expect(pager(stepId).place).toBeNull();
    await Promise.resolve();
    const second = script(moved(ORDER_3, 3, 3));
    await pose.run({ verb: 'next-solution' });
    expect(hostEngine.open).toHaveBeenCalledTimes(2);
    // Made from the record it holds now, the redone one.
    expect(hostEngine.open.mock.calls[1]![1]).toMatchObject({ order: ORDER_2.order, constraints: ORDER_2.constraints });
    expect(second.closed).toBe(false);
  });

  it('is let go when an Apply, a Relink or another record replaces the step’s', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(end(1, 3, false));
    await pose.run({ verb: 'next-solution' });
    expect(cursor.closed).toBe(false);
    const other = stepLayerOrderJson({ ...STEP_LAYER_ORDER, constraints: [[1, 0, 1]] });
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, other) });
    expect(cursor.closed).toBe(true);
  });

  it('is let go by a Refresh, which restores the stepped order the step was left on', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(moved(ORDER_2, 2, 3, false));
    await pose.run({ verb: 'next-solution' });
    // The restore gives back the very record it was asked with: the step's text is as it was, and still
    // the cursor goes, since a capture from outside Pose restores the record afresh.
    hostEngine.resolveLayerOrder.mockImplementation(async (source: LayerOrderSource, record: LayerOrderRecord) => ({
      outcome: 'applied',
      applied: { record, relations: RELATIONS, source },
      found: { saved_constraints: [], carried: [], opened_on: { kind: 'held', ignored: 0 } },
      record,
      attention: null,
    }));
    const json = sourceOf(stepId).layerOrder;
    expect(await refreshDiagramStep(stepId)).toBe(true);
    expect(sourceOf(stepId).layerOrder).toBe(json);
    expect(cursor.closed).toBe(true);
    // The record it restored is the order stepped to, with its constraints: Refresh keeps it.
    const [, restored] = hostEngine.resolveLayerOrder.mock.calls.at(-1)! as [LayerOrderSource, LayerOrderRecord];
    expect(restored.order).toEqual(ORDER_2.order);
    expect(restored.constraints).toEqual(ORDER_2.constraints);
    expect(stepLayerOrderOf(sourceOf(stepId).layerOrder)?.record.order).toEqual(ORDER_2.order);
  });

  it('is let go by Show as in Pose: the step is no longer shown flat', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(end(1, 3, false));
    await pose.run({ verb: 'next-solution' });
    await pose.run({ verb: 'show-crease-pattern' });
    expect(sourceOf(stepId).render.mode).toBe('crease-pattern');
    expect(cursor.closed).toBe(true);
    // Its record went with it, and back: shown folded again, the next press makes a fresh cursor.
    await pose.run({ verb: 'show-folded' });
    script(end(1, 3, false));
    await pose.run({ verb: 'next-solution' });
    expect(hostEngine.open).toHaveBeenCalledTimes(2);
  });

  it('is let go by a capture from outside Pose (a card’s Show as, Refresh All, a Relink), as it begins', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(end(1, 3, false));
    await pose.run({ verb: 'next-solution' });
    // With no Pose published for the step, a card's Show as is the store's capture.
    expect(await showLinkedStepAs(stepId, 'crease-pattern', 'card')).toBe(true);
    expect(cursor.closed).toBe(true);
    // A Relink to its own sheet keeps the record and restores it: the cursor goes as the capture begins.
    await pose.run({ verb: 'show-folded' });
    const again = script(end(1, 3, false));
    await pose.run({ verb: 'next-solution' });
    expect(again.closed).toBe(false);
    const relinked = linkDiagramStep(stepId, left!, 'folded');
    expect(again.closed).toBe(true);
    expect(await relinked).toBe(true);
    expect(sourceOf(stepId).layerOrder).toBeDefined();
  });

  it('is let go when Pose lets the step go: another step, or the detail closing', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(end(1, 3, false));
    await pose.run({ verb: 'next-solution' });
    pose.dispose();
    controller = null;
    expect(cursor.closed).toBe(true);
    expect(stepSolutionCursorStep()).toBeNull();
  });

  it('waits while its pattern changed since it was captured, keeping the cursor, as a stale figure waits in Edit', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(moved(ORDER_2, 2, 3, false), moved(ORDER_3, 3, 3, false));
    await pose.run({ verb: 'next-solution' });
    const shown = (edited: typeof document) =>
      useWorkspaceStore.setState({
        oristudioCpDocument: { handle: 1, document: edited, geometry: null } as unknown as OristudioCpDocumentState,
      });
    // One of the step's creases drawn in a colour of its own, or turned from a mountain to a valley: the
    // Step pane's "Pattern changed" (`linkStatus`), as Edit's staleness reads a custom colour too. Both
    // verbs wait, saying why; pressed anyway, nothing is asked and nothing said, and the cursor is kept.
    for (const patch of [
      (cp: (typeof document)['crease_pattern']['line_segments'][number], id: number) =>
        id === 8 ? { ...cp, customized: 1, customized_color: { red: 1, green: 2, blue: 3 } } : cp,
      (cp: (typeof document)['crease_pattern']['line_segments'][number], id: number) => (id === 8 ? { ...cp, color: 'Blue2' as const } : cp),
    ]) {
      shown(cpDocument(undefined, patch));
      for (const verb of [pager(stepId).previous, pager(stepId).next]) {
        expect(verb).toMatchObject({ disabled: true, hint: 'Its pattern changed since it was captured' });
      }
      await pose.run({ verb: 'next-solution' });
      expect(cursor.asked).toHaveLength(1);
      expect(cursor.closed).toBe(false);
    }
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.message).not.toHaveBeenCalled();
    // Put back as it was captured: the same cursor steps on.
    shown(document);
    expect(pager(stepId).next.disabled).toBe(false);
    await pose.run({ verb: 'next-solution' });
    expect(sourceOf(stepId).layerOrder).toBe(kept(ORDER_3));
    expect(hostEngine.open).toHaveBeenCalledOnce();
  });

  it('makes a fresh cursor once its creases moved with their sheet: its link current, its lines elsewhere', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(end(1, 3, false));
    await pose.run({ verb: 'next-solution' });
    const elsewhere = twoSquaresIndex({ dx: 300 });
    vi.mocked(peekCpSheetIndex).mockImplementation(() => elsewhere);
    vi.mocked(ensureCpSheetIndex).mockImplementation(async () => elsewhere);
    try {
      useWorkspaceStore.setState({
        oristudioCpDocument: {
          handle: 1,
          document: cpDocument(movedLines(TWO_SQUARES, 300, 0)),
          geometry: null,
        } as unknown as OristudioCpDocumentState,
      });
      // Found where it went, by what it is: not changed, so ‹ › are offered.
      expect(pager(stepId).previous.hint).not.toBe('Its pattern changed since it was captured');
      const fresh = script(end(1, 3, false));
      await pose.run({ verb: 'previous-solution' });
      expect(cursor.closed).toBe(true);
      expect(hostEngine.open).toHaveBeenCalledTimes(2);
      expect(fresh.asked).toHaveLength(1);
    } finally {
      vi.mocked(peekCpSheetIndex).mockImplementation(() => sheets);
      vi.mocked(ensureCpSheetIndex).mockImplementation(async () => sheets);
    }
  });

  it('is let go, with its worker, when another step is selected, the workspace switches or the dialog opens', async () => {
    for (const meanwhile of [
      () => state().selectDiagramStep(null),
      () => useLayoutStore.setState({ activeWorkspace: useLayoutStore.getState().activeWorkspace === 'edit' ? 'diagram' : 'edit' }),
      () => useLayerOrderDialogStore.setState({ opening: { id: 99 } as never }),
    ]) {
      const workspace = useLayoutStore.getState().activeWorkspace;
      useWorkspaceStore.setState({ diagram: null });
      const stepId = await constrainedStep();
      const pose = poseOf(stepId);
      const cursor = script(end(1, 3, false));
      await pose.run({ verb: 'next-solution' });
      expect(cursor.closed).toBe(false);
      try {
        meanwhile();
        expect(cursor.closed).toBe(true);
        expect(stepSolutionCursorStep()).toBeNull();
      } finally {
        useLayoutStore.setState({ activeWorkspace: workspace });
        useLayerOrderDialogStore.setState({ opening: null });
        pose.dispose();
        controller = null;
      }
    }
  });

  it('lets its worker go after a minute with no press, keeping the readout, and is kept through presses', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(moved(ORDER_2, 2, 3, false), moved(ORDER_3, 3, 3, false));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await pose.run({ verb: 'next-solution' });
      vi.advanceTimersByTime(SOLUTION_CURSOR_IDLE_MS - 1000);
      await pose.run({ verb: 'next-solution' });
      vi.advanceTimersByTime(SOLUTION_CURSOR_IDLE_MS - 1000);
      expect(cursor.closed).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(cursor.closed).toBe(true);
      expect(stepSolutionCursorStep()).toBeNull();
      // Where it stands is still read out, while the step holds what it did.
      expect(pager(stepId).place).toEqual({ position: solutionPosition(3, 3, false), counted: true });
      expect(hostEngine.open).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is let go when the step is deleted, and when the diagram closes or another opens', async () => {
    for (const close of [
      (stepId: string) => state().deleteDiagramSteps([stepId]),
      () => state().installDiagram(null),
      () => state().installDiagram(readDiagram(JSON.parse(JSON.stringify(writeDiagram(state().diagram!))))),
    ]) {
      useWorkspaceStore.setState({ diagram: null });
      const stepId = await constrainedStep();
      const pose = poseOf(stepId);
      const cursor = script(end(1, 3, false));
      await pose.run({ verb: 'next-solution' });
      expect(cursor.closed).toBe(false);
      close(stepId);
      expect(cursor.closed).toBe(true);
      pose.dispose();
      controller = null;
    }
  });

  it('asks where it stands again once the step turns over, and reads nothing until it answers', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = scriptedSolutionCursor([moved(ORDER_2, 2, 3, false)], [{ position: solutionPosition(1, 2), counted: true }]);
    hostEngine.open.mockReturnValueOnce(cursor);
    await pose.run({ verb: 'next-solution' });
    await pose.run({ verb: 'turn-over' });
    expect(sourceOf(stepId).render).toMatchObject({ side: 'back' });
    // The record is unchanged: still in step, asked for the back's pictures.
    expect(cursor.closed).toBe(false);
    expect(cursor.placesAsked).toEqual([{ picture: 'back' }]);
    await vi.waitFor(() => expect(pager(stepId).place).toEqual({ position: solutionPosition(1, 2), counted: true }));
  });

  it('saves the order it was left on, which a reload opens on, with no cursor until the next press', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    script(moved(ORDER_2, 2, 3, false));
    await pose.run({ verb: 'next-solution' });
    const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(state().diagram!))))!;
    pose.dispose();
    controller = null;
    state().installDiagram(read);
    expect(sourceOf(stepId).layerOrder).toBe(kept(ORDER_2));
    expect(stepSolutionCursorStep()).toBeNull();
    expect(pager(stepId).place).toBeNull();
    script(moved(ORDER_3, 3, 3));
    await poseOf(stepId).run({ verb: 'next-solution' });
    expect(hostEngine.open.mock.calls.at(-1)![1]).toMatchObject({ order: ORDER_2.order, constraints: ORDER_2.constraints });
    expect(sourceOf(stepId).layerOrder).toBe(kept(ORDER_3));
  });
});

describe('what it steps from', () => {
  it('reads the fold Pose holds in the record’s order: no fold of its own (one session, whichever surface pressed)', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    // A Pose verb first, so Pose holds the step's fold, drawn in its record's order.
    await pose.run({ verb: 'rotate-right' });
    const folds = vi.mocked(bindings.runtime!.fold).mock.calls.length;
    script(moved(ORDER_2, 2, 3, false));
    await pose.run({ verb: 'next-solution' });
    expect(vi.mocked(bindings.runtime!.fold).mock.calls.length).toBe(folds);
    expect(bindings.runtime!.source).toHaveBeenLastCalledWith(ORDERED_HANDLE);
    // The step keeps its turn: the order moved, the pose did not.
    expect(sourceOf(stepId).render).toMatchObject({ mode: 'folded-flat', rotationDeg: 15 });
  });

  it('steps by the pictures of the side the step shows', async () => {
    const stepId = await constrainedStep();
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: stepsIn(state().diagram!).map((step) =>
          step.id === stepId && step.source?.kind === 'cp' ? { ...step, source: { ...step.source, render: { ...FLAT, side: 'back' } } } : step
        ),
      },
    });
    const cursor = script(end(1, 3, false));
    await poseOf(stepId).run({ verb: 'previous-solution' });
    expect(cursor.asked).toEqual([{ direction: 'previous', by: { picture: 'back' } }]);
  });
});

describe('a press that moves nothing writes nothing', () => {
  // By cause (H6's review): each its own words; running out of time offers Keep trying and keeps the cursor,
  // said calmly (a message, not an error): it is an answer, not a fault.
  it.each([
    // Only a reload retries a load that failed: Reload, the toast's one action.
    [
      'lost loading',
      { outcome: 'lost', cause: 'load' },
      'Layer order couldn’t load, so this step wasn’t changed. Reload Ori Studio to try again.',
      'Reload',
      true,
      'error',
    ],
    [
      'lost',
      { outcome: 'lost', cause: 'crashed' },
      'Layer order stopped unexpectedly, so this step wasn’t changed.',
      undefined,
      true,
      'error',
    ],
    [
      'its record not checked in time',
      { outcome: 'timed_out', stage: 'restore' },
      'Couldn’t check this step’s layer constraints in time, so it wasn’t changed.',
      'Keep trying',
      false,
      'message',
    ],
    [
      'the next not found in time',
      { outcome: 'timed_out', stage: 'step' },
      'Couldn’t find another solution in time, so this step wasn’t changed.',
      'Keep trying',
      false,
      'message',
    ],
    [
      'too large',
      { outcome: 'too_large' },
      'The next layer order is too large to save with this step, so it wasn’t changed.',
      undefined,
      true,
      'error',
    ],
    [
      'refused',
      { outcome: 'unrestored', why: 'refused' },
      'Layer order can’t step through this step’s solutions, so it wasn’t changed.',
      undefined,
      true,
      'error',
    ],
    [
      // Said so it reads without a flag: a stale step waits for a Refresh, and a flagged one for Review….
      'clashing',
      { outcome: 'unrestored', why: 'clash' },
      'This step’s layer constraints clash with its pattern as it is now, so it can’t step through its solutions. Edit its layer order to review them.',
      undefined,
      true,
      'error',
    ],
  ] as const)('%s: no undo step, not dirty, the picture kept, said', async (_name, answer, said, action, spent, how) => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(answer as LayerOrderSolutionStep);
    // A real cursor that lost its engine or found nothing to restore is spent; the scripted one is closed by the table.
    useWorkspaceStore.setState({ dirty: false });
    const entries = state().diagramHistory.past.length;
    const picture = pictureOf(stepId);
    await pose.run({ verb: 'next-solution' });
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(state().dirty).toBe(false);
    expect(pictureOf(stepId)).toBe(picture);
    expect(sourceOf(stepId).layerOrder).toBe(JSON_AT_REST);
    expect(toasts[how]).toHaveBeenCalledOnce();
    expect(toasts[how === 'error' ? 'message' : 'error']).not.toHaveBeenCalled();
    const [text, options] = toasts[how].mock.calls[0]! as [string, { id?: string; action?: { label: string } }];
    expect(text).toBe(said);
    // One toast at a time for a step's presses at the same try (a Keep trying's is a fresh one): each kind
    // under an id of its own, the other kind's dismissed, since sonner merges a toast into what its id held.
    const ids = { error: 'diagram-layer-order-step-0', message: 'diagram-layer-order-step-0-timed-out' };
    expect(options.id).toBe(ids[how]);
    expect(toasts.dismiss).toHaveBeenCalledWith(ids[how === 'error' ? 'message' : 'error']);
    expect(options.action?.label).toBe(action);
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
    expect(analytics.trackDiagramPicturePosed).not.toHaveBeenCalled();
    // A lost, refused or unrestored session is gone; one that ran out of time is kept for Keep trying.
    expect(cursor.closed).toBe(spent);
  });

  it('says to reconnect first when the engine didn’t load while offline, with Reload', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const stepId = await constrainedStep();
      script({ outcome: 'lost', cause: 'load' });
      await poseOf(stepId).run({ verb: 'next-solution' });
      const [text, options] = toasts.error.mock.calls[0]! as [string, { action: { label: string } }];
      expect(text).toBe(
        'Layer order couldn’t load while offline, so this step wasn’t changed. Reconnect, then reload Ori Studio to try again.'
      );
      expect(options.action.label).toBe('Reload');
    } finally {
      online.mockRestore();
    }
  });

  it('says nothing for a press whose step moved on while it ran (an undo)', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    let answer: (step: LayerOrderSolutionStep) => void = () => {};
    const cursor = script(() => new Promise((resolve) => (answer = resolve)));
    const pressed = pose.run({ verb: 'next-solution' });
    await vi.waitFor(() => expect(cursor.asked).toHaveLength(1));
    // Another record lands meanwhile (an undo of an Apply, say), then the engine runs out of time.
    const other = stepLayerOrderJson({ ...STEP_LAYER_ORDER, constraints: [[1, 0, 1]] });
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, other) });
    answer({ outcome: 'timed_out', stage: 'step' });
    await pressed;
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.message).not.toHaveBeenCalled();
    expect(sourceOf(stepId).layerOrder).toBe(other);
  });

  it('stops the engine’s half of a press even where the kernel’s fold can’t be stopped', async () => {
    cancellation.available = false;
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    // Held already in the record's order, so the press folds nothing of its own: all of it is the engine's.
    await pose.run({ verb: 'rotate-right' });
    const cursor = script(
      ({ signal }) =>
        new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ outcome: 'cancelled' }), { once: true }))
    );
    const pressed = pose.run({ verb: 'next-solution' });
    await vi.waitFor(() => expect(cursor.asked).toHaveLength(1));
    expect(state().stopDiagramCapture(stepId)).toBe(true);
    await pressed;
    expect(cursor.closed).toBe(true);
  });

  it('a Stop ends the step through the capture’s fold run, quietly, and the cursor with it', async () => {
    const stepId = await constrainedStep();
    const pose = poseOf(stepId);
    const cursor = script(
      ({ signal }) =>
        new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ outcome: 'cancelled' }), { once: true }))
    );
    const entries = state().diagramHistory.past.length;
    const pressed = pose.run({ verb: 'next-solution' });
    await vi.waitFor(() => expect(cursor.asked).toHaveLength(1));
    expect(state().stopDiagramCapture(stepId)).toBe(true);
    await pressed;
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(cursor.closed).toBe(true);
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.message).not.toHaveBeenCalled();
  });

  it('an order the kernel can’t draw writes nothing, says so, and the cursor goes', async () => {
    const stepId = await constrainedStep();
    vi.mocked(bindings.runtime!.foldWithOrder!).mockResolvedValueOnce({ status: 'refused', refusal: { code: 'order_not_reproduced' } } as never);
    const pose = poseOf(stepId);
    const cursor = script(moved(ORDER_2, 2, 3, false));
    const entries = state().diagramHistory.past.length;
    await pose.run({ verb: 'next-solution' });
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(sourceOf(stepId).layerOrder).toBe(JSON_AT_REST);
    expect(toasts.error).toHaveBeenCalledWith('This layer order couldn’t be drawn, so nothing was changed.');
    expect(cursor.closed).toBe(true);
  });
});

describe('an unconstrained step (the parity guard)', () => {
  it('steps on and back with exactly the kernel calls it always made, and no cursor', async () => {
    const stepId = state().addDiagramStep()!;
    await state().captureDiagramStep(stepId, {
      scope: { kind: 'segment', region: regionReferenceFor(left!) },
      render: FLAT,
      kind: 'diagram-capture',
      label: 'Link pattern',
    });
    const pose = poseOf(stepId);
    await pose.run({ verb: 'show-folded' });
    const before = vi.mocked(bindings.runtime!.foldAnother).mock.calls.length;
    await pose.run({ verb: 'next-solution' });
    await pose.run({ verb: 'previous-solution' });
    expect(vi.mocked(bindings.runtime!.foldAnother).mock.calls.length).toBe(before + 1);
    expect(bindings.runtime!.foldToCase).toHaveBeenCalledWith(7, 1);
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
    expect(bindings.runtime!.source).not.toHaveBeenCalled();
    expect(hostEngine.open).not.toHaveBeenCalled();
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    expect(labelsSince(state().diagramHistory.past.length - 2)).toEqual(['Adjust pose', 'Adjust pose']);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenCalledWith('next_solution', 'flat', {});
    // The Step pane's › wraps past the last (D23); only Pose's toolbar, with no readout, holds there.
    const source = sourceOf(stepId);
    const at = (stopsAtLast: boolean) =>
      buildDiagramLinkedPoseActions(
        { render: { ...FLAT, foldCase: 2 }, readOnly: false, busy: false, solutions: { discovered: 2, hasNext: false } },
        { t, pose: vi.fn() },
        { stopsAtLast }
      ).find((action) => action.id === 'next-solution')!.disabled;
    expect(source.layerOrder).toBeUndefined();
    expect(at(false)).toBe(false);
    expect(at(true)).toBe(true);
  });
});
