import { act, StrictMode, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resetFoldedFigureHandles, setFoldedFigureHandleFree } from '../../cp-workspace/folded/foldedFigureHandles';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCpRender, DiagramLayerSpread } from '../document/diagramDocument';
import { stepsIn } from '../document/diagramSteps.fixtures';
import { cpDocument, fakeCaptureRuntime, twoSquaresIndex } from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { useDiagramLinkedPose, type DiagramLinkedPose } from './useDiagramLinkedPose';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';

/**
 * The Step pane's spread rows reach the controller only through this hook:
 * which verb each choice runs, and each slider's range (13g review). The
 * controller and the store are real; the kernel is the capture fixtures'.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
/** Every controller the hook made, and whether it was let go: the real one, its `dispose` watched. */
const controllers = vi.hoisted(() => ({ made: [] as { disposed: boolean }[] }));
vi.mock('./poseController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./poseController')>();
  return {
    ...actual,
    createPoseController: (...args: Parameters<typeof actual.createPoseController>) => {
      const controller = actual.createPoseController(...args);
      const made = { disposed: false };
      controllers.made.push(made);
      const dispose = controller.dispose;
      controller.dispose = () => {
        made.disposed = true;
        dispose();
      };
      return controller;
    },
  };
});

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

/** A step linked to the left square, shown as `render`, the hook mounted on it — under StrictMode if `strict`. */
async function linkedStep(render: DiagramCpRender, { strict = false }: { strict?: boolean } = {}): Promise<string> {
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
  const probe = <Probe stepId={stepId} />;
  act(() => root!.render(strict ? <StrictMode>{probe}</StrictMode> : probe));
  return stepId;
}

const renderOf = (stepId: string) => {
  const source = stepsIn(state().diagram!).find((step) => step.id === stepId)?.source;
  return source?.kind === 'cp' ? source.render : undefined;
};

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
  setFoldedFigureHandleFree(() => {});
  await resetFoldedFigureHandles();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document: cpDocument(), geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
  controllers.made = [];
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

describe('Pose under StrictMode', () => {
  it('poses through a live controller on first mount, and lets it go on the real unmount', async () => {
    // The detail opening with a step already open: StrictMode mounts, unmounts and mounts its effects.
    const stepId = await linkedStep({ mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 }, { strict: true });
    act(() => seen.pose!.actions.find((action) => action.id === 'turn-over')!.run());
    await act(async () => {
      await vi.waitFor(() => expect(renderOf(stepId)).toMatchObject({ mode: 'folded-flat', side: 'back' }));
    });
    // Show as, from the Step pane or a card, reaches it too.
    let shown = false;
    await act(async () => {
      shown = await seen.pose!.showAs('crease-pattern');
    });
    expect(shown).toBe(true);
    expect(renderOf(stepId)).toMatchObject({ mode: 'crease-pattern' });
    expect(controllers.made.filter((made) => !made.disposed)).toHaveLength(1);

    act(() => root!.unmount());
    root = null;
    expect(controllers.made.every((made) => made.disposed)).toBe(true);
  });
});
