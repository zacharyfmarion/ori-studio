import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resetFoldedFigureHandles, setFoldedFigureHandleFree } from '../../cp-workspace/folded/foldedFigureHandles';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCpRender, DiagramLayerSpread } from '../document/diagramDocument';
import { stepsIn } from '../document/diagramSteps.fixtures';
import type { LayerOrderRequest, LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import {
  cpDocument,
  fakeCaptureRuntime,
  fakeLayerOrderResolutions,
  STEP_LAYER_ORDER_IN_SOURCE,
  twoSquaresIndex,
} from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { openDiagramStepLayerOrder } from './stepLayerOrderActions';
import { useDiagramLinkedPose, type DiagramLinkedPose } from './useDiagramLinkedPose';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import { DEFAULT_CONNECTED_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { connectedSpreadSource } from '../../cp-workspace/folded/connectedSpreadSource';
import { connectedPaperScene } from '../../layer-spread/connectedScene';

/**
 * The Step pane's spread rows reach the controller only through this hook:
 * which verb each choice runs, and each slider's range (13g review). The
 * controller and the store are real; the kernel is the capture fixtures'.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preparation = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../../layer-spread/prepareConnected', () => ({ prepareConnected: (...args: unknown[]) => preparation.start(...args) }));
const capture = vi.hoisted(() => ({ scene: vi.fn() }));
vi.mock('../../layer-spread/captureConnected', () => ({ captureConnected: (...args: unknown[]) => capture.scene(...args) }));

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
const toasts = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const hostEngine = vi.hoisted(() => ({ resolveLayerOrder: vi.fn() }));
vi.mock('../../layer-order/host/hostEngineGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer-order/host/hostEngineGateway')>()),
  resolveLayerOrder: hostEngine.resolveLayerOrder,
}));
const dialog = vi.hoisted(() => ({ openLayerOrderDialog: vi.fn() }));
vi.mock('../../layer-order/dialog/layerOrderDialogGateway', () => ({
  openLayerOrderDialog: dialog.openLayerOrderDialog,
}));

const sheets = twoSquaresIndex();
const [left] = sheetRegions(sheets);
const state = () => useWorkspaceStore.getState();
const DEPTH = { kind: 'depth' as const, amount: 0.025, toward: 'down' as const };
const AFFINE = { kind: 'affine' as const, amount: 0.03, keep: 'top' as const, skew: 1, axisDeg: 81 };

const seen: { pose: DiagramLinkedPose | null } = { pose: null };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Probe({ stepId }: { stepId: string }) {
  const step = useWorkspaceStore((store) => stepsIn(store.diagram!).find((each) => each.id === stepId) ?? null);
  const pose = useDiagramLinkedPose(step);
  useLayoutEffect(() => {
    seen.pose = pose;
  });
  return null;
}

/** A step linked to the left square, shown folded flat with `spread`, the hook mounted on it. */
async function flatStep(spread: DiagramLayerSpread): Promise<string> {
  return linkedStep({ mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1, spread });
}

/** A step linked to the left square, shown as `render`, the hook mounted on it. */
async function linkedStep(render: DiagramCpRender): Promise<string> {
  const stepId = state().addDiagramStep()!;
  await state().captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(left!) },
    render: { mode: 'crease-pattern', rotationDeg: 0 },
    kind: 'diagram-capture',
    label: 'Link pattern',
  });
  useWorkspaceStore.setState({
    diagram: {
      ...state().diagram!,
      steps: stepsIn(state().diagram!).map((step) =>
        step.id === stepId && step.source?.kind === 'cp'
          ? { ...step, source: { ...step.source, render } }
          : step
      ),
    },
  });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root!.render(<Probe stepId={stepId} />));
  return stepId;
}

const spreadOf = (stepId: string) => {
  const source = stepsIn(state().diagram!).find((step) => step.id === stepId)?.source;
  return source?.kind === 'cp' && source.render.mode === 'folded-flat' ? source.render.spread : undefined;
};

/** Until the spread lands as `expected`. */
async function landed(stepId: string, expected: DiagramLayerSpread) {
  await act(async () => {
    await vi.waitFor(() => expect(spreadOf(stepId)).toEqual(expected));
  });
}

/** Stop the next creases lookup — a verb's capture — until it is opened. */
function holdTheLookup(): () => void {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  vi.mocked(ensureCpSheetIndex).mockImplementationOnce(async () => {
    await gate;
    return sheets;
  });
  return open;
}

beforeEach(async () => {
  preparation.start.mockReset();
  capture.scene.mockReset();
  setFoldedFigureHandleFree(() => {});
  await resetFoldedFigureHandles();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document: cpDocument(), geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
});

it('covers Affine → Default from the click through post-fold solve and capture, before the saved mode changes', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { initSync, solve_layer_spread } = await import('../../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm');
  initSync({module:readFileSync(resolve('src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm'))});
  let finishSolve!: () => void;
  let finishCapture!: () => void;
  preparation.start.mockImplementation(scene => {
    const source = connectedSpreadSource(scene);
    const prepared = {source, solution:solve_layer_spread(source.input)};
    return {promise:new Promise(resolve=>{finishSolve=()=>resolve(prepared);}), release:vi.fn()};
  });
  capture.scene.mockImplementation(scene => new Promise(resolve => {
    finishCapture = () => resolve(connectedPaperScene(scene.connected, scene.sheet, true));
  }));
  const stepId = await flatStep(AFFINE);
  const releaseLookup = holdTheLookup();
  act(() => seen.pose!.spread!.kinds.find(kind=>kind.value==='connected')!.run());
  expect(spreadOf(stepId)).toEqual(AFFINE);
  expect(seen.pose!.connectedPreparing).toBe(true);
  await act(async () => {
    releaseLookup();
    await vi.waitFor(()=>expect(preparation.start).toHaveBeenCalledOnce());
  });
  // Folding has ended, but solving and the replacement picture have not.
  expect(state().oristudioCpFoldRuns).toEqual({});
  expect(state().diagramCaptures[stepId]).toMatchObject({blocksPose:true});
  expect(spreadOf(stepId)).toEqual(AFFINE);
  expect(seen.pose!.connectedPreparing).toBe(true);
  await act(async () => { finishSolve(); await vi.waitFor(()=>expect(capture.scene).toHaveBeenCalledOnce()); });
  expect(spreadOf(stepId)).toEqual(AFFINE);
  expect(seen.pose!.connectedPreparing).toBe(true);
  await act(async () => {
    finishCapture();
    await vi.waitFor(()=>expect(seen.pose!.connected).not.toBeNull());
  });
  expect(spreadOf(stepId)).toEqual(DEFAULT_CONNECTED_SPREAD);
  expect(seen.pose!.connectedPreparing).toBe(false);

  // A live reveal captures in the background, without covering the interactive view.
  const releaseReveal = holdTheLookup();
  act(() => seen.pose!.onReveal([1, .5]));
  await act(async()=>{await vi.waitFor(()=>expect(state().diagramCaptures[stepId]).toBeDefined());});
  expect(seen.pose!.connectedPreparing).toBe(false);
  expect(state().diagramCaptures[stepId]?.blocksPose).toBeUndefined();
  await act(async()=>{releaseReveal();await vi.waitFor(()=>expect(capture.scene).toHaveBeenCalledTimes(2));});
  await act(async()=>{finishCapture();await vi.waitFor(()=>expect(state().diagramCaptures[stepId]).toBeUndefined());});
});

it('removes transition loading after a failed Default solve while keeping the saved Affine pose', async () => {
  let fail!: (error:Error)=>void;
  preparation.start.mockReturnValue({promise:new Promise((_,reject)=>{fail=reject;}),release:vi.fn()});
  const stepId = await flatStep(AFFINE);
  act(()=>seen.pose!.spread!.kinds.find(kind=>kind.value==='connected')!.run());
  await act(async()=>{await vi.waitFor(()=>expect(preparation.start).toHaveBeenCalledOnce());});
  expect(seen.pose!.connectedPreparing).toBe(true);
  await act(async()=>fail(new Error('Solve failed')));
  expect(seen.pose!.connectedPreparing).toBe(false);
  expect(state().diagramCaptures[stepId]).toBeUndefined();
  expect(spreadOf(stepId)).toEqual(AFFINE);
});

it('does not carry an Affine → Default loading state into another step', async () => {
  let fail!: (error:Error)=>void;
  preparation.start.mockReturnValue({promise:new Promise((_,reject)=>{fail=reject;}),release:vi.fn()});
  const first = await flatStep(AFFINE);
  const original = stepsIn(state().diagram!).find(step=>step.id===first)!;
  const second = state().addDiagramStep()!;
  act(()=>useWorkspaceStore.setState({diagram:{...state().diagram!,steps:stepsIn(state().diagram!).map(step=>step.id===second?{...original,id:second}:step)}}));
  act(()=>seen.pose!.spread!.kinds.find(kind=>kind.value==='connected')!.run());
  await act(async()=>{await vi.waitFor(()=>expect(preparation.start).toHaveBeenCalledOnce());});
  expect(seen.pose!.connectedPreparing).toBe(true);
  act(()=>root!.render(<Probe stepId={second}/>));
  expect(seen.pose!.connectedPreparing).toBe(false);
  await act(async()=>fail(new Error('Old solve stopped')));
  expect(seen.pose!.connectedPreparing).toBe(false);
  expect(spreadOf(first)).toEqual(AFFINE);
  expect(spreadOf(second)).toEqual(AFFINE);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  seen.pose = null;
});

describe('the Step pane’s spread, through the hook', () => {
  it('runs the kind, keep and direction each choice names', async () => {
    const stepId = await flatStep(DEPTH);
    act(() => seen.pose!.spread!.kinds.find((kind) => kind.value === 'affine')!.run());
    await landed(stepId, AFFINE);
    act(() => seen.pose!.spread!.keeps.find((keep) => keep.value === 'bottom')!.run());
    await landed(stepId, { ...AFFINE, keep: 'bottom' });
    act(() => seen.pose!.spread!.kinds.find((kind) => kind.value === 'depth')!.run());
    await landed(stepId, DEPTH);
    act(() => seen.pose!.spread!.directions.find((direction) => direction.value === 'up-left')!.run());
    await landed(stepId, { ...DEPTH, toward: 'up-left' });
  });

  it('keeps each slider in its own range: an axis round the half-turn, a skew to 1, an amount to its kind’s', async () => {
    const stepId = await flatStep(AFFINE);
    act(() => seen.pose!.spread!.preview('axis', 99));
    // The pane shows the drag before it is committed.
    expect(seen.pose!.spread!.spread).toEqual({ ...AFFINE, axisDeg: 99 });
    act(() => seen.pose!.spread!.preview('axis', 181));
    act(() => seen.pose!.spread!.commit());
    await landed(stepId, { ...AFFINE, axisDeg: 1 });
    act(() => seen.pose!.spread!.preview('skew', 1.4));
    act(() => seen.pose!.spread!.commit());
    await landed(stepId, { ...AFFINE, axisDeg: 1, skew: 1 });
    act(() => seen.pose!.spread!.preview('amount', 0.4));
    act(() => seen.pose!.spread!.commit());
    await landed(stepId, { ...AFFINE, axisDeg: 1, skew: 1, amount: 0.25 });
  });

  it('shows a slider let go at its value in the pane while another is dragged, before it lands (third review)', async () => {
    const stepId = await flatStep(AFFINE);
    act(() => seen.pose!.spread!.preview('skew', 0.3));
    act(() => seen.pose!.spread!.commit());
    act(() => seen.pose!.spread!.preview('axis', 50));
    // Not landed yet; the pane shows both, as the picture does.
    expect(spreadOf(stepId)).toEqual(AFFINE);
    expect(seen.pose!.spread!.spread).toEqual({ ...AFFINE, skew: 0.3, axisDeg: 50 });
    await landed(stepId, { ...AFFINE, skew: 0.3 });
  });

  it('takes down a drag begun while a verb captured, once the verb lands and the spread is not the one dragged (third review)', async () => {
    // Spread Layers turned off under an amount being dragged: the layers shown spread over a step with none.
    const off = await flatStep(DEPTH);
    act(() => seen.pose!.spread!.preview('amount', 0.03));
    act(() => seen.pose!.spread!.commit());
    await landed(off, { ...DEPTH, amount: 0.03 });
    let open = holdTheLookup();
    act(() => seen.pose!.actions.find((action) => action.id === 'spread-layers')!.run());
    act(() => seen.pose!.spread!.preview('amount', 0.15));
    expect(seen.pose!.preview).not.toBeNull();
    open();
    await act(async () => {
      await vi.waitFor(() => expect(spreadOf(off)).toBeUndefined());
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(seen.pose!.preview).toBeNull();
    act(() => root?.unmount());

    // Switched to depth under a skew being dragged: an affine picture over a depth step.
    const switched = await flatStep(AFFINE);
    act(() => seen.pose!.spread!.preview('skew', 0.9));
    act(() => seen.pose!.spread!.commit());
    await landed(switched, { ...AFFINE, skew: 0.9 });
    open = holdTheLookup();
    act(() => seen.pose!.spread!.kinds.find((kind) => kind.value === 'depth')!.run());
    act(() => seen.pose!.spread!.preview('skew', 0.4));
    expect(seen.pose!.preview).not.toBeNull();
    open();
    await act(async () => {
      await vi.waitFor(() => expect(spreadOf(switched)?.kind).toBe('depth'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(seen.pose!.preview).toBeNull();
  });

  it('lets no drag start on a diagram that cannot change', async () => {
    await flatStep(DEPTH);
    expect(seen.pose!.spread!.start()).toBe(true);
    act(() => useWorkspaceStore.setState({ diagramReadOnly: true }));
    expect(seen.pose!.spread!.start()).toBe(false);
  });
});

describe('the pager through a layer order and back (H7)', () => {
  const action = (id: string) => seen.pose!.actions.find((each) => each.id === id)!;
  const rotation = (stepId: string) => {
    const source = stepsIn(state().diagram!).find((step) => step.id === stepId)?.source;
    return source?.kind === 'cp' && source.render.mode === 'folded-flat' ? source.render.rotationDeg : null;
  };
  const constrained = (stepId: string) => {
    const source = stepsIn(state().diagram!).find((step) => step.id === stepId)?.source;
    return source?.kind === 'cp' && source.layerOrder !== undefined;
  };

  it('counts the kernel’s orders again once undo takes the chosen order back, not the held one’s one of one', async () => {
    // The kernel's enumeration has more past the first.
    bindings.runtime = fakeCaptureRuntime({
      fold: vi.fn(async () => ({
        handle: 7,
        discoveredCases: 1,
        displayStyle: 'Paper5' as const,
        outcome: 'Solved' as const,
        hasNext: true,
      })),
    });
    hostEngine.resolveLayerOrder.mockImplementation(async (source: LayerOrderSource) =>
      fakeLayerOrderResolutions.applied(STEP_LAYER_ORDER_IN_SOURCE, source)
    );
    dialog.openLayerOrderDialog.mockImplementation(async (request: LayerOrderRequest) => ({
      kind: 'applied',
      applied: { record: STEP_LAYER_ORDER_IN_SOURCE, relations: new Uint32Array([1, 0]), source: request.source },
    }));
    const stepId = await linkedStep({ mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 });
    act(() => action('rotate-right').run());
    await act(async () => {
      await vi.waitFor(() => expect(rotation(stepId)).toBe(15));
    });
    await act(async () => {
      await vi.waitFor(() => expect(seen.pose!.layerOrder?.count).toBe('1 of 1+'));
    });

    // Apply a chosen order, and turn the step in it: the held fold's one order of one.
    await act(async () => {
      expect(await openDiagramStepLayerOrder(stepId)).toBe(true);
    });
    expect(constrained(stepId)).toBe(true);
    act(() => action('rotate-right').run());
    await act(async () => {
      await vi.waitFor(() => expect(rotation(stepId)).toBe(30));
    });
    expect(seen.pose!.layerOrder).toBeNull();

    // Undo the turn, then the Apply: the kernel's orders again, never the held fold's facts.
    act(() => {
      state().undoDiagram();
      state().undoDiagram();
    });
    expect(constrained(stepId)).toBe(false);
    expect(seen.pose!.layerOrder?.count).not.toBe('1 of 1');
    expect(action('next-solution').disabled).toBe(false);
  });
});

describe('Set Upright in Pose', () => {
  const setUpright = () => seen.pose!.actions.find((action) => action.id === 'set-upright')!;

  it('turns the live view that registered last, says so, and is held while none shows', async () => {
    await linkedStep({ mode: 'simulated', foldPercent: 50, view: { yaw: 0.4, pitch: -0.6, zoom: 1 } });
    expect(setUpright()).toMatchObject({ disabled: true });
    const first = { setUpright: vi.fn() };
    const second = { setUpright: vi.fn() };
    let letGo = () => {};
    act(() => {
      letGo = seen.pose!.registerLiveView(first);
    });
    expect(setUpright()).toMatchObject({ disabled: false });
    // The view remounting: the new one registers before the old one lets go, which leaves it.
    let letGoSecond = () => {};
    act(() => {
      letGoSecond = seen.pose!.registerLiveView(second);
    });
    act(() => letGo());
    act(() => setUpright().run());
    expect(second.setUpright).toHaveBeenCalledOnce();
    expect(first.setUpright).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith('Up direction set — drag to turn around it');
    act(() => letGoSecond());
    expect(setUpright()).toMatchObject({ disabled: true });
  });
});


it('keeps Pose busy after folding until spread preparation finishes, and stops on failure', async () => {
  let fail!: (error: Error) => void;
  const release = vi.fn();
  preparation.start.mockReturnValue({promise:new Promise((_, reject)=>{fail=reject;}),release});
  await flatStep({kind:'connected',version:1,amount:.5,reveal:[.8,.6]});
  await act(async () => { await vi.waitFor(()=>expect(preparation.start).toHaveBeenCalled()); });
  expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
  expect(seen.pose!.connectedPreparing).toBe(true);
  expect(seen.pose!.connected).toBeNull();
  await act(async () => fail(new Error('Spread unavailable')));
  expect(seen.pose!.connectedPreparing).toBe(false);
  expect(seen.pose!.connected).toBeNull();
});

it('does not let an old preparation clear a newer step’s loading state', async () => {
  const finish: ((value: unknown)=>void)[] = [];
  preparation.start.mockImplementation(()=>({promise:new Promise(resolve=>finish.push(resolve)),release:vi.fn()}));
  const first = await flatStep({kind:'connected',version:1,amount:.5,reveal:[.8,.6]});
  await act(async()=>{await vi.waitFor(()=>expect(finish).toHaveLength(1));});
  const second = state().addDiagramStep()!;
  const original = stepsIn(state().diagram!).find(step=>step.id===first)!;
  await act(async()=>{
    useWorkspaceStore.setState({diagram:{...state().diagram!,steps:stepsIn(state().diagram!).map(step=>step.id===second?{...original,id:second}:step)}});
    root!.render(<Probe stepId={second}/>);
  });
  await act(async()=>{await vi.waitFor(()=>expect(finish).toHaveLength(2));});
  await act(async()=>finish[0]!({}));
  expect(seen.pose!.connectedPreparing).toBe(true);
  await act(async()=>finish[1]!({}));
  expect(seen.pose!.connectedPreparing).toBe(false);
  expect(seen.pose!.connected).not.toBeNull();
});
