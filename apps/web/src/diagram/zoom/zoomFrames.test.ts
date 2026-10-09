import { describe, expect, it } from 'vitest';
import { ANNOTATION_REACH, ZOOM_RADIUS, ZOOM_SIDE, type PicturePoint } from '../annotate/annotationModel';
import { poseMove, sceneTurnMove } from '../annotate/annotationCarry';
import {
  DEFAULT_SIMULATED_VIEW,
  createDiagram,
  createStep,
  createTurn,
  editStepAnnotations,
  insertSteps,
  setLinkedPicture,
  setReferencesSide,
  setUploadPose,
  stepById,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { readDiagram, storedSceneJson, writeDiagram } from '../document/diagramFile';
import { CAPTURE_PX_PER_UNIT } from '../capture/captureGeometry';
import { face as sceneFace, sceneOf } from '../../lib/paper/paperScene.fixtures';
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
  startsWhole,
  stepWindow,
  trimmedAtFrame,
  unenlargeStep,
  unitsMove,
  updateEnlargedSteps,
} from './zoomFrames';
import {
  anchorPoint,
  defaultAnchor,
  faceAt,
  facePlacement,
  offSpread,
  ontoSpread,
  paperFacesOf,
  toPicture,
  toScene,
  topDrawn,
  topUnspread,
  unspreadOn,
} from './zoomImprint';
import { ZOOM_LINE_OVERSHOOT, frameWindow, outlineAsShape, zoomOutlineOf } from './zoomModel';

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

  it('turned off and on again, carries marks drawn on another picture too, to the same place on this one, still out of step (review fix 5)', () => {
    // As the crane's steps 23 and 24 open: their marks out of step with the picture since it changed (D8).
    const drawnBefore = (document: DiagramDocument): DiagramDocument => ({
      ...document,
      steps: document.steps.map((entry) => (entry.id === 'step-n' ? { ...(entry as DiagramStep), annotatedPictureKey: 'scene-older' } : entry)),
    });
    const enlargedDoc = drawnBefore(enlargeStep(crane(), 'step-n', NO_ASSETS).document);
    const enlarged = step(enlargedDoc);
    // Off: in the whole picture's units, where the window showed them, not over the whole model.
    const offDoc = unenlargeStep(enlargedDoc, 'step-n', NO_ASSETS);
    const off = step(offDoc);
    expect(off.zoom).toBeUndefined();
    expect(off.annotations).not.toEqual(enlarged.annotations);
    expect(marksMoved(enlarged, off)).toEqual([]);
    expect(off.annotatedPictureKey).toBe('scene-older');
    // On again: into the window, where they were.
    const on = step(enlargeStep(offDoc, 'step-n', NO_ASSETS).document);
    expect(marksMoved(off, on)).toEqual([]);
    expect(marksMoved(enlarged, on)).toEqual([]);
    expect(on.annotatedPictureKey).toBe('scene-older');
    // The frame moved by hand: they stay on the same paper too.
    const frame = enlarged.zoom!.frame!;
    const moved = step(setFrameOutline(enlargedDoc, 'step-n', { ...frame, centre: [frame.centre[0] + 0.02, frame.centre[1]] }, NO_ASSETS));
    expect(marksMoved(enlarged, moved)).toEqual([]);
    expect(moved.annotatedPictureKey).toBe('scene-older');
    // Placed again by Update: the same paper again (review fix 4's known gap).
    const movedDoc = setFrameOutline(enlargedDoc, 'step-n', { ...frame, centre: [frame.centre[0] + 0.02, frame.centre[1]] }, NO_ASSETS);
    const updated = step(updateEnlargedSteps(movedDoc, 'area-head', NO_ASSETS).document);
    expect(updated.zoom!.frame).toEqual(enlarged.zoom!.frame);
    expect(marksMoved(enlarged, updated)).toEqual([]);
    expect(updated.annotatedPictureKey).toBe('scene-older');
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

describe('lines carried into the window from the whole picture (Zach, 2026-10-07)', () => {
  /** Step N whole, marked about where its frame lands: lines across it, out of it, inside it and past it; an arrow and a label. */
  function markedAboutFrame(): { document: DiagramDocument; frame: { centre: PicturePoint; radius: number } } {
    const document = crane('none');
    const { centre, radius } = step(enlargeStep(document, 'step-n', NO_ASSETS).document).zoom!.frame!;
    const [cx, cy] = centre;
    const r = radius!;
    const marks: KnownDiagramAnnotation[] = [
      { id: 'across', kind: 'valley-line', from: [cx, cy - 4 * r], to: [cx, cy + 6 * r] },
      { id: 'out', kind: 'mountain-line', from: [cx, cy], to: [cx + 5 * r, cy] },
      { id: 'hidden', kind: 'hidden-line', from: [cx - 3 * r, cy + 0.5 * r], to: [cx + 3 * r, cy + 0.5 * r] },
      { id: 'inside', kind: 'valley-line', from: [cx - 0.5 * r, cy], to: [cx + 0.5 * r, cy] },
      { id: 'past', kind: 'valley-line', from: [cx + 3 * r, cy - 3 * r], to: [cx + 3 * r, cy + 3 * r] },
      { id: 'arrow', kind: 'valley-arrow', from: [cx, cy - 4 * r], to: [cx, cy + 4 * r] },
      { id: 'label', kind: 'label', from: [cx, cy], to: [cx, cy], text: 'A' },
    ];
    const n = step(document);
    const marked = { ...n, annotations: marks, annotatedPictureKey: n.picture!.key };
    return { document: { ...document, steps: document.steps.map((entry) => (entry.id === 'step-n' ? marked : entry)) }, frame: { centre, radius: r } };
  }
  const mark = (each: DiagramStep, id: string) => each.annotations.find((m) => m.id === id) as KnownDiagramAnnotation;
  /** Whether a point lies on the segment `a`–`b`. */
  const onLine = (p: PicturePoint, [a, b]: PicturePoint[]) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    return t >= -1e-9 && t <= 1 + 1e-9 && distance(p, [a[0] + t * dx, a[1] + t * dy]) < 1e-9;
  };

  it('Enlarged turned on trims a line across the frame to end just past its rim, on the same line; the rest as they were', () => {
    const { document } = markedAboutFrame();
    const before = step(document);
    const after = step(enlargeStep(document, 'step-n', NO_ASSETS).document);
    // In the window's units the frame is the window's own circle: centre (0.5, 0.5), radius 0.5.
    const rimPast = 0.5 + ZOOM_LINE_OVERSHOOT;
    const across = mark(after, 'across');
    expect(distance(across.from, [0.5, 0.5])).toBeCloseTo(rimPast, 9);
    expect(distance(across.to, [0.5, 0.5])).toBeCloseTo(rimPast, 9);
    const out = mark(after, 'out');
    expect(out.from).toEqual([expect.closeTo(0.5, 9), expect.closeTo(0.5, 9)]);
    expect(distance(out.to, [0.5, 0.5])).toBeCloseTo(rimPast, 9);
    // The hidden line crosses off the centre: each end the overshoot past where it leaves the rim.
    const hidden = mark(after, 'hidden');
    const chordHalf = Math.sqrt(0.5 ** 2 - 0.25 ** 2);
    expect(Math.abs(hidden.from[0] - 0.5)).toBeCloseTo(chordHalf + ZOOM_LINE_OVERSHOOT, 9);
    expect(Math.abs(hidden.to[0] - 0.5)).toBeCloseTo(chordHalf + ZOOM_LINE_OVERSHOOT, 9);
    // On the paper they were on: each trimmed end on the line it was, in picture units.
    const [was, now] = [marksInPicture(before), marksInPicture(after)];
    for (const id of ['across', 'out', 'hidden']) for (const point of now.get(id)!) expect(onLine(point, was.get(id)!), id).toBe(true);
    // Inside the frame, outside it, an arrow and a label: carried as ever, still in step.
    expect(marksMoved(before, after).sort()).toEqual(['across', 'hidden', 'out']);
    expect(after.annotatedPictureKey).toBe(after.picture!.key);
    // Turned off, the trimmed lines stay trimmed, on their paper; the rest come back exactly.
    const off = step(unenlargeStep(enlargeStep(document, 'step-n', NO_ASSETS).document, 'step-n', NO_ASSETS));
    expect(marksMoved(before, off).sort()).toEqual(['across', 'hidden', 'out']);
    for (const point of marksInPicture(off).get('across')!) expect(onLine(point, was.get('across')!)).toBe(true);
  });

  it('a step made after an enlarged one with marks on its picture: the seed trims its lines too', () => {
    const { document } = markedAboutFrame();
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const made = { ...step(document), id: 'step-made' };
    const seeded = step(seedNewSteps(insertSteps(enlarged, [made], enlarged.steps.length), ['step-made'], NO_ASSETS).document, 'step-made');
    expect(seeded.zoom).toBeDefined();
    expect(distance(mark(seeded, 'across').from, [0.5, 0.5])).toBeCloseTo(0.5 + ZOOM_LINE_OVERSHOOT, 6);
    expect(mark(seeded, 'arrow')).not.toEqual(mark(step(document), 'arrow'));
    expect(distance(mark(seeded, 'arrow').from, [0.5, 0.5])).toBeGreaterThan(1);
  });

  it('never lengthens a line, nor moves one that ends within the overshoot of the rim', () => {
    const frame = { centre: [0.5, 0.5] as PicturePoint, radius: 0.5 };
    const near: KnownDiagramAnnotation = { id: 'near', kind: 'valley-line', from: [0.5, 0.5], to: [0.5, 1.02] };
    expect(trimmedAtFrame(near, frame)).toBe(near);
    const far: KnownDiagramAnnotation = { ...near, to: [0.5, 1.3] };
    expect(trimmedAtFrame(far, frame).to).toEqual([0.5, expect.closeTo(1 + ZOOM_LINE_OVERSHOOT, 9)]);
    const arrow: KnownDiagramAnnotation = { id: 'arrow', kind: 'push-arrow', from: [0.5, -1], to: [0.5, 2] };
    expect(trimmedAtFrame(arrow, frame)).toBe(arrow);
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

  it('a References step turned over, with no faces, mirrors its frame and its marks with the card, its folds named from the back', () => {
    const card = { ...referencesStep('step-n'), zoom: { from: 'area-gone', shape: 'circle' as const, frame: { centre: [0.3, 0.4] as PicturePoint, radius: 0.1 } } };
    const marks: KnownDiagramAnnotation[] = [
      { id: 'mark', kind: 'valley-line', from: [0.1, 0.2], to: [0.9, 0.6] },
      { id: 'arrow', kind: 'mountain-arrow', from: [0.25, 0.35], to: [0.35, 0.45] },
    ];
    const document = insertSteps(createDiagram({ title: 'Card' }), [{ ...card, annotations: marks, annotatedPictureKey: card.picture!.key }], 0);
    const turned = step(setReferencesSide(document, 'step-n', true));
    expect(turned.zoom!.frame!.centre).toEqual([expect.closeTo(0.7, 12), expect.closeTo(0.4, 12)]);
    expect(turned.annotatedPictureKey).toBe(turned.picture!.key);
    // On the unit sheet, mirrored left to right.
    const [was, now] = [marksInPicture(step(document)).get('mark')!, marksInPicture(turned).get('mark')!];
    was.forEach(([x, y], index) => expect(distance(now[index]!, [1 - x, y])).toBeLessThan(1e-9));
    // Kept in the window's units, each fold is named from the other side as on a whole step (RM7: 17c).
    expect((turned.annotations as KnownDiagramAnnotation[]).map((mark) => mark.kind)).toEqual(['mountain-line', 'valley-arrow']);
    const back = step(setReferencesSide({ ...document, steps: [turned] }, 'step-n', false));
    expect((back.annotations as KnownDiagramAnnotation[]).map((mark) => mark.kind)).toEqual(['valley-line', 'mountain-arrow']);
  });

  it('enlarged and turned whole again, names nothing: a change of units is the same side', () => {
    const card = { ...referencesStep('step-n'), zoom: { from: 'area-gone', shape: 'circle' as const, frame: { centre: [0.3, 0.4] as PicturePoint, radius: 0.1 } } };
    const marks: KnownDiagramAnnotation[] = [{ id: 'mark', kind: 'valley-line', from: [0.1, 0.2], to: [0.9, 0.6] }];
    const document = insertSteps(createDiagram({ title: 'Card' }), [{ ...card, annotations: marks, annotatedPictureKey: card.picture!.key }], 0);
    const whole = step(unenlargeStep(document, 'step-n', NO_ASSETS));
    expect(whole.zoom).toBeUndefined();
    expect((whole.annotations as KnownDiagramAnnotation[]).map((mark) => mark.kind)).toEqual(['valley-line']);
  });
});

describe('a new step after an enlarged one, however it is made (16g)', () => {
  it('made with its picture, lands its frame at once; a run of them each from the run’s source; a turn passed', () => {
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

  it('a run of empty steps: each passes on the imprint it was seeded with, for its first picture to land (16h)', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const made = ['step-e1', 'step-e2'].map((id) => ({ ...createStep(() => id), id }));
    const { document, seeded } = seedNewSteps(insertSteps(enlarged, made, enlarged.steps.length), ['step-e1', 'step-e2'], NO_ASSETS);
    expect(seeded.map((each) => [each.stepId, each.captured.placed])).toEqual([
      ['step-e1', null],
      ['step-e2', null],
    ]);
    const source = imprintOn(step(enlarged), step(enlarged).zoom!.frame!);
    for (const each of made) {
      expect(step(document, each.id).zoom!.imprint, each.id).toEqual(source);
      expect(step(document, each.id).zoom!.frame).toEqual(step(enlarged).zoom!.frame);
    }
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

describe('a seeded step’s first picture (review fix 3)', () => {
  /** Step N, the crane folded, enlarged; then an empty step seeded after it, as Insert Step After makes one. */
  function seededAfter(n: DiagramStep = step(crane('none'))): DiagramDocument {
    const s = craneStep('S.none');
    const area = { ...s, annotations: [headArea(s, 'none')], annotatedPictureKey: s.picture!.key };
    const enlarged = enlargeStep(insertSteps(createDiagram({ title: 'Crane' }), [area, n], 0), n.id, NO_ASSETS).document;
    const empty = { ...createStep(() => 'step-new'), id: 'step-new' };
    return seedNewSteps(insertSteps(enlarged, [empty], enlarged.steps.length), ['step-new'], NO_ASSETS).document;
  }
  /** The crane linked to the seeded step (or another), shown as `render` says. */
  function linkedAs(document: DiagramDocument, render?: DiagramCpRender, stepId = 'step-new'): DiagramDocument {
    const crane = craneStep('C.none');
    const source = crane.source as DiagramCpSource;
    return setLinkedPicture(document, stepId, { source: { ...source, render: render ?? source.render }, picture: crane.picture });
  }
  /** A diagram with the steps `edits` names changed so. */
  const edited = (document: DiagramDocument, edits: Record<string, (step: DiagramStep) => DiagramStep>): DiagramDocument => ({
    ...document,
    steps: document.steps.map((entry) => (edits[entry.id] ? edits[entry.id]!(entry as DiagramStep) : entry)),
  });
  /** A linked step shown as its crease pattern, its picture as it was: all a run's picture type reads. */
  const asPattern = (each: DiagramStep): DiagramStep => ({
    ...each,
    source: { ...(each.source as DiagramCpSource), render: { mode: 'crease-pattern', rotationDeg: 0 } },
  });
  const unlinked = (each: DiagramStep): DiagramStep => ({ ...each, source: null, picture: null });

  it('shown as its run shows its pattern, keeps the frame it was seeded with and lands it', () => {
    const before = seededAfter();
    expect(step(before, 'step-new').zoom).toBeDefined();
    const landed = landSeededFrame(before, linkedAs(before), 'step-new');
    expect(landed.placed).toBe('face');
    expect(landed.enlargedWith).toBe(step(before, 'step-new').zoom);
    expect(step(landed.document, 'step-new').zoom?.frame).toBeDefined();
    expect(frameProblems(landed.document)).toEqual([]);
  });

  it('shown another way, starts whole in the same edit, and places nothing', () => {
    const before = seededAfter();
    const ways: DiagramCpRender[] = [
      { mode: 'crease-pattern', rotationDeg: 0 },
      { mode: 'simulated', foldPercent: 0, view: DEFAULT_SIMULATED_VIEW },
    ];
    for (const render of ways) {
      const after = linkedAs(before, render);
      const landed = landSeededFrame(before, after, 'step-new');
      expect(landed.placed, render.mode).toBeNull();
      expect(landed.enlargedWith).toBeUndefined();
      expect(step(landed.document, 'step-new').zoom, render.mode).toBeUndefined();
      expect(step(landed.document, 'step-new').picture).toBe(step(after, 'step-new').picture);
    }
  });

  const upload: DiagramStep = {
    ...step(crane('none')),
    source: { kind: 'upload', assetId: 'asset-u', rotationQuarterTurns: 0, mirrored: false },
    picture: { kind: 'asset', assetId: 'asset-u', paperScale: null, key: 'asset:asset-u' },
  };

  it('is not seeded after an enlarged upload or References step, whose run no first picture continues', () => {
    for (const n of [upload, referencesStep('step-n')]) {
      const before = seededAfter(n);
      expect(step(before).zoom, n.source!.kind).toBeDefined();
      expect(step(before, 'step-new').zoom, n.source!.kind).toBeUndefined();
    }
  });

  it('enlarged after an upload’s run all the same — by hand, or in a file — starts whole however it is shown', () => {
    const before = enlargeStep(seededAfter(upload), 'step-new', NO_ASSETS).document;
    expect(step(before, 'step-new').zoom).toBeDefined();
    expect(step(landSeededFrame(before, linkedAs(before), 'step-new').document, 'step-new').zoom).toBeUndefined();
  });

  it('starting a run — enlarged from an area, its picture since removed — keeps its frame however the area’s step is shown', () => {
    // Step S shown as its crease pattern; N, enlarged from S's area while folded, its picture removed, linked folded again.
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const before = edited(enlarged, { 'step-S.none': asPattern, 'step-n': unlinked });
    const landed = landSeededFrame(before, linkedAs(before, undefined, 'step-n'), 'step-n');
    expect(landed.placed).toBe('face');
    expect(landed.enlargedWith).toBe(step(before).zoom);
    expect(step(landed.document).zoom?.frame).toBeDefined();
  });

  it('linked already, given its first picture by a Refresh or Pose — a file’s linked step with no picture yet — keeps its frame', () => {
    // The run shown as its crease pattern; the step after it linked folded, not captured yet.
    const seeded = seededAfter();
    const before = edited(seeded, { 'step-n': asPattern, 'step-new': (each) => ({ ...each, source: craneStep('C.none').source }) });
    const landed = landSeededFrame(before, linkedAs(before), 'step-new');
    expect(landed.placed).toBe('face');
    expect(step(landed.document, 'step-new').zoom?.frame).toBeDefined();
  });

  it('keeps the frame of a step that had a picture, whatever way it is shown now (Show as)', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const n = step(enlarged);
    const shown = setLinkedPicture(enlarged, 'step-n', {
      source: { ...(n.source as DiagramCpSource), render: { mode: 'crease-pattern', rotationDeg: 0 } },
      picture: n.picture,
    });
    expect(landSeededFrame(enlarged, shown, 'step-n')).toEqual({ document: shown, placed: null });
    expect(step(shown).zoom).toBeDefined();
  });

  it('starts whole an empty step given an upload or a card, its marks from a picture since removed carried to the whole picture', () => {
    const enlarged = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const was = { ...step(enlarged), source: null, picture: null };
    const whole = startsWhole(was, step(enlarged), NO_ASSETS);
    expect(whole.zoom).toBeUndefined();
    expect(whole).toEqual(step(unenlargeStep(enlarged, 'step-n', NO_ASSETS)));
    // A step that had a picture, or has no frame: as it is.
    expect(startsWhole(step(enlarged), step(enlarged), NO_ASSETS)).toBe(step(enlarged));
    expect(startsWhole(was, whole, NO_ASSETS)).toBe(whole);
  });
});

describe('a folded enlarged step shown as its crease pattern (Z8 amended, Zach, 2026-10-07)', () => {
  /** The crane's sheet as Show as Crease Pattern draws it, unturned: the paper its faces fold, at the capture's scale. */
  function sheetOf(folded: DiagramStep): DiagramStep {
    const corners = paperFacesOf(folded)!.paper.flat();
    const [xs, ys] = [corners.map(([x]) => x), corners.map(([, y]) => y)];
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const ring = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].map(([x, y]) => [x! * CAPTURE_PX_PER_UNIT, y! * CAPTURE_PX_PER_UNIT] as [number, number]);
    const scene = sceneOf([sceneFace([ring])], (maxX - minX) * CAPTURE_PX_PER_UNIT);
    const render: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 };
    return {
      ...folded,
      source: { ...(folded.source as DiagramCpSource), render },
      picture: { kind: 'scene', sceneJson: storedSceneJson(scene)!, paperScale: CAPTURE_PX_PER_UNIT, styleKey: null, key: 'scene-sheet' },
    };
  }
  const linked = (each: DiagramStep) => ({ source: each.source as DiagramCpSource, picture: each.picture });
  /** The paper under a frame's centre: through the face on top there. */
  const paperUnder = (each: DiagramStep) => {
    const faces = paperFacesOf(each)!;
    const unspread = offSpread(faces, toScene(faces, each.zoom!.frame!).centre);
    return facePlacement(faces, topUnspread(faces, unspread)!)!.invert(unspread);
  };

  it('lands the frame on the paper its window showed, not at its anchor face’s, and folded again comes back', () => {
    const document = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const folded = step(document);
    const sheet = sheetOf(folded);
    const shown = setLinkedPicture(document, 'step-n', linked(sheet));
    const flat = step(shown);
    expect(frameProblems(shown)).toEqual([]);
    // On the sheet, the frame's centre is the paper the folded window showed at its centre.
    expect(distance(paperUnder(flat), paperUnder(folded))).toBeLessThan(1e-6);
    // At its size there, but for the fit of the face's placement (a few parts in 1e5).
    const [onSheet, onFold] = [toScene(paperFacesOf(flat)!, flat.zoom!.frame!).radius!, toScene(paperFacesOf(folded)!, folded.zoom!.frame!).radius!];
    expect(Math.abs(onSheet / onFold - 1)).toBeLessThan(1e-4);
    // Where the anchor face would have put it: far off, on the paper under the head.
    const anchored = relandFrame({ ...folded, ...linked(sheet) });
    expect(distance(paperUnder(anchored), paperUnder(folded))).toBeGreaterThan(20);
    // Folded again: the frame where it was, anchored again by the default rule, its imprint as before.
    const back = step(setLinkedPicture(shown, 'step-n', linked(folded)));
    expect(distance(back.zoom!.frame!.centre, folded.zoom!.frame!.centre)).toBeLessThan(1e-9);
    expect(back.zoom!.frame!.radius).toBeCloseTo(folded.zoom!.frame!.radius!, 9);
    expect(back.zoom!.imprint).toEqual(imprintOn(back, back.zoom!.frame!));
    expect(frameProblems(setLinkedPicture(shown, 'step-n', linked(folded)))).toEqual([]);
  });

  it('a picked anchor lands by its pick, as ever', () => {
    const document = enlargeStep(crane('none'), 'step-n', NO_ASSETS).document;
    const folded = step(document);
    const picked = { ...folded, zoom: { ...folded.zoom!, imprint: { ...folded.zoom!.imprint!, picked: true as const } } };
    const withPick = { ...document, steps: document.steps.map((entry) => (entry.id === 'step-n' ? picked : entry)) };
    const sheet = sheetOf(folded);
    expect(step(setLinkedPicture(withPick, 'step-n', linked(sheet))).zoom!.frame).toEqual(relandFrame({ ...picked, ...linked(sheet) }).zoom!.frame);
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
    // The enlarged step's frame, imprint and marks are as they were: only its record of the area goes with
    // the area, so a carry says nothing is out of date (review fix 4).
    const { areaWas, ...frame } = step(posed).zoom!;
    const { areaWas: _was, ...before } = step(document).zoom!;
    expect(frame).toEqual(before);
    expect(step(posed).annotations).toBe(step(document).annotations);
    expect(areaWas!.outline).toEqual(zoomOutlineOf(carried));
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
