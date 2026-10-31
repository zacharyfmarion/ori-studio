import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resetFoldedFigureHandles, setFoldedFigureHandleFree } from '../../cp-workspace/folded/foldedFigureHandles';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCpSource, DiagramStep, KnownDiagramAnnotation } from '../document/diagramDocument';
import { stepsIn } from '../document/diagramSteps.fixtures';
import { storedScene } from '../pictures/pictureFrame';
import { cpDocument, fakeCaptureRuntime, twoSquaresIndex } from './capture.fixtures';
import { chooseStepCreases } from './captureCreases';
import type { CpCaptureRuntime } from './captureFolded';
import { flipCreasePatternCreases, showCreasePatternSide } from './creasePatternSide';
import { publishOpenLinkedPose } from './openLinkedPose';
import type { DiagramLinkedPose } from './useDiagramLinkedPose';

/**
 * The Step pane's Front | Back for a crease pattern (Zach, 2026-10-05; the
 * colour alone since 2026-10-06), in Pose or not: a pose, through the open
 * step's controller or one made for the verb, so it is Pose's in every way —
 * one undo step, a fingerprint kept as a pose keeps it, the marks left where
 * they are and kept in step with the picture.
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
const toasts = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const analytics = vi.hoisted(() => ({ trackDiagramPicturePosed: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

const sheets = twoSquaresIndex();
const [left] = sheetRegions(sheets);
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

/** What a step's picture draws. */
const sceneOf = (step: DiagramStep) => storedScene(step.picture as never)!;

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
  it('recolours the paper alone, as one pose: the same lines, turn and marks, a picture of its own, counted as the paper’s side', async () => {
    const stepId = await markedPattern();
    const front = stepOf(stepId);
    const past = state().diagramHistory.past.length;
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    const back = stepOf(stepId);
    // The turn it had: nothing mirrored, so nothing turned the other way.
    expect(sourceOf(stepId).render).toEqual({ mode: 'crease-pattern', rotationDeg: 30, side: 'back' });
    expect(sourceOf(stepId).fingerprint).toBe((front.source as DiagramCpSource).fingerprint);
    expect(state().diagramHistory.past.slice(past).map((entry) => entry.label)).toEqual(['Adjust pose']);
    // Its paper the back colour, and every line where it was, mountains and valleys as they were.
    const [seen, recoloured] = [sceneOf(front), sceneOf(back)];
    expect(recoloured.items[0]).toMatchObject({ kind: 'face', side: 'back' });
    expect(seen.items[0]).toMatchObject({ kind: 'face', side: 'front' });
    expect({ ...recoloured.items[0], side: 'front' }).toEqual(seen.items[0]);
    expect(recoloured.items.slice(1)).toEqual(seen.items.slice(1));
    expect(recoloured.bounds).toEqual(seen.bounds);
    // Another picture, so nothing cached serves the other colour; the marks untouched, and in step with it.
    expect(back.picture!.key).not.toBe(front.picture!.key);
    expect(back.annotations).toEqual(front.annotations);
    expect(back.annotatedPictureKey).toBe(back.picture!.key);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenCalledExactlyOnceWith('paper_side', 'crease_pattern', {
      side: 'back',
    });
    expect(state().diagramCaptures).toEqual({});

    // Front again: exactly as it was.
    expect(await showCreasePatternSide(stepId, 'front')).toBe(true);
    const again = stepOf(stepId);
    expect(again.source).toEqual(front.source);
    expect(again.picture).toEqual(front.picture);
    expect(again.annotations).toEqual(front.annotations);
    expect(again.annotatedPictureKey).toBe(front.picture!.key);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenLastCalledWith('paper_side', 'crease_pattern', { side: 'front' });

    // Undone, the back; undone again, the front exactly.
    state().undoDiagram();
    expect(stepOf(stepId)).toEqual(back);
    state().undoDiagram();
    expect(stepOf(stepId)).toEqual(front);
  });

  // A step saved before fingerprints were relative (the crane's own): a pose
  // keeps its `cs1:` fingerprint while its creases match, so its marks stay
  // in step. A plain capture would write the relative one, and leave them
  // out of step with the picture.
  it('keeps a fingerprint from before as a pose does, and the marks of a step that has one in step', async () => {
    const stepId = await markedPattern();
    const choice = chooseStepCreases(document, scope, sheets);
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
    expect(stepOf(stepId).annotations).toEqual([ARROW]);
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
    publishOpenLinkedPose(stepId, openPose({ setSide }));
    const past = state().diagramHistory.past.length;
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    expect(setSide).toHaveBeenCalledWith('back');
    expect(state().diagramHistory.past.length).toBe(past);
    publishOpenLinkedPose(null, null);
  });
});

/** The open step's Pose, as the detail publishes it: every verb a stand-in but those given. */
function openPose(verbs: Partial<DiagramLinkedPose>): DiagramLinkedPose {
  return {
    actions: [],
    layerOrder: null,
    spatial: null, connected: null, connectedSpread: null, setPresentation: async () => {}, onReveal: () => {},
    onCamera: () => {},
    registerLiveView: () => () => {},
    rotateTo: () => {},
    showAs: async () => true,
    setSide: async () => true,
    setFlipCreases: async () => true,
    simulate: async () => {},
    wantsRest: () => false,
    spread: null,
    preview: null,
    ...verbs,
  };
}

// Zach, 2026-10-12: one pattern drawn from the front, its creases flipped for the steps seen from the back.
describe('flipCreasePatternCreases', () => {
  /** A step on its back, as {@link markedPattern} makes it and the side sets it. */
  async function markedBack(): Promise<string> {
    const stepId = await markedPattern();
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    vi.clearAllMocks();
    return stepId;
  }

  const roles = (step: DiagramStep) => sceneOf(step).items.flatMap((item) => (item.kind === 'line' ? [item.role] : []));
  /** A scene point in its picture's units, as marks are kept. */
  const inPicture = (step: DiagramStep, [x, y]: readonly [number, number]): [number, number] => {
    const { minX, minY, maxX, maxY } = sceneOf(step).bounds;
    const longer = Math.max(maxX - minX, maxY - minY);
    return [(x - minX) / longer, (y - minY) / longer];
  };
  const near = (point: readonly number[], expected: readonly number[]) =>
    point.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 4));

  // Zach, 2026-10-12: "the lines should also mirror... basically it's like flipping the paper over for real."
  it('turns the paper over as one pose: mirrored as it is shown, its folds and marks named from the back, counted as on or off', async () => {
    const stepId = await markedBack();
    // A valley line laid on the pattern's mountain crease, end to end: on known points of the paper.
    const crease = sceneOf(stepOf(stepId)).items.find((item) => item.kind === 'line' && item.role === 'diagram-mountain');
    if (crease?.kind !== 'line') throw new Error('the mountain crease');
    const onCrease: KnownDiagramAnnotation = {
      id: 'on-crease',
      kind: 'valley-line',
      from: inPicture(stepOf(stepId), crease.a),
      to: inPicture(stepOf(stepId), crease.b),
    };
    state().editDiagramAnnotations(stepId, 'Add annotation', (marks) => [...marks, onCrease]);
    const back = stepOf(stepId);
    const past = state().diagramHistory.past.length;
    expect(await flipCreasePatternCreases(stepId, true)).toBe(true);
    const over = stepOf(stepId);
    // Its turn run the other way, as a flat fold's Turn Over runs it.
    expect(sourceOf(stepId).render).toEqual({ mode: 'crease-pattern', rotationDeg: 330, side: 'back', flipCreases: true });
    expect(sourceOf(stepId).fingerprint).toBe((back.source as DiagramCpSource).fingerprint);
    expect(state().diagramHistory.past.slice(past).map((entry) => entry.label)).toEqual(['Adjust pose']);
    // Every mountain a valley and every valley a mountain; the paper's back colour as it was.
    expect(roles(back)).toEqual(['aux', 'diagram-mountain', 'edge', 'edge', 'edge', 'edge']);
    expect(roles(over)).toEqual(['aux', 'diagram-valley', 'edge', 'edge', 'edge', 'edge']);
    expect(sceneOf(over).items[0]).toMatchObject({ kind: 'face', side: 'back' });
    // The picture mirrored side to side as it is shown: every line's ends, in its frame.
    const [seen, shown] = [sceneOf(back), sceneOf(over)];
    const width = (seen.bounds.maxX - seen.bounds.minX) / Math.max(seen.bounds.maxX - seen.bounds.minX, seen.bounds.maxY - seen.bounds.minY);
    shown.items.forEach((item, index) => {
      const was = seen.items[index]!;
      if (item.kind !== 'line' || was.kind !== 'line') return;
      for (const end of ['a', 'b'] as const) {
        const [u, v] = inPicture(back, was[end]);
        near(inPicture(over, item[end]), [width - u, v]);
      }
    });
    // Another picture, its marks carried with it and in step with it: the arrow mirrored and a mountain now,
    // bulging the other way; the line on the crease still on it, end to end, and a mountain now as the crease is a valley.
    expect(over.picture!.key).not.toBe(back.picture!.key);
    const [arrow, line] = over.annotations as KnownDiagramAnnotation[];
    expect(arrow).toMatchObject({ kind: 'mountain-arrow', bend: -0.3 });
    near(arrow!.from, [width - ARROW.from[0], ARROW.from[1]]);
    near(arrow!.to, [width - ARROW.to[0], ARROW.to[1]]);
    const flippedCrease = shown.items.find((item) => item.kind === 'line' && item.role === 'diagram-valley');
    if (flippedCrease?.kind !== 'line') throw new Error('the crease, a valley now');
    expect(line!.kind).toBe('mountain-line');
    near(line!.from, inPicture(over, flippedCrease.a));
    near(line!.to, inPicture(over, flippedCrease.b));
    expect(over.annotatedPictureKey).toBe(over.picture!.key);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenCalledExactlyOnceWith('flip_creases_on', 'crease_pattern', {});
    expect(state().diagramCaptures).toEqual({});

    // Off again: the render, turn and picture exactly as they were, every mark back where and as it was drawn.
    expect(await flipCreasePatternCreases(stepId, false)).toBe(true);
    const off = stepOf(stepId);
    expect(off.source).toEqual(back.source);
    expect(off.picture).toEqual(back.picture);
    const drawn = back.annotations as KnownDiagramAnnotation[];
    (off.annotations as KnownDiagramAnnotation[]).forEach((mark, index) => {
      const { from, to, ...rest } = drawn[index]!;
      expect({ ...mark, from, to }).toEqual({ ...rest, from, to });
      near(mark.from, from);
      near(mark.to, to);
    });
    expect(off.annotatedPictureKey).toBe(back.picture!.key);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenLastCalledWith('flip_creases_off', 'crease_pattern', {});

    // Undone, turned over; undone again, the back exactly.
    state().undoDiagram();
    expect(stepOf(stepId)).toEqual(over);
    state().undoDiagram();
    expect(stepOf(stepId)).toEqual(back);
  });

  it('is kept on the front, where the pattern is drawn as it is, and the back turns the paper over again', async () => {
    const stepId = await markedBack();
    const front = stepOf(stepId);
    expect(await showCreasePatternSide(stepId, 'front')).toBe(true);
    const unflipped = stepOf(stepId);
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    expect(await flipCreasePatternCreases(stepId, true)).toBe(true);
    const over = stepOf(stepId);
    expect(await showCreasePatternSide(stepId, 'front')).toBe(true);
    // Kept, and inert: the front's picture at the turn it had, mountains and valleys as they are, its marks as drawn.
    expect(sourceOf(stepId).render).toEqual({ mode: 'crease-pattern', rotationDeg: 30, flipCreases: true });
    expect(stepOf(stepId).picture).toEqual(unflipped.picture);
    expect(roles(stepOf(stepId))).toEqual(['aux', 'diagram-mountain', 'edge', 'edge', 'edge', 'edge']);
    expect((stepOf(stepId).annotations[0] as KnownDiagramAnnotation).kind).toBe('valley-arrow');
    near((stepOf(stepId).annotations[0] as KnownDiagramAnnotation).from, ARROW.from);
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    expect(stepOf(stepId).source).toEqual(over.source);
    expect(stepOf(stepId).picture).toEqual(over.picture);
    expect((stepOf(stepId).annotations[0] as KnownDiagramAnnotation).kind).toBe('mountain-arrow');
    expect(front.source).not.toEqual(over.source);
  });

  it('does nothing on the front, for the state it is in, a step shown another way, or a read-only diagram', async () => {
    const stepId = await markedPattern();
    const past = state().diagramHistory.past.length;
    // On the front there is no such field.
    expect(await flipCreasePatternCreases(stepId, true)).toBe(false);
    expect(sourceOf(stepId).render).toEqual({ mode: 'crease-pattern', rotationDeg: 30 });
    expect(await showCreasePatternSide(stepId, 'back')).toBe(true);
    const back = state().diagramHistory.past.length;
    expect(await flipCreasePatternCreases(stepId, false)).toBe(true);
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(await flipCreasePatternCreases(stepId, true)).toBe(false);
    useWorkspaceStore.setState({ diagramReadOnly: false });
    expect(state().diagramHistory.past.length).toBe(back);
    expect(back).toBe(past + 1);
    const flat = state().addDiagramStep()!;
    await state().captureDiagramStep(flat, {
      scope,
      render: { mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 1 },
      kind: 'diagram-capture',
      label: 'Link pattern',
    });
    const linked = state().diagramHistory.past.length;
    expect(await flipCreasePatternCreases(flat, true)).toBe(false);
    expect(state().diagramHistory.past.length).toBe(linked);
    expect(analytics.trackDiagramPicturePosed).toHaveBeenCalledExactlyOnceWith('paper_side', 'crease_pattern', { side: 'back' });
  });

  it('goes through the open step’s Pose, whose controller holds the step', async () => {
    const stepId = await markedBack();
    const setFlipCreases = vi.fn(async () => true);
    publishOpenLinkedPose(stepId, openPose({ setFlipCreases }));
    const past = state().diagramHistory.past.length;
    expect(await flipCreasePatternCreases(stepId, true)).toBe(true);
    expect(setFlipCreases).toHaveBeenCalledWith(true);
    expect(state().diagramHistory.past.length).toBe(past);
    publishOpenLinkedPose(null, null);
  });
});
