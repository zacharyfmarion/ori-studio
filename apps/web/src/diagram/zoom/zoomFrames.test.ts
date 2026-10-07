import { describe, expect, it } from 'vitest';
import { ANNOTATION_REACH, ZOOM_RADIUS, ZOOM_SIDE, type PicturePoint } from '../annotate/annotationModel';
import { poseMove, sceneTurnMove } from '../annotate/annotationCarry';
import {
  createDiagram,
  createStep,
  createTurn,
  editStepAnnotations,
  insertSteps,
  setLinkedPicture,
  setReferencesSide,
  setUploadPose,
  stepById,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { cpStep, referencesStep, scenePicture } from '../document/diagramSteps.fixtures';
import { storedScene } from '../pictures/pictureFrame';
import { craneStep, imprintCase, turnedCapture } from './zoom.fixtures';
import { imprintOn } from './zoomCapture';
import { frameProblems, marksInPicture, marksMoved } from './zoomInvariant.fixtures';
import {
  anchorInPlace,
  enlargeStep,
  landSeededFrame,
  outlineFromBox,
  outlineIntoBox,
  relandFrame,
  reposeFrame,
  seedNewSteps,
  setFrameAnchor,
  setFrameEdge,
  setFrameOutline,
  setFrameScale,
  setFrameShape,
  stepWindow,
  unenlargeStep,
  unitsMove,
  updateEnlargedSteps,
} from './zoomFrames';
import {
  anchorPoint,
  defaultAnchor,
  faceAt,
  offSpread,
  ontoSpread,
  paperFacesOf,
  toPicture,
  toScene,
  topDrawn,
  topUnspread,
  unspreadOn,
} from './zoomImprint';
import { frameWindow, outlineAsShape } from './zoomModel';

const NO_ASSETS = {};

function headArea(step: DiagramStep, spread: 'none' | 'affine' | 'depth', id = 'area-head'): KnownDiagramAnnotation {
  const { centre, radius } = toPicture(paperFacesOf(step)!, imprintCase(`C.${spread}`).frame);
  return { id, kind: 'zoom', from: centre, to: centre, radius };
}

/** A step with marks drawn on its picture: a valley line and a label, in its picture units. */
function marked(step: DiagramStep, id: string): DiagramStep {
  const marks: KnownDiagramAnnotation[] = [
    { id: 'mark-line', kind: 'valley-line', from: [0.3, 0.2], to: [0.6, 0.35] },
    { id: 'mark-label', kind: 'label', from: [0.45, 0.25], to: [0.45, 0.25], text: 'A' },
  ];
  return { ...step, id, annotations: marks, annotatedPictureKey: step.picture!.key };
}

/** Step 22 with its area, and C after it, marked. */
function crane(spread: 'none' | 'affine' | 'depth' = 'affine'): DiagramDocument {
  const s = craneStep(`S.${spread}`);
  const area = { ...s, annotations: [headArea(s, spread)], annotatedPictureKey: s.picture!.key };
  return insertSteps(createDiagram({ title: 'Crane' }), [area, marked(craneStep(`C.${spread}`), 'step-n')], 0);
}

const step = (document: DiagramDocument, id = 'step-n') => stepById(document, id)!;
const distance = (a: PicturePoint, b: PicturePoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('Enlarged turned on, and off', () => {
  it('captures the frame, and carries the marks from the whole picture into its window, on the same paper', () => {
    const document = crane();
    const before = step(document);
    const { document: enlarged, captured } = enlargeStep(document, 'step-n', NO_ASSETS);
    expect(captured?.placed).toBe('face');
    const after = step(enlarged);
    expect(after.zoom?.frame).toBeDefined();
    expect(frameProblems(enlarged)).toEqual([]);
    expect(marksMoved(before, after)).toEqual([]);
    // In the window's units now: the window is the frame they are drawn on.
    const window = stepWindow(after)!;
    expect(after.annotations[0]).not.toEqual(before.annotations[0]);
    expect(window.width).toBeLessThan(1);
  });

  it('removes a step’s own areas as it enlarges it: a step is enlarged or holds areas', () => {
    const document = crane();
    const n = step(document);
    const withArea = { ...n, annotations: [...n.annotations, headArea(n, 'affine', 'area-copy')] };
    const doc = { ...document, steps: document.steps.map((entry) => (entry.id === 'step-n' ? withArea : entry)) };
    const after = step(enlargeStep(doc, 'step-n', NO_ASSETS).document);
    expect(after.annotations.map((mark) => mark.id)).toEqual(['mark-line', 'mark-label']);
  });

  it('turned off, drops the frame and carries the marks back to the whole picture', () => {
    const enlarged = enlargeStep(crane(), 'step-n', NO_ASSETS).document;
    const off = unenlargeStep(enlarged, 'step-n', NO_ASSETS);
    expect(step(off).zoom).toBeUndefined();
    expect(marksMoved(step(enlarged), step(off))).toEqual([]);
    expect(step(off).annotations.map((mark) => (mark as KnownDiagramAnnotation).from)).toEqual(
      step(crane()).annotations.map((mark) => (mark as KnownDiagramAnnotation).from).map(([x, y]) => [expect.closeTo(x, 12), expect.closeTo(y, 12)])
    );
  });

  it('carries every mark, a long one across the model from a small frame too, into the window and back exactly (S1.6)', () => {
    // The crane's S1: a small area round the head; a long valley line along the bottom, and a circle at the tail's tip.
    const small = crane();
    const s = small.steps[0] as DiagramStep;
    const area = { ...(s.annotations[0] as KnownDiagramAnnotation), radius: 0.05 };
    const document = { ...small, steps: small.steps.map((entry) => (entry.id === s.id ? { ...s, annotations: [area] } : entry)) };
    const n = step(document);
    const long: KnownDiagramAnnotation = { id: 'mark-long', kind: 'valley-line', from: [0, 0.95], to: [1, 0.95] };
    const far: KnownDiagramAnnotation = { id: 'mark-far', kind: 'circle', from: [0.07, 0.97], to: [0.07, 0.97] };
    const marked = { ...n, annotations: [...n.annotations, long, far] };
    const doc = { ...document, steps: document.steps.map((entry) => (entry.id === 'step-n' ? marked : entry)) };
    const enlargedDoc = enlargeStep(doc, 'step-n', NO_ASSETS).document;
    const enlarged = step(enlargedDoc);
    // Every mark carried, in step: the far ones lie past reach's four windows, as far as the whole picture's reach.
    expect(enlarged.annotatedPictureKey).toBe(enlarged.picture!.key);
    expect(marksMoved(marked, enlarged)).toEqual([]);
    const carriedFar = enlarged.annotations.find((mark) => mark.id === 'mark-far') as KnownDiagramAnnotation;
    expect(Math.max(...carriedFar.from.map(Math.abs))).toBeGreaterThan(ANNOTATION_REACH);
    // Written and read back as this build's: nothing locked, every mark known and where it was.
    const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(enlargedDoc))))!.document;
    const back = step(read);
    expect(back.unknown).toBeUndefined();
    expect(back.annotations).toEqual(enlarged.annotations);
    // A mark drawn on the step leaves the far ones where they are: an edit cleans within the step's reach.
    const added: KnownDiagramAnnotation = { id: 'mark-new', kind: 'mountain-line', from: [0.2, 0.2], to: [0.8, 0.2] };
    const edited = step(editStepAnnotations(enlargedDoc, 'step-n', (list) => [...list, added]));
    expect(edited.annotations.slice(0, enlarged.annotations.length)).toEqual(enlarged.annotations);
    // The frame moved by hand carries them all, still in step.
    const frame = enlarged.zoom!.frame!;
    const moved = step(setFrameOutline(enlargedDoc, 'step-n', { ...frame, centre: [frame.centre[0] + 0.02, frame.centre[1]] }, NO_ASSETS));
    expect(moved.annotatedPictureKey).toBe(moved.picture!.key);
    expect(marksMoved(enlarged, moved)).toEqual([]);
    // Turned off, every mark is where it was drawn on the whole picture, still in step.
    const off = step(unenlargeStep(enlargedDoc, 'step-n', NO_ASSETS));
    expect(off.zoom).toBeUndefined();
    expect(off.annotatedPictureKey).toBe(off.picture!.key);
    expect(marksMoved(marked, off)).toEqual([]);
    expect(off.annotations.map((mark) => (mark as KnownDiagramAnnotation).from)).toEqual(
      marked.annotations.map((mark) => (mark as KnownDiagramAnnotation).from).map(([x, y]) => [expect.closeTo(x, 12), expect.closeTo(y, 12)])
    );
  });

  it('keeps every mark where it is, out of step, when one could not come back to the whole picture within its reach', () => {
    const enlargedDoc = enlargeStep(crane(), 'step-n', NO_ASSETS).document;
    const enlarged = step(enlargedDoc);
    // Past the whole picture's reach, as only a newer build's window reaches: it cannot go back there.
    const window = stepWindow(enlarged)!;
    const unit = Math.max(window.width, window.height);
    const beyond: KnownDiagramAnnotation = {
      id: 'mark-beyond',
      kind: 'circle',
      from: [(-ANNOTATION_REACH - 1 - window.x) / unit, 0.5],
      to: [(-ANNOTATION_REACH - 1 - window.x) / unit, 0.5],
    };
    const withBeyond = { ...enlarged, annotations: [...enlarged.annotations, beyond] };
    const doc = { ...enlargedDoc, steps: enlargedDoc.steps.map((entry) => (entry.id === 'step-n' ? withBeyond : entry)) };
    const off = step(unenlargeStep(doc, 'step-n', NO_ASSETS));
    expect(off.annotations).toBe(withBeyond.annotations);
    expect(off.annotatedPictureKey).toBeNull();
  });

  it('keeps marks it cannot carry where they are, out of step, rather than leave one behind', () => {
    const document = crane();
    const n = step(document);
    const unknown = { ...n, annotations: [...n.annotations, { id: 'mark-newer', unknown: { id: 'mark-newer', kind: 'spiral' } }] };
    const doc = { ...document, steps: document.steps.map((entry) => (entry.id === 'step-n' ? unknown : entry)) };
    const after = step(enlargeStep(doc, 'step-n', NO_ASSETS).document);
    expect(after.annotations).toEqual(unknown.annotations);
    expect(after.annotatedPictureKey).toBeNull();
  });
});

describe('Update Enlarged Steps', () => {
  it('places every step with the area’s provenance again, over a hand move, its marks going with the window', () => {
    let document = enlargeStep(crane(), 'step-n', NO_ASSETS).document;
    const placed = step(document);
    document = setFrameOutline(document, 'step-n', { ...placed.zoom!.frame!, radius: placed.zoom!.frame!.radius! * 1.5 }, NO_ASSETS);
    const moved = step(document);
    expect(moved.zoom!.frame!.radius).not.toBe(placed.zoom!.frame!.radius);
    const { document: updated, captured } = updateEnlargedSteps(document, 'area-head', NO_ASSETS);
    expect(captured).toHaveLength(1);
    expect(step(updated).zoom!.frame).toEqual(placed.zoom!.frame);
    expect(marksMoved(moved, step(updated))).toEqual([]);
    expect(frameProblems(updated)).toEqual([]);
  });
});

describe('a frame moved, resized or reshaped by hand', () => {
  it('on a step with no faces, is the frame from then on: a later capture copies it, and a picture with faces keeps it', () => {
    const s = craneStep('S.affine');
    const area = { ...s, annotations: [headArea(s, 'affine')], annotatedPictureKey: s.picture!.key };
    // N captured before its picture kept faces: S's imprint kept, for a Refresh to land.
    const n = marked(craneStep('C.affine', { faces: false }), 'step-n');
    let document = insertSteps(createDiagram({ title: 'Crane' }), [area, n], 0);
    document = enlargeStep(document, 'step-n', NO_ASSETS).document;
    expect(step(document).zoom!.imprint).toBeDefined();
    const set = { ...step(document).zoom!.frame!, centre: [0.25, 0.3] as PicturePoint };
    document = setFrameOutline(document, 'step-n', set, NO_ASSETS);
    const moved = step(document);
    expect(moved.zoom!.frame).toEqual(set);
    expect(moved.zoom!.imprint).toBeUndefined();
    // A step after it, enlarged from it: the frame where the hand left it, copied in picture units.
    const after = enlargeStep(insertSteps(document, [marked(craneStep('C.affine'), 'step-m')], 2), 'step-m', NO_ASSETS);
    expect(after.captured).toMatchObject({ placed: 'picture', anchor: 'none' });
    expect(step(after.document, 'step-m').zoom!.frame).toEqual(set);
    // N refreshed, its picture with faces now: the frame stays where it was set (Z10).
    const refreshed = { ...moved, picture: craneStep('C.affine').picture };
    expect(relandFrame(refreshed).zoom!.frame).toEqual(set);
  });


  it('stays as set, its imprint made again on the same face, its marks on the same paper', () => {
    for (const spread of ['none', 'affine', 'depth'] as const) {
      const document = enlargeStep(crane(spread), 'step-n', NO_ASSETS).document;
      const before = step(document);
      const frame = before.zoom!.frame!;
      const set = { ...frame, centre: [frame.centre[0] + 0.03, frame.centre[1] - 0.02] as PicturePoint, radius: frame.radius! * 0.8 };
      const after = step(setFrameOutline(document, 'step-n', set, NO_ASSETS));
      // Where it was dropped — or, in a strip the spread opened, on the layer above, as near as the strip is wide.
      const faces = paperFacesOf(before)!;
      const dropped = toScene(faces, set).centre;
      const settled = toPicture(faces, { centre: ontoSpread(faces, offSpread(faces, dropped)), radius: 1 }).centre;
      expect(distance(after.zoom!.frame!.centre, settled), spread).toBeLessThan(1e-12);
      expect(distance(settled, set.centre), spread).toBeLessThan(spread === 'none' ? 1e-12 : 0.025);
      expect(after.zoom!.frame!.radius).toBeCloseTo(set.radius, 12);
      expect(after.zoom!.imprint!.on).toEqual(before.zoom!.imprint!.on);
      expect(after.zoom!.imprint).not.toEqual(before.zoom!.imprint);
      expect(frameProblems({ ...document, steps: [after] })).toEqual([]);
      expect(marksMoved(before, after)).toEqual([]);
    }
  });

  it('resized where it lies, keeps its centre exactly, spread or not', () => {
    for (const spread of ['none', 'affine', 'depth'] as const) {
      const document = enlargeStep(crane(spread), 'step-n', NO_ASSETS).document;
      const frame = step(document).zoom!.frame!;
      const after = step(setFrameOutline(document, 'step-n', { ...frame, radius: frame.radius! * 1.25 }, NO_ASSETS));
      expect(distance(after.zoom!.frame!.centre, frame.centre), spread).toBeLessThan(1e-12);
    }
  });

  it('resized again and again by its rim, keeps a centre that lies off the paper where it was, spread or not', () => {
    for (const spread of ['affine', 'depth'] as const) {
      const document = enlargeStep(crane(spread), 'step-n', NO_ASSETS).document;
      const n = step(document);
      const faces = paperFacesOf(n)!;
      // Beside a flap, on no face: a point just outside a face unspread, where the spread takes it.
      let beside: PicturePoint | null = null;
      for (const ring of faces.unspread) {
        for (let index = 0; index < ring.length && !beside; index += 1) {
          const [a, b] = [ring[index]!, ring[(index + 1) % ring.length]!];
          const length = distance(a, b) || 1;
          const point: PicturePoint = [(a[0] + b[0]) / 2 + (6 * (b[1] - a[1])) / length, (a[1] + b[1]) / 2 - (6 * (b[0] - a[0])) / length];
          const drawn = ontoSpread(faces, point);
          if (topUnspread(faces, point) === null && topDrawn(faces, drawn) === null) beside = drawn;
        }
      }
      expect(beside, spread).not.toBeNull();
      const centre = toPicture(faces, { centre: beside!, radius: 1 }).centre;
      let doc = setFrameOutline(document, 'step-n', { ...n.zoom!.frame!, centre }, NO_ASSETS);
      expect(distance(step(doc).zoom!.frame!.centre, centre), spread).toBeLessThan(1e-9);
      for (const grow of [1.1, 0.9, 1.2]) {
        const frame = step(doc).zoom!.frame!;
        doc = setFrameOutline(doc, 'step-n', { ...frame, radius: frame.radius! * grow }, NO_ASSETS);
        expect(distance(step(doc).zoom!.frame!.centre, centre), spread).toBeLessThan(1e-9);
      }
    }
  });

  it('resized by hand, is held no smaller than an area may be drawn, its marks still in step', () => {
    const document = enlargeStep(crane('affine'), 'step-n', NO_ASSETS).document;
    const frame = step(document).zoom!.frame!;
    const point = step(setFrameOutline(document, 'step-n', { ...frame, radius: 1e-6 }, NO_ASSETS));
    expect(point.zoom!.frame!.radius).toBeCloseTo(ZOOM_RADIUS.min, 12);
    expect(point.annotatedPictureKey).toBe(point.picture!.key);
    const rounded = outlineAsShape(frame, 'rounded');
    const sliver = step(setFrameOutline(document, 'step-n', { ...rounded, size: [rounded.size![0], 1e-6] }, NO_ASSETS));
    expect(sliver.zoom!.frame!.size).toEqual([expect.closeTo(rounded.size![0], 12), expect.closeTo(ZOOM_SIDE.min, 12)]);
  });

  it('reshaped, takes the new shape about the same centre', () => {
    const document = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const frame = step(document).zoom!.frame!;
    const after = step(setFrameOutline(document, 'step-n', outlineAsShape(frame, 'rounded'), NO_ASSETS));
    expect(after.zoom!.shape).toBe('rounded');
    expect(after.zoom!.frame!.size![0]).toBeCloseTo(2 * frame.radius!, 12);
    expect(frameProblems({ ...document, steps: [after] })).toEqual([]);
  });

  it('settles a centre dropped in a strip the spread opened on the layer above it', () => {
    const document = enlargeStep(crane('depth'), 'step-n', NO_ASSETS).document;
    const n = step(document);
    const faces = paperFacesOf(n)!;
    // A drawn point where a lower layer shows that a layer above covers unspread.
    let strip: PicturePoint | null = null;
    for (const piece of faces.pieces) {
      for (const [a, b] of piece.ring.map((point, index) => [point, piece.ring[(index + 1) % piece.ring.length]!] as const)) {
        const middle: PicturePoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const inward: PicturePoint = [middle[0] + (b[1] - a[1]) * 0.002, middle[1] - (b[0] - a[0]) * 0.002];
        for (const point of [inward, [2 * middle[0] - inward[0], 2 * middle[1] - inward[1]] as PicturePoint]) {
          const top = topDrawn(faces, point);
          if (top === null) continue;
          const under = topUnspread(faces, unspreadOn(faces, top, point));
          if (under !== null && under !== top) strip ??= point;
        }
      }
    }
    expect(strip).not.toBeNull();
    const centre = toPicture(faces, { centre: strip!, radius: 1 }).centre;
    const after = step(setFrameOutline(document, 'step-n', { ...n.zoom!.frame!, centre }, NO_ASSETS));
    const settled = toPicture(faces, { centre: ontoSpread(faces, offSpread(faces, strip!)), radius: 1 }).centre;
    expect(distance(after.zoom!.frame!.centre, centre)).toBeGreaterThan(1e-9);
    expect(distance(after.zoom!.frame!.centre, settled)).toBeLessThan(1e-12);
  });
});

describe('a frame’s anchor picked, or reset', () => {
  it('leaves the frame and its marks, and makes its imprint again through the face picked', () => {
    const document = enlargeStep(crane('affine'), 'step-n', NO_ASSETS).document;
    const before = step(document);
    const faces = paperFacesOf(before)!;
    const picked = anchorPoint(faces, 0)!;
    const after = step(setFrameAnchor(document, 'step-n', picked));
    expect(after.zoom!.frame).toBe(before.zoom!.frame);
    expect(after.zoom!.imprint).toMatchObject({ on: picked, picked: true });
    expect(after.annotations).toBe(before.annotations);
    expect(frameProblems({ ...document, steps: [after] })).toEqual([]);
    // Reset: the default rule's face and point, on this step.
    const reset = step(setFrameAnchor({ ...document, steps: [after] }, 'step-n', null));
    const drawn = toScene(faces, before.zoom!.frame!);
    expect(reset.zoom!.imprint!.on).toEqual(anchorPoint(faces, defaultAnchor(faces, drawn)!));
    expect(reset.zoom!.imprint!.picked).toBeUndefined();
    // A pick off its paper changes nothing.
    expect(setFrameAnchor(document, 'step-n', [9999, 9999])).toBe(document);
    expect(faceAt(faces, picked)).toBe(0);
  });
});

describe('a frame landed far off its picture', () => {
  it('is held within reach, so the step reads back as this build’s', () => {
    const n = craneStep('C.none');
    const on = anchorPoint(paperFacesOf(n)!, 14)!;
    // An area drawn far across the model from the face it anchors to, landing on a much smaller picture.
    const imprint = { centre: [on[0] + 900, on[1]] as PicturePoint, radius: 40, on };
    const landed = relandFrame({ ...n, zoom: { from: 'area-far', shape: 'circle', imprint, frame: { centre: [0.5, 0.5], radius: 0.1 } } });
    expect(Math.abs(landed.zoom!.frame!.centre[0])).toBeLessThanOrEqual(ANNOTATION_REACH);
    const written = JSON.parse(JSON.stringify(writeDiagram(insertSteps(createDiagram({ title: 'Reach' }), [landed], 0))));
    const read = readDiagram(written)!.document.steps[0] as DiagramStep;
    expect(read.unknown).toBeUndefined();
    expect(read.zoom).toEqual(landed.zoom);
  });
});

describe('a step’s own picture changed', () => {
  it('a seeded step’s first picture, a refresh or a relink: the frame lands from its imprint, its marks unchanged in the window', () => {
    const document = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const n = step(document);
    // Relinked to the same fold spread: the frame follows the layer under its centre.
    const relinked = relandFrame({ ...n, picture: craneStep('C.affine').picture, source: craneStep('C.affine').source });
    expect(relinked.zoom!.frame).not.toEqual(n.zoom!.frame);
    expect(relinked.annotations).toBe(n.annotations);
    expect(frameProblems({ ...document, steps: [relinked] })).toEqual([]);
    // The same picture again: nothing changes.
    expect(relandFrame(n)).toBe(n);
    // A picture with no faces keeps the frame in picture units.
    const older = { ...n, picture: craneStep('C.affine', { faces: false }).picture };
    expect(relandFrame(older)).toBe(older);
  });

  it('re-posed, the frame lands on the turned picture and the marks go with the pose, window to window', () => {
    const document = enlargeStep(crane('affine'), 'step-n', NO_ASSETS).document;
    const before = step(document);
    const turned = turnedCapture(before, 37);
    const move = sceneTurnMove(storedScene(before.picture as never)!.bounds, storedScene(turned.picture as never)!.bounds, 37)!;
    const after = reposeFrame(before, turned, move, NO_ASSETS);
    expect(frameProblems({ ...document, steps: [after] })).toEqual([]);
    // The paper under the frame is where the turn took it.
    expect(distance(after.zoom!.frame!.centre, move.point(before.zoom!.frame!.centre))).toBeLessThan(1e-4);
    const [was, now] = [marksInPicture(before), marksInPicture(after)];
    for (const [id, points] of was) {
      points.forEach((point, index) => expect(distance(move.point(point), now.get(id)![index]!), id).toBeLessThan(1e-9));
    }
  });

  it('re-posed with no faces, the frame is carried by the pose’s move', () => {
    const document = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const before = { ...step(document), picture: craneStep('C.none', { faces: false }).picture };
    const turned = turnedCapture(before, 90);
    const move = sceneTurnMove(storedScene(before.picture as never)!.bounds, storedScene(turned.picture as never)!.bounds, 90)!;
    const after = reposeFrame(before, turned, move, NO_ASSETS);
    expect(distance(after.zoom!.frame!.centre, move.point(before.zoom!.frame!.centre))).toBeLessThan(1e-12);
    expect(after.zoom!.frame!.radius).toBeCloseTo(before.zoom!.frame!.radius!, 12);
  });
});

describe('moving marks between units', () => {
  it('scales and shifts from one box to another, through a picture’s move', () => {
    const from = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
    const to = frameWindow({ centre: [0.5, 0.5], radius: 0.1 });
    const move = unitsMove(from, to);
    expect(move.point([0, 0])).toEqual([(0.2 - 0.4) / 0.2, (0.3 - 0.4) / 0.2].map((v) => expect.closeTo(v, 12)));
    expect(move.mirrors).toBe(false);
  });
});

describe('a frame’s Shape, Size and Edge, and a new step’s start (16e)', () => {
  it('reshapes the frame about its centre, its marks by the window’s move and its imprint made again', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const before = step(enlarged);
    const reshaped = setFrameShape(enlarged, 'step-n', 'rounded', NO_ASSETS);
    const after = step(reshaped);
    expect(after.zoom).toMatchObject({ shape: 'rounded', frame: { size: [expect.any(Number), expect.any(Number)] } });
    expect(after.zoom!.frame!.centre[0]).toBeCloseTo(before.zoom!.frame!.centre[0], 9);
    expect(frameProblems(reshaped)).toEqual([]);
    expect(marksMoved(before, after)).toEqual([]);
    // Already that shape: the diagram as it was.
    expect(setFrameShape(reshaped, 'step-n', 'rounded', NO_ASSETS)).toBe(reshaped);
  });

  it('sets the frame’s Size, held to its range, and back to Fill; its Edge, and back to its shape’s', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    expect(step(setFrameScale(enlarged, 'step-n', 9)).zoom!.scale).toBe(6);
    expect(step(setFrameScale(setFrameScale(enlarged, 'step-n', 2), 'step-n', null)).zoom!.scale).toBeUndefined();
    expect(setFrameScale(enlarged, 'step-n', null)).toBe(enlarged);
    expect(step(setFrameEdge(enlarged, 'step-n', 'whole')).zoom!.edge).toBe('whole');
    expect(step(setFrameEdge(setFrameEdge(enlarged, 'step-n', 'whole'), 'step-n', null)).zoom!.edge).toBeUndefined();
  });

  it('starts a step added after an enlarged one enlarged, and lands its frame on its first picture', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const empty = { ...createStep(() => 'step-new'), id: 'step-new' };
    const seeded = seedNewSteps(insertSteps(enlarged, [empty], enlarged.steps.length), ['step-new'], NO_ASSETS).document;
    const fresh = step(seeded, 'step-new');
    // Captured from step N's frame, its default anchor worked out afresh there; the provenance its area's.
    expect(fresh.zoom).toMatchObject({ from: 'area-head', shape: 'circle', imprint: { on: [expect.any(Number), expect.any(Number)] } });
    expect(fresh.zoom!.frame).toEqual(step(enlarged).zoom!.frame);
    // After a step that is not enlarged: nothing.
    const plain = insertSteps(crane('none'), [empty], 1);
    expect(seedNewSteps(plain, ['step-new'], NO_ASSETS)).toEqual({ document: plain, seeded: [] });
    // Its first picture: the imprint lands through the face that holds its paper point.
    const picture = craneStep('C.none').picture!;
    const linked = { ...seeded, steps: seeded.steps.map((entry) => (entry.id === 'step-new' ? { ...craneStep('C.none'), id: 'step-new', zoom: fresh.zoom } : entry)) };
    const landed = landSeededFrame(seeded, linked, 'step-new');
    expect(landed.placed).toBe('face');
    // The same picture as N's: the frame lands where N's is.
    const [was, now] = [step(enlarged).zoom!.frame!, step(landed.document, 'step-new').zoom!.frame!];
    expect(Math.hypot(now.centre[0] - was.centre[0], now.centre[1] - was.centre[1])).toBeLessThan(1e-9);
    expect(now.radius).toBeCloseTo(was.radius!, 9);
    expect(step(landed.document, 'step-new').picture).toBe(step(linked, 'step-new').picture);
    expect(picture.kind).toBe('scene');
    // A step that had a picture already: nothing lands.
    expect(landSeededFrame(linked, linked, 'step-new')).toEqual({ document: linked, placed: null });
  });

  it('turns an outline into a window’s units and back', () => {
    const box = { x: 0.3, y: 0.2, width: 0.4, height: 0.2 };
    const outline = { centre: [0.5, 0.3] as [number, number], size: [0.4, 0.2] as [number, number], angle: 30 };
    const into = outlineIntoBox(box, outline);
    expect(into).toEqual({ centre: [expect.closeTo(0.5, 9), expect.closeTo(0.25, 9)], size: [1, 0.5], angle: 30 });
    const back = outlineFromBox(box, into);
    expect(back.centre).toEqual([expect.closeTo(0.5, 9), expect.closeTo(0.3, 9)]);
    expect(back.size).toEqual([expect.closeTo(0.4, 9), expect.closeTo(0.2, 9)]);
  });

  it('names the steps Update placed, for what counts them', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    expect(updateEnlargedSteps(enlarged, 'area-head', NO_ASSETS).stepIds).toEqual(['step-n']);
  });
});

describe('an enlarged step’s own picture changed, by any edit of it (16g)', () => {
  const bounds = (each: DiagramStep) => storedScene(each.picture as never)!.bounds;
  const linked = (each: DiagramStep) => ({ source: each.source as DiagramCpSource, picture: each.picture });
  /** Where a frame is in scene px on its own picture. */
  const drawnFrame = (each: DiagramStep) => toScene(paperFacesOf(each)!, each.zoom!.frame!);
  /** The same marks drawn on the whole picture, through the same edit: where an enlarged step's must go too. */
  const wholeAfter = (document: DiagramDocument, edit: (whole: DiagramDocument) => DiagramDocument) =>
    marksInPicture(step(edit(unenlargeStep(document, 'step-n', NO_ASSETS))));
  const expectMarksAt = (got: Map<string, PicturePoint[]>, want: Map<string, PicturePoint[]>, label: string) => {
    expect([...got.keys()]).toEqual([...want.keys()]);
    for (const [id, points] of want) points.forEach((point, index) => expect(distance(got.get(id)![index]!, point), `${label} ${id}`).toBeLessThan(1e-9));
  };

  it('turned by Pose, lands its frame on the turned paper and turns its marks with it, in step', () => {
    for (const spread of ['none', 'affine'] as const) {
      const document = enlargeStep(crane(spread), 'step-n', NO_ASSETS).document;
      const before = step(document);
      const turned = turnedCapture(before, 37);
      const turn = (each: DiagramDocument) => setLinkedPicture(each, 'step-n', linked(turned));
      const posed = step(turn(document));
      expect(frameProblems({ ...document, steps: [posed] }), spread).toEqual([]);
      const move = sceneTurnMove(bounds(before), bounds(turned), 37)!;
      expect(distance(posed.zoom!.frame!.centre, move.point(before.zoom!.frame!.centre)), spread).toBeLessThan(1e-4);
      expect(drawnFrame(posed).radius).toBeCloseTo(drawnFrame(before).radius!, 6);
      expect(posed.annotatedPictureKey).toBe(posed.picture!.key);
      expectMarksAt(marksInPicture(posed), wholeAfter(document, turn), spread);
    }
  });

  it('turned and turned back, comes back to its frame and its marks', () => {
    const document = enlargeStep(crane('affine'), 'step-n', NO_ASSETS).document;
    const before = step(document);
    const turned = turnedCapture(before, 37);
    const there = setLinkedPicture(document, 'step-n', linked(turned));
    const back = step(setLinkedPicture(there, 'step-n', linked(turnedCapture(step(there), -37))));
    expect(distance(back.zoom!.frame!.centre, before.zoom!.frame!.centre)).toBeLessThan(1e-6);
    expect(back.zoom!.frame!.radius).toBeCloseTo(before.zoom!.frame!.radius!, 6);
    expectMarksAt(marksInPicture(back), marksInPicture(before), 'back');
    expect(back.annotatedPictureKey).toBe(back.picture!.key);
  });

  it('its layers spread, spread otherwise or put back, follows the layer under its centre at its size, its marks with their faces', () => {
    const order = ['none', 'affine', 'depth', 'none'] as const;
    let document = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    for (const spread of order.slice(1)) {
      const before = step(document);
      const next = craneStep(`C.${spread}`);
      const pose = (each: DiagramDocument) => setLinkedPicture(each, 'step-n', linked(next));
      const posed = step(pose(document));
      expect(frameProblems({ ...document, steps: [posed] }), spread).toEqual([]);
      // Where the spread takes the paper under its centre, unspread: the layer on top there.
      const [was, is] = [paperFacesOf(before)!, paperFacesOf(posed)!];
      const unspread = offSpread(was, drawnFrame(before).centre);
      expect(distance(drawnFrame(posed).centre, ontoSpread(is, unspread)), spread).toBeLessThan(1e-6);
      expect(drawnFrame(posed).radius, spread).toBeCloseTo(drawnFrame(before).radius!, 9);
      expect(posed.zoom!.frame!.angle).toBe(before.zoom!.frame!.angle);
      expect(posed.annotatedPictureKey).toBe(posed.picture!.key);
      expectMarksAt(marksInPicture(posed), wholeAfter(document, pose), spread);
      document = pose(document);
    }
  });

  it('refreshed or relinked, lands its frame from its imprint on the new picture, its marks unchanged in the window and out of step', () => {
    const document = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const before = step(document);
    const s = craneStep('S.none');
    const source = { ...(before.source as DiagramCpSource), fingerprint: 'fp-refolded' };
    const refreshed = step(setLinkedPicture(document, 'step-n', { source, picture: s.picture }));
    expect(refreshed.zoom!.frame).not.toEqual(before.zoom!.frame);
    expect(frameProblems({ ...document, steps: [refreshed] })).toEqual([]);
    // Through the face that holds its paper point there: where S's own frame from that imprint lands.
    const landed = relandFrame({ ...before, picture: s.picture, source });
    expect(refreshed.zoom!.frame).toEqual(landed.zoom!.frame);
    expect(refreshed.annotations).toBe(before.annotations);
    expect(refreshed.annotatedPictureKey).toBe(before.picture!.key);
    // A picture with no faces: the frame stays where it was in picture units.
    const faceless = step(setLinkedPicture(document, 'step-n', { source, picture: craneStep('S.none', { faces: false }).picture }));
    expect(faceless.zoom!.frame).toEqual(before.zoom!.frame);
  });

  it('on a crease pattern put on the other side’s colour, moves nothing: its frame stays, its marks in step', () => {
    const front = cpStep('step-n', { mode: 'crease-pattern', rotationDeg: 0 }, scenePicture('scene-front'));
    const frame = { centre: [0.4, 0.45] as PicturePoint, radius: 0.1 };
    const zoom = { from: 'area-gone', shape: 'circle' as const, frame, imprint: imprintOn(front, frame)! };
    const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'valley-line', from: [0.2, 0.3], to: [0.8, 0.3] };
    const document = insertSteps(createDiagram({ title: 'Pattern' }), [{ ...front, zoom, annotations: [mark], annotatedPictureKey: 'scene-front' }], 0);
    const source = { ...(front.source as DiagramCpSource), render: { mode: 'crease-pattern' as const, rotationDeg: 0, side: 'back' as const } };
    const back = step(setLinkedPicture(document, 'step-n', { source, picture: scenePicture('scene-back') }));
    expect(back.zoom!.frame!.centre[0]).toBeCloseTo(frame.centre[0], 9);
    expect(back.zoom!.frame!.centre[1]).toBeCloseTo(frame.centre[1], 9);
    expect(back.annotations).toEqual([mark]);
    expect(back.annotatedPictureKey).toBe('scene-back');
  });

  it('an upload turned or flipped, with no faces, carries its frame and its marks by the pose’s move, in step', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
    const asset = { id: 'asset-1', kind: 'svg' as const, svg, widthPx: 400, heightPx: 300, bytes: svg.length };
    const frame = { centre: [0.3, 0.4] as PicturePoint, size: [0.3, 0.2] as [number, number], angle: 20 };
    const upload: DiagramStep = {
      ...createStep(() => 'step-n'),
      source: { kind: 'upload', assetId: asset.id, rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId: asset.id, paperScale: null, key: `asset:${asset.id}` },
      zoom: { from: 'area-gone', shape: 'rounded', frame },
      annotations: [{ id: 'mark', kind: 'valley-line', from: [0.1, 0.2], to: [0.9, 0.6] }],
      annotatedPictureKey: `asset:${asset.id}`,
    };
    const document = { ...insertSteps(createDiagram({ title: 'Upload' }), [upload], 0), assets: { [asset.id]: asset } };
    for (const pose of [{ rotationQuarterTurns: 1 as const, mirrored: false }, { rotationQuarterTurns: 0 as const, mirrored: true }]) {
      const posed = step(setUploadPose(document, 'step-n', pose));
      const move = poseMove(400, 300, { rotationQuarterTurns: 0, mirrored: false }, pose);
      expect(distance(posed.zoom!.frame!.centre, move.point(frame.centre))).toBeLessThan(1e-12);
      expect(posed.zoom!.frame!.size).toEqual([expect.closeTo(0.3, 12), expect.closeTo(0.2, 12)]);
      expect(posed.annotatedPictureKey).toBe(posed.picture!.key);
      const [was, now] = [marksInPicture(upload), marksInPicture(posed)];
      for (const [id, points] of was) points.forEach((point, index) => expect(distance(move.point(point), now.get(id)![index]!), id).toBeLessThan(1e-9));
    }
  });

  it('a References step turned over, with no faces, mirrors its frame and its marks with the card', () => {
    const card = { ...referencesStep('step-n'), zoom: { from: 'area-gone', shape: 'circle' as const, frame: { centre: [0.3, 0.4] as PicturePoint, radius: 0.1 } } };
    const marks: KnownDiagramAnnotation[] = [{ id: 'mark', kind: 'valley-line', from: [0.1, 0.2], to: [0.9, 0.6] }];
    const document = insertSteps(createDiagram({ title: 'Card' }), [{ ...card, annotations: marks, annotatedPictureKey: card.picture!.key }], 0);
    const turned = step(setReferencesSide(document, 'step-n', true));
    expect(turned.zoom!.frame!.centre).toEqual([expect.closeTo(0.7, 12), expect.closeTo(0.4, 12)]);
    expect(turned.annotatedPictureKey).toBe(turned.picture!.key);
    // On the unit sheet, mirrored left to right.
    const [was, now] = [marksInPicture(step(document)).get('mark')!, marksInPicture(turned).get('mark')!];
    was.forEach(([x, y], index) => expect(distance(now[index]!, [1 - x, y])).toBeLessThan(1e-9));
  });
});

describe('a new step after an enlarged one, however it is made (16g)', () => {
  it('made with its picture, lands its frame at once; a run of them each from the one before; a turn passed', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const made = [{ ...craneStep('C.none'), id: 'step-a' }, createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'), { ...craneStep('S.none'), id: 'step-b' }];
    const { document, seeded } = seedNewSteps(insertSteps(enlarged, made, enlarged.steps.length), ['step-a', 'turn-1', 'step-b'], NO_ASSETS);
    expect(seeded.map((each) => [each.stepId, each.captured.placed, each.captured.anchor])).toEqual([
      ['step-a', 'face', 'auto'],
      ['step-b', 'face', 'auto'],
    ]);
    expect(frameProblems(document)).toEqual([]);
    // From step N's frame: its area's provenance, all the way through.
    expect(step(document, 'step-a').zoom!.from).toBe('area-head');
    expect(step(document, 'step-b').zoom!.from).toBe('area-head');
    // The same picture as N's: the same frame.
    expect(distance(step(document, 'step-a').zoom!.frame!.centre, step(enlarged).zoom!.frame!.centre)).toBeLessThan(1e-9);
  });

  it('leaves a step that is enlarged already — a duplicate — as it is, and one after a whole step whole', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const copy = { ...step(enlarged), id: 'step-copy', zoom: { ...step(enlarged).zoom!, scale: 2 } };
    const withCopy = insertSteps(enlarged, [copy], enlarged.steps.length);
    expect(seedNewSteps(withCopy, ['step-copy'], NO_ASSETS)).toEqual({ document: withCopy, seeded: [] });
    const plain = insertSteps(crane('none'), [{ ...craneStep('C.none'), id: 'step-whole' }], 1);
    expect(seedNewSteps(plain, ['step-whole'], NO_ASSETS)).toEqual({ document: plain, seeded: [] });
  });
});

describe('the area’s own step re-posed or refreshed (16g)', () => {
  it('carries the area with the paper at any angle, or leaves it out of step on a refresh (D8), and no enlarged step changes', () => {
    const document = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const s = document.steps[0] as DiagramStep;
    const area = s.annotations[0] as KnownDiagramAnnotation;
    const turned = turnedCapture(s, 37);
    const posed = setLinkedPicture(document, s.id, { source: turned.source as DiagramCpSource, picture: turned.picture });
    const carried = step(posed, s.id).annotations[0] as KnownDiagramAnnotation;
    const move = sceneTurnMove(storedScene(s.picture as never)!.bounds, storedScene(turned.picture as never)!.bounds, 37)!;
    expect(distance(carried.from, move.point(area.from))).toBeLessThan(1e-9);
    expect(step(posed, s.id).annotatedPictureKey).toBe(turned.picture!.key);
    expect(step(posed)).toBe(step(document));
    const source = { ...(s.source as DiagramCpSource), fingerprint: 'fp-refolded' };
    const refreshed = setLinkedPicture(document, s.id, { source, picture: craneStep('C.none').picture });
    expect(step(refreshed, s.id).annotations).toBe(s.annotations);
    expect(step(refreshed, s.id).annotatedPictureKey).toBe(s.picture!.key);
    expect(step(refreshed)).toBe(step(document));
  });
});

describe('an enlarged 3D or simulated step, with no faces (16g)', () => {
  it('keeps its frame in picture units when its camera moves, its marks unchanged and out of step', () => {
    const view = { mode: 'folded-3d' as const, camera: { yaw: 1, pitch: 0, zoom: 1 }, side: 'front' as const };
    const frame = { centre: [0.4, 0.5] as PicturePoint, radius: 0.12 };
    const threeD: DiagramStep = {
      ...cpStep('step-n', view, scenePicture('scene-3d')),
      zoom: { from: 'area-gone', shape: 'circle', frame },
      annotations: [{ id: 'mark', kind: 'valley-line', from: [0.2, 0.3], to: [0.8, 0.3] }],
      annotatedPictureKey: 'scene-3d',
    };
    const document = insertSteps(createDiagram({ title: '3D' }), [threeD], 0);
    for (const render of [{ ...view, camera: { yaw: 1.3, pitch: -0.2, zoom: 1 } }, { mode: 'simulated' as const, foldPercent: 60, view: { yaw: 0.8, pitch: -0.9, zoom: 1.4 } }]) {
      const source = { ...(threeD.source as DiagramCpSource), render };
      const moved = step(setLinkedPicture(document, 'step-n', { source, picture: scenePicture('scene-moved') }));
      expect(moved.zoom!.frame).toBe(frame);
      expect(moved.annotations).toBe(threeD.annotations);
      expect(moved.annotatedPictureKey).toBe('scene-3d');
    }
  });
});

describe('an enlarged step captured before its picture kept its faces (review of 16g)', () => {
  /** Step 22 with its area, and C after it captured before flat steps kept their faces, marked, then enlarged: its frame copied in picture units. */
  function copied(): DiagramDocument {
    const s = craneStep('S.none');
    const area = { ...s, annotations: [headArea(s, 'none')], annotatedPictureKey: s.picture!.key };
    const older = marked(craneStep('C.none', { faces: false }), 'step-n');
    const enlarged = enlargeStep(insertSteps(createDiagram({ title: 'Crane' }), [area, older], 0), 'step-n', NO_ASSETS);
    expect(enlarged.captured).toMatchObject({ placed: 'picture' });
    return enlarged.document;
  }
  const faced = (each: DiagramStep): DiagramStep => ({ ...each, picture: craneStep('C.none').picture });

  it('given its faces for the picture it shows, keeps its frame and its marks where they are, its imprint made from the frame', () => {
    const before = step(copied());
    const given = anchorInPlace(faced(before), NO_ASSETS);
    expect(given.zoom!.frame).toEqual(before.zoom!.frame);
    expect(given.zoom!.imprint).toEqual(imprintOn(given, before.zoom!.frame!));
    expect(given.annotations).toBe(before.annotations);
    expect(given.annotatedPictureKey).toBe(before.annotatedPictureKey);
    expect(marksMoved(before, given)).toEqual([]);
    expect(frameProblems({ ...copied(), steps: [given] })).toEqual([]);
    // A later turn carries the frame from where it shows, not from where the area's imprint would have put it.
    const turned = turnedCapture(given, 37);
    const posed = step(setLinkedPicture({ ...copied(), steps: [given] }, 'step-n', { source: turned.source as DiagramCpSource, picture: turned.picture }));
    const move = sceneTurnMove(storedScene(given.picture as never)!.bounds, storedScene(turned.picture as never)!.bounds, 37)!;
    expect(distance(posed.zoom!.frame!.centre, move.point(before.zoom!.frame!.centre))).toBeLessThan(1e-4);
    // Nothing to anchor: a frame with no imprint, or no faces given, is left as it is.
    const loose = { ...faced(before), zoom: { ...before.zoom!, imprint: undefined } };
    expect(anchorInPlace(loose, NO_ASSETS)).toBe(loose);
    expect(anchorInPlace(before, NO_ASSETS)).toBe(before);
  });

  it('refreshed by its own Refresh to the same picture with its faces, lands its frame, its marks out of step with the paper they now show', () => {
    const document = copied();
    const before = step(document);
    // The pattern changed elsewhere, so the app follows no move; the step's own fold draws as it did.
    const source = { ...(before.source as DiagramCpSource), fingerprint: 'fp-refolded' };
    const refreshed = step(setLinkedPicture(document, 'step-n', { source, picture: craneStep('C.none').picture }));
    expect(refreshed.picture!.key).toBe(before.picture!.key);
    expect(refreshed.zoom!.frame).not.toEqual(before.zoom!.frame);
    expect(frameProblems({ ...document, steps: [refreshed] })).toEqual([]);
    expect(refreshed.annotations).toBe(before.annotations);
    expect(refreshed.annotatedPictureKey).toBeNull();
  });
});
