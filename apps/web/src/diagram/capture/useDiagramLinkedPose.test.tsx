import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resetFoldedFigureHandles, setFoldedFigureHandleFree } from '../../cp-workspace/folded/foldedFigureHandles';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramLayerSpread } from '../document/diagramDocument';
import { stepsIn } from '../document/diagramSteps.fixtures';
import { cpDocument, fakeCaptureRuntime, twoSquaresSegmentation } from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { useDiagramLinkedPose, type DiagramLinkedPose } from './useDiagramLinkedPose';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';

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
vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  ensureCpSegmentationArtifacts: vi.fn(async () => segmentation),
  peekCpSegmentationArtifacts: vi.fn(() => segmentation),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn() } }));

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
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
          ? { ...step, source: { ...step.source, render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1, spread } } }
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
  vi.mocked(ensureCpSegmentationArtifacts).mockImplementationOnce(async () => {
    await gate;
    return segmentation;
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
