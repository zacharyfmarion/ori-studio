import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDiagram,
  insertSteps,
  stepById,
  type DiagramDocument,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { craneStep, imprintCase } from '../../diagram/zoom/zoom.fixtures';
import { paperFacesOf, toPicture } from '../../diagram/zoom/zoomImprint';
import { frameProblems, marksInPicture } from '../../diagram/zoom/zoomInvariant.fixtures';
import { ZOOM_FRAME_ID } from '../../diagram/zoom/zoomModel';
import { useWorkspaceStore } from '../workspaceStore';
import { activeAnchorPick } from './diagramState';
import { withPaperFaces } from './diagramZoom';

const tracked = vi.hoisted(() => ({
  trackDiagramStepEnlarged: vi.fn(),
  trackDiagramPicturePosed: vi.fn(),
  trackDiagramStepAdded: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...tracked,
}));

/**
 * Enlarged steps through the store (Revision 2, 16e): Pose's Enlarged, Update
 * Enlarged Steps, a step added after an enlarged one, the frame selected as a
 * layer, and the anchor's pick mode — each edit one undo step.
 */
const state = () => useWorkspaceStore.getState();
const step = (id: string) => stepById(state().diagram!, id)!;
const past = () => state().diagramHistory.past.length;

function headArea(s: DiagramStep, id = 'area-head'): KnownDiagramAnnotation {
  const { centre, radius } = toPicture(paperFacesOf(s)!, imprintCase('C.none').frame);
  return { id, kind: 'zoom', from: centre, to: centre, radius };
}

/** Zach's crane: step 1 with the head's area; step 2 the crane again, marked; installed, step 2 selected. */
function install(entries?: DiagramStep[]): void {
  const s = craneStep('S.none');
  const marked: DiagramStep = {
    ...craneStep('C.none'),
    id: 'step-2',
    annotations: [{ id: 'mark', kind: 'valley-line', from: [0.3, 0.2], to: [0.6, 0.35] }],
    annotatedPictureKey: craneStep('C.none').picture!.key,
  };
  const document: DiagramDocument = insertSteps(
    createDiagram({ title: 'Crane' }),
    entries ?? [{ ...s, annotations: [headArea(s)], annotatedPictureKey: s.picture!.key }, marked],
    0
  );
  state().installDiagram({ document, readOnly: false, raw: null } as never);
  state().selectDiagramStep('step-2');
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  Object.values(tracked).forEach((spy) => spy.mockClear());
});

describe('Pose’s Enlarged (Z2)', () => {
  it('turned on captures a frame as one undo step, its marks carried into the window on the same paper, and is counted', async () => {
    install();
    const before = marksInPicture(step('step-2'));
    const was = past();
    expect(await state().enlargeDiagramStep('step-2')).toBe(true);
    expect(past()).toBe(was + 1);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Enlarge step');
    expect(step('step-2').zoom).toMatchObject({ from: 'area-head', shape: 'circle' });
    expect(frameProblems(state().diagram!)).toEqual([]);
    const after = marksInPicture(step('step-2'));
    for (const [id, points] of before) {
      points.forEach((point, index) => {
        expect(after.get(id)![index]![0]).toBeCloseTo(point[0], 9);
        expect(after.get(id)![index]![1]).toBeCloseTo(point[1], 9);
      });
    }
    expect(tracked.trackDiagramStepEnlarged.mock.calls).toEqual([['toggle', 'face', 'auto', 'circle', 'flat']]);
    // Undone: the step as it was, whole.
    state().undoDiagram();
    expect(step('step-2').zoom).toBeUndefined();
  });

  it('turned off drops the frame, as one undo step, the marks back on the whole picture', async () => {
    install();
    const before = marksInPicture(step('step-2'));
    await state().enlargeDiagramStep('step-2');
    state().openDiagramStep('step-2', 'annotate');
    state().selectDiagramAnnotation(ZOOM_FRAME_ID);
    expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
    const was = past();
    expect(state().unenlargeDiagramStep('step-2')).toBe(true);
    expect(past()).toBe(was + 1);
    expect(step('step-2').zoom).toBeUndefined();
    // The frame it showed is gone: nothing selected.
    expect(state().diagramSelectedAnnotationId).toBeNull();
    const after = marksInPicture(step('step-2'));
    expect(after.get('mark')![0]![0]).toBeCloseTo(before.get('mark')![0]![0], 9);
    expect(tracked.trackDiagramPicturePosed.mock.calls).toEqual([['enlarge_off', 'flat']]);
  });

  it('removes a duplicate’s own copied area in the same undo step', async () => {
    const s = craneStep('S.none');
    const area = headArea(s);
    install([
      { ...s, annotations: [area], annotatedPictureKey: s.picture!.key },
      { ...s, id: 'step-2', annotations: [{ ...area, id: 'area-copy' }], annotatedPictureKey: s.picture!.key },
    ]);
    const was = past();
    await state().enlargeDiagramStep('step-2');
    expect(past()).toBe(was + 1);
    expect(step('step-2').annotations).toEqual([]);
    expect(step('step-2').zoom!.from).toBe('area-head');
  });

  it('S1 on the crane: a duplicate with a long mark, turned on and off, keeps every mark where it was, in step', async () => {
    // The area's step with a small area round the head, a long valley line down the model and a loop on the body.
    const s = craneStep('S.none');
    const area = { ...headArea(s), radius: 0.05 };
    const long: KnownDiagramAnnotation = { id: 'long', kind: 'valley-line', from: [0.2745, 0.9755], to: [0.2708, 0.0164] };
    const body: KnownDiagramAnnotation = { id: 'body', kind: 'circle', from: [0.4, 0.7], to: [0.4, 0.7] };
    install([{ ...s, id: 'step-1', annotations: [area, long, body], annotatedPictureKey: s.picture!.key }]);
    const copy = state().duplicateDiagramStep('step-1')!;
    const copied = step(copy).annotations as KnownDiagramAnnotation[];
    const drawn = marksInPicture(step(copy));
    expect(await state().enlargeDiagramStep(copy)).toBe(true);
    const enlarged = step(copy);
    // The copied area goes; the two marks stay.
    expect(enlarged.annotations.map((mark) => mark.id)).toEqual(copied.slice(1).map((mark) => mark.id));
    expect(enlarged.annotatedPictureKey).toBe(enlarged.picture!.key);
    const inWindow = marksInPicture(enlarged);
    for (const [id, points] of inWindow) {
      points.forEach((point, index) => {
        expect(point[0]).toBeCloseTo(drawn.get(id)![index]![0], 9);
        expect(point[1]).toBeCloseTo(drawn.get(id)![index]![1], 9);
      });
    }
    expect(state().unenlargeDiagramStep(copy)).toBe(true);
    const off = step(copy);
    expect(off.annotatedPictureKey).toBe(off.picture!.key);
    for (const mark of off.annotations as KnownDiagramAnnotation[]) {
      const was = copied.find((each) => each.id === mark.id)!;
      expect(mark.from[0]).toBeCloseTo(was.from[0], 12);
      expect(mark.from[1]).toBeCloseTo(was.from[1], 12);
      expect(mark.to[0]).toBeCloseTo(was.to[0], 12);
      expect(mark.to[1]).toBeCloseTo(was.to[1], 12);
    }
  });

  it('captures nothing with nothing before it to capture from, nor on a step enlarged already', async () => {
    install([{ ...craneStep('C.none'), id: 'step-1' }, { ...craneStep('C.none'), id: 'step-2' }]);
    const was = past();
    expect(await state().enlargeDiagramStep('step-2')).toBe(false);
    expect(past()).toBe(was);
  });
});

describe('Update Enlarged Steps (Z7)', () => {
  it('places every step with the area’s provenance again, over a hand move, as one undo step', async () => {
    install();
    await state().enlargeDiagramStep('step-2');
    const placed = step('step-2').zoom!.frame!;
    state().editDiagramStepZoom('step-2', 'Move enlarged frame', (document) => ({
      ...document,
      steps: document.steps.map((entry) =>
        entry.id === 'step-2' && 'zoom' in entry && entry.zoom
          ? { ...entry, zoom: { ...entry.zoom, frame: { ...entry.zoom.frame!, centre: [0.1, 0.1] as [number, number] } } }
          : entry
      ),
    }));
    const was = past();
    tracked.trackDiagramStepEnlarged.mockClear();
    expect(await state().updateEnlargedDiagramSteps('area-head')).toBe(1);
    expect(past()).toBe(was + 1);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Update enlarged steps');
    expect(step('step-2').zoom!.frame!.centre[0]).toBeCloseTo(placed.centre[0], 9);
    expect(tracked.trackDiagramStepEnlarged.mock.calls).toEqual([['update', 'face', 'auto', 'circle', 'flat']]);
  });
});

describe('a step added after an enlarged step (Z2)', () => {
  it('starts enlarged, captured as it is made, in the add’s one undo step', async () => {
    install();
    await state().enlargeDiagramStep('step-2');
    const was = past();
    const added = state().insertDiagramStep('step-2', 'after')!;
    expect(past()).toBe(was + 1);
    expect(step(added).zoom).toMatchObject({ from: 'area-head', shape: 'circle', imprint: { on: expect.any(Array) } });
    // Before an enlarged step, or after a whole one: whole.
    expect(step(state().insertDiagramStep('step-2', 'before')!).zoom).toBeUndefined();
  });
});

describe('the frame as a layer, and the anchor’s pick mode', () => {
  it('selects the frame of an enlarged step beside its marks, and nothing on a whole step', async () => {
    install();
    state().openDiagramStep('step-2', 'annotate');
    state().selectDiagramAnnotation(ZOOM_FRAME_ID);
    expect(state().diagramSelectedAnnotationId).toBeNull();
    await state().enlargeDiagramStep('step-2');
    state().selectDiagramAnnotation(ZOOM_FRAME_ID);
    expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
    // A mark's edit keeps it selected.
    state().editDiagramAnnotations('step-2', 'Move annotation', (list) => list.map((mark) => ({ ...mark })));
    expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
  });

  it('picks only while its area or frame is selected on the step open in Annotate', async () => {
    install();
    state().selectDiagramStep(stepsIn(state().diagram!)[0]!.id);
    const areaStep = state().diagramSelectedStepId!;
    state().openDiagramStep(areaStep, 'annotate');
    state().selectDiagramAnnotation('area-head');
    state().setDiagramAnchorPick({ stepId: areaStep, target: 'area-head' });
    expect(activeAnchorPick(state())).toEqual({ stepId: areaStep, target: 'area-head' });
    state().selectDiagramAnnotation(null);
    expect(activeAnchorPick(state())).toBeNull();
    // Selected again, the area is not picking: the mode stayed down (Escape or Pick again leave it).
    state().selectDiagramAnnotation('area-head');
    expect(activeAnchorPick(state())).toBeNull();
    // Nor after Pose and back, or another step and back.
    state().setDiagramAnchorPick({ stepId: areaStep, target: 'area-head' });
    state().openDiagramStep(areaStep, 'pose');
    state().openDiagramStep(areaStep, 'annotate');
    state().selectDiagramAnnotation('area-head');
    expect(activeAnchorPick(state())).toBeNull();
    state().setDiagramAnchorPick({ stepId: areaStep, target: 'area-head' });
    state().openDiagramStep('step-2', 'annotate');
    state().openDiagramStep(areaStep, 'annotate');
    state().selectDiagramAnnotation('area-head');
    expect(activeAnchorPick(state())).toBeNull();
    state().setDiagramAnchorPick({ stepId: areaStep, target: 'area-head' });
    state().closeDiagramStep();
    expect(activeAnchorPick(state())).toBeNull();
    expect(state().diagramAnchorPick).toBeNull();
  });
});

describe('older flat captures’ faces', () => {
  it('are put on their steps only while each is as it was folded, and still has none', () => {
    const older = { ...craneStep('S.none', { faces: false }), id: 'step-1' };
    const faced = { ...craneStep('S.none'), id: 'step-1' };
    const document = insertSteps(createDiagram({ title: 'Crane' }), [older], 0);
    const given = withPaperFaces(document, new Map([['step-1', faced]]));
    expect(stepById(given, 'step-1')!.picture).toMatchObject({ paperFaces: faced.picture!.kind === 'scene' ? faced.picture!.paperFaces : '' });
    expect(stepById(given, 'step-1')!.revision).toBe(older.revision);
    // Changed since: left as it is.
    const changed = withPaperFaces(document, new Map([['step-1', { ...faced, revision: older.revision + 1 }]]));
    expect(changed).toBe(document);
    expect(withPaperFaces(document, new Map())).toBe(document);
  });
});
