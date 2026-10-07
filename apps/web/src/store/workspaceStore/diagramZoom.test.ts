import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DIAGRAM_STYLE,
  createDiagram,
  createStep,
  insertSteps,
  stepById,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramReferencesSource,
  type DiagramScenePicture,
  type DiagramStep,
  type DiagramStepDiagramPicture,
  type KnownDiagramAnnotation,
  type KnownDiagramAsset,
} from '../../diagram/document/diagramDocument';
import { referencesStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { craneStep, imprintCase, turnedCapture } from '../../diagram/zoom/zoom.fixtures';
import { paperFacesOf, toPicture } from '../../diagram/zoom/zoomImprint';
import { frameProblems, marksInPicture, marksMoved, marksProblems, watchFrames } from '../../diagram/zoom/zoomInvariant.fixtures';
import { ZOOM_FRAME_ID } from '../../diagram/zoom/zoomModel';
import { useWorkspaceStore } from '../workspaceStore';
import { activeAnchorPick } from './diagramState';
import type { DiagramCommit } from './diagramCapture';
import { enlargeInStore, withPaperFaces } from './diagramZoom';
import { enlargeStep, relandFrame, setFrameOutline } from '../../diagram/zoom/zoomFrames';

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

const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'valley-line', from: [0.3, 0.2], to: [0.6, 0.35] };

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

/**
 * The invariant, after every store verb (Revision 2, "Keeping frames and
 * marks consistent"): each diagram the store comes to hold has every enlarged
 * step's frame where its imprint lands on its picture.
 */
let frames: ReturnType<typeof watchFrames> | null = null;
beforeEach(() => {
  frames = watchFrames(useWorkspaceStore.subscribe);
});
afterEach(() => {
  frames!.stop();
  expect(frames!.problems).toEqual([]);
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
    state().editDiagramStepZoom('step-2', 'Move enlarged frame', (document) =>
      setFrameOutline(document, 'step-2', { ...placed, centre: [placed.centre[0] + 0.05, placed.centre[1]] }, document.assets)
    );
    expect(step('step-2').zoom!.frame!.centre[0]).not.toBeCloseTo(placed.centre[0], 3);
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

  it('leave an enlarged step showing as it did: its frame where it was copied, its imprint made from it, its marks on the paper (16g)', () => {
    const s = craneStep('S.none');
    const area = headArea(s);
    const n = { ...craneStep('C.none', { faces: false }), id: 'step-2', annotations: [mark], annotatedPictureKey: craneStep('C.none').picture!.key };
    const document = insertSteps(createDiagram({ title: 'Crane' }), [{ ...s, annotations: [area], annotatedPictureKey: s.picture!.key }, n], 0);
    const captured = enlargeStep(document, 'step-2', {});
    // Captured before it had faces: copied in picture units, the area's imprint kept.
    expect(captured.captured).toMatchObject({ placed: 'picture' });
    const before = stepById(captured.document, 'step-2')!;
    const given = withPaperFaces(captured.document, new Map([['step-2', { ...craneStep('C.none'), id: 'step-2' }]]));
    const after = stepById(given, 'step-2')!;
    expect(frameProblems(given)).toEqual([]);
    expect(after.zoom!.frame).toEqual(before.zoom!.frame);
    expect(after.zoom!.imprint).not.toEqual(before.zoom!.imprint);
    expect(marksMoved(before, after)).toEqual([]);
    // What the invariant's watch says of it — and of the frame landed from the area's imprint instead, the marks with it.
    expect(marksProblems(captured.document, given)).toEqual([]);
    const relanded = { ...given, steps: given.steps.map((entry) => (entry.id === 'step-2' ? relandFrame({ ...after, zoom: before.zoom }) : entry)) };
    expect(marksProblems(captured.document, relanded)).toEqual(['step-2: marks moved on the paper (mark)']);
  });

  it('given to an enlarged step while the step after it is turned Enlarged, move nothing on it (review of 16g)', async () => {
    const s = craneStep('S.none');
    const older = { ...craneStep('C.none', { faces: false }), id: 'step-2', annotations: [mark], annotatedPictureKey: craneStep('C.none').picture!.key };
    install([{ ...s, annotations: [headArea(s)], annotatedPictureKey: s.picture!.key }, older, { ...craneStep('C.none'), id: 'step-3' }]);
    // Step 2 enlarged with no pattern open to fold its faces from: its frame copied in picture units.
    expect(await state().enlargeDiagramStep('step-2')).toBe(true);
    const before = step('step-2');
    // Then step 3 turned on, through the same verb, with a pattern that gives step 2 its faces.
    const commit: DiagramCommit = (_label, edit) => {
      const next = edit(state().diagram!);
      if (next === state().diagram) return null;
      useWorkspaceStore.setState({ diagram: next });
      return next;
    };
    const backfill = async () => new Map([['step-2', { ...craneStep('C.none'), id: 'step-2' }]]);
    expect(await enlargeInStore({ get: state, set: useWorkspaceStore.setState }, commit, backfill, 'step-3')).toBe(true);
    expect(step('step-2').picture).toMatchObject({ paperFaces: expect.any(String) });
    expect(step('step-2').zoom!.frame).toEqual(before.zoom!.frame);
    expect(marksMoved(before, step('step-2'))).toEqual([]);
    expect(step('step-2').annotatedPictureKey).toBe(before.annotatedPictureKey);
  });
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
const svgAsset = (id: string): KnownDiagramAsset => ({ id, kind: 'svg', svg: SVG, widthPx: 400, heightPx: 300, bytes: SVG.length });

/** A capture of the step committed as Pose and Refresh commit one: its source and picture, against its revision now. */
function commitCapture(stepId: string, captured: DiagramStep, label: string) {
  const start = {
    guard: { stepId, loadId: state().diagramLoadId, revision: step(stepId).revision },
    cp: null as never,
    style: DEFAULT_DIAGRAM_STYLE,
    auxHandle: null,
  };
  const picture = { kind: 'picture' as const, picture: captured.picture as DiagramScenePicture };
  return state().commitDiagramCapture(start, { source: captured.source as DiagramCpSource, picture }, label);
}

describe('an enlarged step’s own picture changed through the store (16g)', () => {
  it('posed — a turn, its layers spread — keeps its frame on its paper and its marks with it, one undo step each', async () => {
    install();
    await state().enlargeDiagramStep('step-2');
    for (const next of [turnedCapture(step('step-2'), 30), { ...turnedCapture(craneStep('C.affine'), 30), id: 'step-2' }]) {
      const was = past();
      expect(await commitCapture('step-2', next, 'Adjust pose')).toEqual({ changed: true, tooDetailed: false });
      expect(past()).toBe(was + 1);
      expect(step('step-2').picture).toBe(next.picture);
      expect(step('step-2').annotatedPictureKey).toBe(next.picture!.key);
    }
    // Undone, each picture with its frame and its marks as they were.
    state().undoDiagram();
    state().undoDiagram();
    expect(step('step-2').picture!.key).toBe(craneStep('C.none').picture!.key);
  });

  it('refreshed, lands its frame on the new picture, its marks out of step', async () => {
    install();
    await state().enlargeDiagramStep('step-2');
    const before = step('step-2');
    const refreshed = { ...craneStep('S.none'), source: { ...(before.source as DiagramCpSource), fingerprint: 'fp-refolded' } };
    await commitCapture('step-2', refreshed, 'Refresh step');
    expect(step('step-2').zoom!.frame).not.toEqual(before.zoom!.frame);
    expect(step('step-2').annotations).toBe(before.annotations);
    expect(step('step-2').annotatedPictureKey).toBe(before.picture!.key);
  });

  it('an upload turned in Pose carries its frame and its marks, one undo step', () => {
    const upload: DiagramStep = {
      ...craneStep('C.none'),
      id: 'step-u',
      source: { kind: 'upload', assetId: 'asset-1', rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId: 'asset-1', paperScale: null, key: 'asset:asset-1' },
      zoom: { from: 'area-head', shape: 'circle', frame: { centre: [0.3, 0.4], radius: 0.1 } },
      annotations: [{ id: 'mark', kind: 'valley-line', from: [0.2, 0.2], to: [0.8, 0.2] }],
      annotatedPictureKey: 'asset:asset-1',
    };
    const document = { ...insertSteps(createDiagram({ title: 'Upload' }), [upload], 0), assets: { 'asset-1': svgAsset('asset-1') } };
    state().installDiagram({ document, readOnly: false, raw: null } as never);
    const before = marksInPicture(step('step-u'));
    expect(state().setDiagramStepPose('step-u', { rotationQuarterTurns: 1, mirrored: false })).toBe(true);
    // A quarter turn clockwise of a 400 × 300 picture: (x, y) to (0.75 − y, x).
    expect(step('step-u').zoom!.frame!.centre).toEqual([expect.closeTo(0.35, 12), expect.closeTo(0.3, 12)]);
    const after = marksInPicture(step('step-u'));
    before.get('mark')!.forEach(([x, y], index) => {
      expect(after.get('mark')![index]![0]).toBeCloseTo(0.75 - y, 9);
      expect(after.get('mark')![index]![1]).toBeCloseTo(x, 9);
    });
  });
});

describe('every way a step is made after an enlarged one (16g)', () => {
  it('pictures uploaded after it start enlarged, the run through, each counted as its frame lands', async () => {
    install();
    await state().enlargeDiagramStep('step-2');
    tracked.trackDiagramStepEnlarged.mockClear();
    const was = past();
    const added = state().addDiagramPictures([svgAsset('a'), svgAsset('b')], { anchorStepId: 'step-2' })!;
    expect(past()).toBe(was + 1);
    for (const id of added.stepIds) {
      expect(step(id).zoom).toMatchObject({ from: 'area-head', shape: 'circle', frame: { centre: expect.any(Array) } });
    }
    expect(tracked.trackDiagramStepEnlarged.mock.calls).toEqual([
      ['seeded', 'picture', 'none', 'circle', 'svg'],
      ['seeded', 'picture', 'none', 'circle', 'svg'],
    ]);
    // One picture after a step that has one: a new step, enlarged too.
    const one = state().addDiagramPictures([svgAsset('c')], { anchorStepId: added.stepIds[1]! })!;
    expect(one.filled).toBe(false);
    expect(step(one.stepIds[0]!).zoom?.from).toBe('area-head');
  });

  it('cards pulled from References after it start enlarged; one filling an empty enlarged step lands its frame', async () => {
    install();
    await state().enlargeDiagramStep('step-2');
    const empty = state().insertDiagramStep('step-2', 'after')!;
    expect(step(empty).zoom).toBeDefined();
    tracked.trackDiagramStepEnlarged.mockClear();
    const card = referencesStep('card');
    const sent = [{ source: card.source as DiagramReferencesSource, picture: card.picture as DiagramStepDiagramPicture, text: card.text }];
    const filled = state().pullReferencesDiagramSteps([...sent, ...sent], { kind: 'fill', stepId: empty }, { loadId: state().diagramLoadId, label: 'Add from References' })!;
    expect(filled.stepIds[0]).toBe(empty);
    for (const id of filled.stepIds) expect(step(id).zoom).toMatchObject({ from: 'area-head', frame: { centre: expect.any(Array) } });
    expect(tracked.trackDiagramStepEnlarged.mock.calls).toEqual([
      ['seeded', 'picture', 'none', 'circle', 'references'],
      ['seeded', 'picture', 'none', 'circle', 'references'],
    ]);
    const after = state().pullReferencesDiagramSteps(sent, { kind: 'after', stepId: filled.stepIds[1]! }, { loadId: state().diagramLoadId, label: 'Add from References' })!;
    expect(step(after.stepIds[0]!).zoom?.from).toBe('area-head');
  });

  it('an empty step turned Enlarged counts the toggle when its first picture lands the frame', async () => {
    const s = craneStep('S.none');
    install([{ ...s, annotations: [headArea(s)], annotatedPictureKey: s.picture!.key }, { ...createStep(() => 'step-empty'), id: 'step-empty' }]);
    expect(await state().enlargeDiagramStep('step-empty')).toBe(true);
    expect(tracked.trackDiagramStepEnlarged).not.toHaveBeenCalled();
    expect(state().setDiagramStepPicture('step-empty', svgAsset('a'))).toBe(true);
    expect(tracked.trackDiagramStepEnlarged.mock.calls).toEqual([['toggle', 'picture', 'none', 'circle', 'svg']]);
  });

  it('counts an empty step’s enlarging once, on its first picture: not on a duplicate’s, nor a picture given back (review of 16g)', async () => {
    const s = craneStep('S.none');
    install([{ ...s, annotations: [headArea(s)], annotatedPictureKey: s.picture!.key }, { ...createStep(() => 'step-empty'), id: 'step-empty' }]);
    // Turned on with no picture: the toggle's.
    expect(await state().enlargeDiagramStep('step-empty')).toBe(true);
    const twin = state().duplicateDiagramStep('step-empty')!;
    expect(state().setDiagramStepPicture(twin, svgAsset('a'))).toBe(true);
    expect(tracked.trackDiagramStepEnlarged).not.toHaveBeenCalled();
    expect(state().setDiagramStepPicture('step-empty', svgAsset('b'))).toBe(true);
    expect(tracked.trackDiagramStepEnlarged.mock.calls).toEqual([['toggle', 'picture', 'none', 'circle', 'svg']]);
    expect(state().removeDiagramStepPicture('step-empty')).toBe(true);
    expect(state().setDiagramStepPicture('step-empty', svgAsset('c'))).toBe(true);
    expect(tracked.trackDiagramStepEnlarged).toHaveBeenCalledTimes(1);
    // Made empty after an enlarged step: the seed's, on its own first picture alone.
    tracked.trackDiagramStepEnlarged.mockClear();
    const empty = state().insertDiagramStep('step-empty', 'after')!;
    const copy = state().duplicateDiagramStep(empty)!;
    expect(state().setDiagramStepPicture(copy, svgAsset('d'))).toBe(true);
    expect(tracked.trackDiagramStepEnlarged).not.toHaveBeenCalled();
    expect(state().setDiagramStepPicture(empty, svgAsset('e'))).toBe(true);
    expect(tracked.trackDiagramStepEnlarged.mock.calls).toEqual([['seeded', 'picture', 'none', 'circle', 'svg']]);
  });

  it('a duplicate of an enlarged step keeps its frame, imprint and provenance, and Update places both', async () => {
    install();
    await state().enlargeDiagramStep('step-2');
    const copy = state().duplicateDiagramStep('step-2')!;
    expect(step(copy).zoom).toBe(step('step-2').zoom);
    tracked.trackDiagramStepEnlarged.mockClear();
    expect(await state().updateEnlargedDiagramSteps('area-head')).toBe(2);
    expect(tracked.trackDiagramStepEnlarged).toHaveBeenCalledTimes(2);
  });
});

describe('steps moved or deleted change no frame (Z2, point-in-time)', () => {
  it('moving the enlarged step, deleting its area, or the area’s step, leaves its frame and marks as they are', async () => {
    install();
    await state().enlargeDiagramStep('step-2');
    const enlarged = step('step-2');
    const areaStep = stepsIn(state().diagram!)[0]!.id;
    expect(state().moveDiagramStep('step-2', 0)).toBe(true);
    expect(step('step-2')).toBe(enlarged);
    state().editDiagramAnnotations(areaStep, 'Delete annotation', (list) => list.filter((mark) => mark.kind !== 'zoom'));
    expect(step('step-2')).toBe(enlarged);
    expect(await state().updateEnlargedDiagramSteps('area-head')).toBe(0);
    expect(state().deleteDiagramSteps([areaStep])).toBe(true);
    expect(step('step-2')).toBe(enlarged);
    // Turned off, and on again: nothing before it now has an area or a frame to capture from.
    expect(state().unenlargeDiagramStep('step-2')).toBe(true);
    expect(await state().enlargeDiagramStep('step-2')).toBe(false);
  });
});
