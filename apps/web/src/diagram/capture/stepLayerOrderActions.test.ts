/**
 * The Layer order dialog on a Diagram step (layer order H7): Edit… and
 * Review… build the step's request from a fold of its creases, and only an
 * Apply writes — one undo step, the order folded as the dialog analysed it.
 * The dialog is its gateway, stubbed with each outcome; the kernel the
 * fixture's fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import type { LayerOrderDialogOutcome } from '../../layer-order/dialog/layerOrderDialogGateway';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { DIAGRAM_STYLE_POLICY, diagramScenePaintStyle } from '../pictures/diagramPaperStyle';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DEFAULT_DIAGRAM_STYLE, setLinkedLayerOrder, stepById, type DiagramCpSource } from '../document/diagramDocument';
import {
  cpDocument,
  fakeCaptureRuntime,
  fakeFoldSource,
  halfFoldKernelScene,
  ORDERED_HANDLE,
  STEP_LAYER_ORDER,
  STEP_LAYER_ORDER_IN_SOURCE,
  stepLayerOrderJson,
  twoSquaresIndex,
} from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { stepLayerOrderOf } from './captureLayerOrder';
import { diagramStepLayerOrderLook, openDiagramStepLayerOrder } from './stepLayerOrderActions';

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
const dialog = vi.hoisted(() => ({
  outcome: null as null | ((request: LayerOrderRequest) => LayerOrderDialogOutcome),
  openLayerOrderDialog: vi.fn(),
}));
vi.mock('../../layer-order/dialog/layerOrderDialogGateway', () => ({
  openLayerOrderDialog: dialog.openLayerOrderDialog,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const sheets = twoSquaresIndex();
const [left] = sheetRegions(sheets);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const FLAT = { mode: 'folded-flat' as const, side: 'back' as const, rotationDeg: 30, foldCase: 1 };
const json = stepLayerOrderJson();
/** The record as the dialog takes it: about the crease pattern's origin. */
const inSource = STEP_LAYER_ORDER_IN_SOURCE;

async function flatStep(render: DiagramCpSource['render'] = FLAT): Promise<string> {
  const stepId = state().addDiagramStep()!;
  await state().captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(left!) },
    render,
    kind: 'diagram-capture',
    label: 'Link pattern',
  });
  return stepId;
}
const step = (stepId: string) => stepById(state().diagram!, stepId)!;
const source = (stepId: string) => step(stepId).source as DiagramCpSource;
const asked = () => dialog.openLayerOrderDialog.mock.calls.at(-1)![0] as LayerOrderRequest;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document: cpDocument(), geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
  dialog.outcome = () => ({ kind: 'cancelled' });
  dialog.openLayerOrderDialog.mockImplementation(async (request: LayerOrderRequest) => dialog.outcome!(request));
});

describe('opening the Layer order dialog on a step', () => {
  it('asks with the step’s fold, its paper as the Diagram paints it and its turn, the scene it shows, and its name', async () => {
    const stepId = await flatStep();
    // Edit's view draws its creases in black and white, thicker.
    useWorkspaceStore.setState({
      oristudioCpViewport: { ...state().oristudioCpViewport, lineStyle: 'black-white', lineWidth: 2 },
    });
    const entries = state().diagramHistory.past.length;
    expect(await openDiagramStepLayerOrder(stepId)).toBe(false);
    const request = asked();
    expect(request.source).toMatchObject({ segments: fakeFoldSource().segments, startingFaceId: 1, digest: 'fixture-digest' });
    // The look: its paper, the Diagram's policy, the step's turn and side (its model's too), no X-ray,
    // and the crease pattern's lines as Edit's view draws them.
    expect(request.source.model.state).toBe('Back1');
    expect(request.look).toEqual({
      style: diagramScenePaintStyle(DEFAULT_DIAGRAM_STYLE, false),
      policy: DIAGRAM_STYLE_POLICY,
      turnDeg: 30,
      side: 'back',
      xray: false,
      lineStyle: 'black-white',
      lineWidth: 2,
    });
    expect(request.look).toEqual(diagramStepLayerOrderLook(DEFAULT_DIAGRAM_STYLE, FLAT, state().oristudioCpViewport));
    // Edit's view with none set: its defaults.
    expect(diagramStepLayerOrderLook(DEFAULT_DIAGRAM_STYLE, FLAT, {})).toMatchObject({ lineStyle: 'color', lineWidth: 1 });
    expect(request.record).toBeNull();
    expect(request.shown).toEqual(halfFoldKernelScene());
    expect(request.name).toBe('Step 1');
    // The surface the dialog's analytics count it under.
    expect(request.surface).toBe('diagram_step');
    // The step's sheet alone, as its crease-pattern picture draws it: the left square's
    // paper and its aux line (10), nothing of the right square.
    expect(request.region).toEqual({ paper: left!.boundary, auxSegments: [cpDocument().crease_pattern.line_segments[9]] });
    // Folded for the request and freed; nothing written for a Cancel.
    expect(bindings.runtime!.free).toHaveBeenCalledWith(7);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(state().diagramCaptures).toEqual({});
  });

  it('opens on the kernel’s order the step shows: its fold stepped to that case before its scene is read', async () => {
    const stepId = await flatStep({ ...FLAT, foldCase: 2 });
    vi.mocked(bindings.runtime!.foldToCase).mockClear();
    vi.mocked(bindings.runtime!.paperScene).mockClear();
    await openDiagramStepLayerOrder(stepId);
    expect(bindings.runtime!.foldToCase).toHaveBeenCalledWith(7, 2);
    expect(bindings.runtime!.paperScene).toHaveBeenCalledOnce();
    const order = (spy: unknown) => (spy as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]!;
    expect(order(bindings.runtime!.foldToCase)).toBeLessThan(order(bindings.runtime!.paperScene));
    expect(asked().shown).toBeDefined();
  });

  it('hands over the step’s record in the crease pattern’s coordinates, and lets it, not a scene, open the dialog', async () => {
    const stepId = await flatStep();
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, json) });
    await openDiagramStepLayerOrder(stepId);
    expect(asked().record).toEqual(inSource);
    expect(asked().shown).toBeUndefined();
  });

  it('commits an Apply as one undo step: the order folded as analysed, its record on the step’s source', async () => {
    const stepId = await flatStep();
    const before = step(stepId);
    dialog.outcome = (request) => ({
      kind: 'applied',
      applied: { record: inSource, relations: new Uint32Array([1, 0]), source: request.source },
    });
    const entries = state().diagramHistory.past.length;
    expect(await openDiagramStepLayerOrder(stepId)).toBe(true);
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'fixture-digest' }),
      new Uint32Array([1, 0]),
      expect.objectContaining({ state: 'Back1' })
    );
    expect(state().diagramHistory.past.slice(entries).map((entry) => entry.label)).toEqual(['Change layer order']);
    expect(stepLayerOrderOf(source(stepId).layerOrder)?.record).toEqual(STEP_LAYER_ORDER);
    expect(step(stepId).picture?.key).not.toBe(before.picture?.key);
    expect(bindings.runtime!.free).toHaveBeenCalledWith(ORDERED_HANDLE);
    // Undo takes the order and its record back together.
    state().undoDiagram();
    expect(source(stepId).layerOrder).toBeUndefined();
    expect(step(stepId).picture).toEqual(before.picture);
  });

  it('turns the step as the dialog’s Rotate left it, in the Apply’s one undo step', async () => {
    const stepId = await flatStep();
    dialog.outcome = (request) => ({
      kind: 'applied',
      applied: { record: inSource, relations: new Uint32Array([1, 0]), source: request.source },
      turnDeg: 75,
    });
    const entries = state().diagramHistory.past.length;
    expect(await openDiagramStepLayerOrder(stepId)).toBe(true);
    expect(source(stepId).render).toMatchObject({ mode: 'folded-flat', side: 'back', rotationDeg: 75 });
    expect(state().diagramHistory.past.slice(entries).map((entry) => entry.label)).toEqual(['Change layer order']);
    state().undoDiagram();
    expect(source(stepId).render).toEqual(FLAT);
    expect(source(stepId).layerOrder).toBeUndefined();
  });

  it('an Apply that only turned the step captures it at the turn, writing no order, as a pose’s one undo step', async () => {
    // A record would be carried as a Refresh carries it (`layerOrderOf`); this one has none to resolve.
    const stepId = await flatStep();
    const before = step(stepId);
    dialog.outcome = () => ({ kind: 'unchanged', turnDeg: 345 });
    const entries = state().diagramHistory.past.length;
    expect(await openDiagramStepLayerOrder(stepId)).toBe(false);
    expect([toasts.error.mock.calls, toasts.message.mock.calls]).toEqual([[], []]);
    expect(source(stepId).render).toMatchObject({ mode: 'folded-flat', side: 'back', rotationDeg: 345 });
    expect(source(stepId).layerOrder).toBeUndefined();
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
    expect(state().diagramHistory.past.slice(entries).map((entry) => entry.label)).toEqual(['Adjust pose']);
    state().undoDiagram();
    expect(step(stepId)).toEqual(before);
  });

  it.each([
    [{ kind: 'unchanged' } as const],
    [{ kind: 'cancelled' } as const],
    [{ kind: 'busy' } as const],
    [{ kind: 'unavailable' } as const],
  ])('writes nothing for %o (D16)', async (outcome) => {
    const stepId = await flatStep();
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, json) });
    const diagram = state().diagram;
    const entries = state().diagramHistory.past.length;
    dialog.outcome = () => outcome;
    expect(await openDiagramStepLayerOrder(stepId)).toBe(false);
    expect(state().diagram).toBe(diagram);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
  });

  it('commits nothing onto a pattern that changed while the dialog was open', async () => {
    const stepId = await flatStep();
    dialog.outcome = (request) => {
      useWorkspaceStore.setState({
        oristudioCpDocument: {
          handle: 1,
          document: cpDocument(undefined, (cp, id) => (id === 8 ? { ...cp, color: 'Blue2' } : cp)),
          geometry: null,
        } as unknown as OristudioCpDocumentState,
      });
      return { kind: 'applied', applied: { record: inSource, relations: new Uint32Array([1, 0]), source: request.source } };
    };
    const entries = state().diagramHistory.past.length;
    expect(await openDiagramStepLayerOrder(stepId)).toBe(false);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
  });

  it('commits nothing when the kernel cannot draw the order the dialog applied, and says so (D3)', async () => {
    const stepId = await flatStep();
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, json) });
    bindings.runtime = fakeCaptureRuntime({
      foldWithOrder: vi.fn(async () => ({ status: 'refused' as const, refusal: { code: 'not_found' as const } })),
    });
    dialog.outcome = (request) => ({
      kind: 'applied',
      applied: { record: { ...inSource, constraints: [] }, relations: new Uint32Array([1, 0]), source: request.source },
    });
    const diagram = state().diagram;
    const entries = state().diagramHistory.past.length;
    useWorkspaceStore.setState({ dirty: false });
    expect(await openDiagramStepLayerOrder(stepId)).toBe(false);
    // No flag, no new record: the step as it was.
    expect(state().diagram).toBe(diagram);
    expect(source(stepId).layerOrder).toBe(json);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(state().dirty).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('This layer order couldn’t be drawn, so nothing was changed.');
  });

  it('Review… opens a flagged step shown as its crease pattern on the flat fold it would show, and Apply folds it', async () => {
    const stepId = await flatStep({ mode: 'crease-pattern', rotationDeg: 0 });
    const flagged = stepLayerOrderJson({ ...STEP_LAYER_ORDER, attention: { reason: 'conflict', count: 1 } });
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, flagged) });
    // Edit… is the Layer order row's, which a crease pattern has none of.
    expect(await openDiagramStepLayerOrder(stepId, 'edit')).toBe(false);
    expect(dialog.openLayerOrderDialog).not.toHaveBeenCalled();
    dialog.outcome = (request) => ({
      kind: 'applied',
      applied: { record: inSource, relations: new Uint32Array([1, 0]), source: request.source },
    });
    expect(await openDiagramStepLayerOrder(stepId, 'review')).toBe(true);
    // A new flat pose, from the front, at no turn: as Show as Folded draws it.
    expect(asked().source.model.state).toBe('Front0');
    expect(asked().look.turnDeg).toBe(0);
    expect(asked().record).toEqual({ ...inSource, attention: { reason: 'conflict', count: 1 } });
    // From the flag: the dialog opens on the rows that need attention (D14).
    expect(asked().review).toBe(true);
    expect(source(stepId).render).toMatchObject({ mode: 'folded-flat', side: 'front', rotationDeg: 0 });
    expect(stepLayerOrderOf(source(stepId).layerOrder)?.record).toEqual(STEP_LAYER_ORDER);
  });

  it('opens nothing for a step not shown folded flat, on a read-only diagram, or locked by a newer build', async () => {
    const stepId = await flatStep({ mode: 'crease-pattern', rotationDeg: 0 });
    expect(await openDiagramStepLayerOrder(stepId)).toBe(false);
    const flat = await flatStep();
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(await openDiagramStepLayerOrder(flat)).toBe(false);
    useWorkspaceStore.setState({ diagramReadOnly: false });
    const locked = { ...step(flat), unknown: { raw: {} } };
    useWorkspaceStore.setState({
      diagram: { ...state().diagram!, steps: state().diagram!.steps.map((entry) => (entry.id === flat ? locked : entry)) },
    });
    expect(await openDiagramStepLayerOrder(flat)).toBe(false);
    expect(dialog.openLayerOrderDialog).not.toHaveBeenCalled();
  });

  it('says so, and opens nothing, when the step’s creases now fold in 3D', async () => {
    const stepId = await flatStep();
    useWorkspaceStore.setState({
      oristudioCpDocument: {
        handle: 1,
        document: cpDocument(undefined, (cp, id) => (id === 8 ? { ...cp, fold_magnitude: 90 } : cp)),
        geometry: null,
      } as unknown as OristudioCpDocumentState,
    });
    expect(await openDiagramStepLayerOrder(stepId)).toBe(false);
    expect(dialog.openLayerOrderDialog).not.toHaveBeenCalled();
    expect(toasts.message).toHaveBeenCalledWith(expect.stringContaining('fold in 3D'));
  });
});
