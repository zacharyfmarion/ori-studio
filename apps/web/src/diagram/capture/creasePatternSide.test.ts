import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resetFoldedFigureHandles, setFoldedFigureHandleFree } from '../../cp-workspace/folded/foldedFigureHandles';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCpSource, DiagramStep, KnownDiagramAnnotation } from '../document/diagramDocument';
import { stepsIn } from '../document/diagramSteps.fixtures';
import { storedScene } from '../pictures/pictureFrame';
import { cpDocument, fakeCaptureRuntime, twoSquaresSegmentation } from './capture.fixtures';
import { chooseStepCreases } from './captureCreases';
import type { CpCaptureRuntime } from './captureFolded';
import { showCreasePatternSide } from './creasePatternSide';
import { publishOpenLinkedPose } from './openLinkedPose';
import type { DiagramLinkedPose } from './useDiagramLinkedPose';

/**
 * The Step pane's Front | Back for a crease pattern (Zach, 2026-10-05), in
 * Pose or not: Pose's own turn-over, through the open step's controller or
 * one made for the verb, so the pose is Pose's in every way — one undo step,
 * a fingerprint kept as a pose keeps it, the marks mirrored with the picture.
 */
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
const toasts = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const analytics = vi.hoisted(() => ({ trackDiagramPicturePosed: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const scope = { kind: 'segment' as const, region: regionReferenceFor(left!) };
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const document = cpDocument();

/** An arrow bulging one way on the left of the paper: nothing about it is symmetric. */
const ARROW: KnownDiagramAnnotation = { id: 'a', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.45, 0.6], bend: 0.3 };

/** A step linked to the left square, shown as its crease pattern, marked with {@link ARROW}. */
async function markedPattern(): Promise<string> {
  const stepId = state().addDiagramStep()!;
  await state().captureDiagramStep(stepId, {
    scope,
    render: { mode: 'crease-pattern', rotationDeg: 30 },
    kind: 'diagram-capture',
    label: 'Link pattern',
  });
  state().editDiagramAnnotations(stepId, 'Add annotation', () => [ARROW]);
  return stepId;
}

const stepOf = (stepId: string): DiagramStep => stepsIn(state().diagram!).find((step) => step.id === stepId)!;
const sourceOf = (stepId: string) => stepOf(stepId).source as DiagramCpSource;
const arrowOf = (stepId: string) => stepOf(stepId).annotations[0] as KnownDiagramAnnotation;

/** The picture's frame width, its longer side one unit. */
function frameWidth(step: DiagramStep): number {
  const { bounds } = storedScene(step.picture as never)!;
  return (bounds.maxX - bounds.minX) / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

beforeEach(async () => {
  vi.clearAllMocks();
  setFoldedFigureHandleFree(() => {});
  await resetFoldedFigureHandles();
  useWorkspaceStore.setState(initialState, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document, geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
});

describe('showCreasePatternSide', () => {
  it('turns the pattern over where it lies, as one pose, its marks mirrored with it, and counts a turn-over', async () => {
    const stepId = await markedPattern();
    const front = stepOf(stepId);
    const past = state().diagramHistory.past.length;
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    const back = stepOf(stepId);
    // Its back at the opposite turn: the front's mirror, where it lay.
    expect(sourceOf(stepId).render).toEqual({ mode: 'crease-pattern', rotationDeg: 330, side: 'back' });
    expect(state().diagramHistory.past.slice(past).map((entry) => entry.label)).toEqual(['Adjust pose']);
    expect(back.annotatedPictureKey).toBe(back.picture!.key);
    const width = frameWidth(front);
    expect(arrowOf(stepId).from[0]).toBeCloseTo(width - ARROW.from[0], 6);
    expect(arrowOf(stepId).from[1]).toBeCloseTo(ARROW.from[1], 6);
    expect(arrowOf(stepId).to[0]).toBeCloseTo(width - ARROW.to[0], 6);
    expect(arrowOf(stepId).bend).toBe(-0.3);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenCalledExactlyOnceWith('turn_over', 'crease_pattern', {
      side: 'back',
    });
    expect(state().diagramCaptures).toEqual({});

    // Front again: as it was.
    expect(await showCreasePatternSide(stepId, 'front')).toBe(true);
    const again = stepOf(stepId);
    expect(again.source).toEqual(front.source);
    expect(again.picture).toEqual(front.picture);
    expect(again.annotatedPictureKey).toBe(front.picture!.key);
    const arrow = arrowOf(stepId);
    for (const end of ['from', 'to'] as const) {
      expect(arrow[end][0]).toBeCloseTo(ARROW[end][0], 9);
      expect(arrow[end][1]).toBeCloseTo(ARROW[end][1], 9);
    }
    expect(arrow.bend).toBe(0.3);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenLastCalledWith('turn_over', 'crease_pattern', { side: 'front' });

    // Undone, the back; undone again, the front exactly.
    state().undoDiagram();
    expect(stepOf(stepId)).toEqual(back);
    state().undoDiagram();
    expect(stepOf(stepId)).toEqual(front);
  });

  // A step saved before fingerprints were relative (the crane's own): a pose
  // keeps its `cs1:` fingerprint while its creases match, so its marks carry.
  // A plain capture would write the relative one, and leave them behind.
  it('keeps a fingerprint from before as a pose does, and carries the marks of a step that has one', async () => {
    const stepId = await markedPattern();
    const choice = chooseStepCreases(document, scope, segmentation);
    if (choice.status !== 'found') throw new Error('the left square');
    const absolute = choice.creases.absolute.drawnFingerprint;
    const step = stepOf(stepId);
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: [{ ...step, source: { ...(step.source as DiagramCpSource), fingerprint: absolute } }],
      },
    });
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    expect(sourceOf(stepId).fingerprint).toBe(absolute);
    expect(stepOf(stepId).annotatedPictureKey).toBe(stepOf(stepId).picture!.key);
    expect(arrowOf(stepId).bend).toBe(-0.3);
  });

  it('does nothing for the side it shows, a step shown another way, or a read-only diagram', async () => {
    const stepId = await markedPattern();
    const past = state().diagramHistory.past.length;
    expect(await showCreasePatternSide(stepId, 'front')).toBe(true);
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(await showCreasePatternSide(stepId, 'back')).toBe(false);
    useWorkspaceStore.setState({ diagramReadOnly: false });
    expect(state().diagramHistory.past.length).toBe(past);
    expect(sourceOf(stepId).render).toEqual({ mode: 'crease-pattern', rotationDeg: 30 });
    const flat = state().addDiagramStep()!;
    await state().captureDiagramStep(flat, {
      scope,
      render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 },
      kind: 'diagram-capture',
      label: 'Link pattern',
    });
    const linked = state().diagramHistory.past.length;
    // A flat fold's side is Pose's Turn Over, not this field's.
    expect(await showCreasePatternSide(flat, 'back')).toBe(false);
    expect(state().diagramHistory.past.length).toBe(linked);
    expect(analytics.trackDiagramPicturePosed).not.toHaveBeenCalled();
  });

  it('goes through the open step’s Pose, whose controller holds the step', async () => {
    const stepId = await markedPattern();
    const setSide = vi.fn(async () => true);
    const open: DiagramLinkedPose = {
      actions: [],
      layerOrder: null,
      spatial: null,
      onCamera: () => {},
      rotateTo: () => {},
      showAs: async () => true,
      setSide,
      simulate: async () => {},
      wantsRest: () => false,
      spread: null,
      preview: null,
    };
    publishOpenLinkedPose(stepId, open);
    const past = state().diagramHistory.past.length;
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    expect(setSide).toHaveBeenCalledWith('back');
    expect(state().diagramHistory.past.length).toBe(past);
    publishOpenLinkedPose(null, null);
  });
});
