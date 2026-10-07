/**
 * Keeping enlarged steps' frames and marks consistent (Revision 2, "Keeping
 * frames and marks consistent"): one pure function per row of the plan's
 * table, each a whole edit of the diagram the store records as one undo step.
 *
 * An enlarged step's marks are in its window's units — the window is its
 * frame's upright box, its longer side one unit, as a picture's frame is — so
 * whatever moves the window moves them with it, and they stay on the same
 * paper. A frame belongs to its step: nothing another step does changes it,
 * and only Enlarged turned on and Update Enlarged Steps take one from
 * another step (`zoomCapture.ts`).
 *
 * | What changed | Frame | Marks |
 * | --- | --- | --- |
 * | Enlarged turned on; Update | captured and landed ({@link enlargeStep}, {@link updateEnlargedSteps}) | whole picture or old window → new window; from the whole picture, lines trimmed at the frame ({@link trimmedAtFrame}) |
 * | A step made after an enlarged one | captured at creation ({@link seedNewSteps}) | none yet |
 * | A seeded step's first picture; a refresh or relink | landed from its imprint ({@link relandFrame}) | unchanged |
 * | A folded step shown as its crease pattern, and back | on the paper its window showed, imprinted there ({@link landedOnSheet}); back, anchored again ({@link anchoredOffSheet}) | unchanged |
 * | Enlarged turned off | dropped ({@link unenlargeStep}) | window → whole picture |
 * | Moved, resized or reshaped by hand | as set, its imprint made again ({@link setFrameOutline}) | by the window's move |
 * | Its anchor picked or reset | unchanged, its imprint made again ({@link setFrameAnchor}) | unchanged |
 * | The step re-posed | landed on the re-posed picture ({@link reposeFrame}) | the pose's move, window to window |
 * | Its picture given its faces, as it was (another step's capture) | unchanged, its imprint made again ({@link anchorInPlace}) | unchanged |
 * | The area or its step edited, moved or deleted | unchanged | unchanged |
 *
 * Every edit of a step's own picture — a re-pose, a refresh, a relink —
 * reaches the frame through one path, `withCarriedAnnotations`, which hands an
 * enlarged step to {@link followOwnPicture}.
 *
 * Pure: no store.
 */
import {
  LINE_KINDS,
  PICTURE_REACH,
  ZOOM_RADIUS,
  ZOOM_SIDE,
  carryAnnotation,
  withAnnotationReach,
  type AnnotationReach,
  type PictureMove,
  type PicturePoint,
} from '../annotate/annotationModel';
import {
  isKnownAnnotation,
  isLockedStep,
  isTurn,
  stepIndex,
  type DiagramAsset,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepZoom,
  type DiagramZoomEdge,
  type DiagramZoomOutline,
  type DiagramZoomShape,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import {
  anchorOf,
  areaSource,
  capture,
  heldFrame,
  imprintOn,
  placeOn,
  seedSource,
  stepsFrom,
  type ZoomCaptured,
  type ZoomImprint,
  type ZoomSource,
} from './zoomCapture';
import { faceAt, imprintFrame, offSpread, ontoSpread, paperFacesOf, toPicture, toScene, topUnspread } from './zoomImprint';
import {
  ZOOM_LINE_OVERSHOOT,
  ZOOM_SCALE,
  frameWindow,
  outlineAsShape,
  stepReach,
  stretchInside,
  zoomShapeOf,
  type PictureBox,
} from './zoomModel';

type Assets = Readonly<Record<string, DiagramAsset>>;

/** A step's window: its frame's upright box, in picture units; null when it shows its whole picture. */
export function stepWindow(step: DiagramStep): PictureBox | null {
  return step.zoom?.frame && step.picture ? frameWindow(step.zoom.frame) : null;
}

/** The whole picture as a box in its own units: its frame. */
function wholeBox(step: DiagramStep, assets: Assets): PictureBox | null {
  const frame = stepPictureFrame(step, assets);
  return frame ? { x: 0, y: 0, width: frame.width, height: frame.height } : null;
}

/** A box's longer side: one of its units. */
function unitOf(box: PictureBox): number {
  return Math.max(box.width, box.height);
}

/** A point in a box's units, in picture units. */
export function fromBox(box: PictureBox, [u, v]: PicturePoint): PicturePoint {
  const unit = unitOf(box);
  return [box.x + u * unit, box.y + v * unit];
}

/** A point in picture units, in a box's units. */
export function intoBox(box: PictureBox, [x, y]: PicturePoint): PicturePoint {
  const unit = unitOf(box);
  return [(x - box.x) / unit, (y - box.y) / unit];
}

/** An outline in picture units, in a box's units: an enlarged step's frame as its canvas, its window's, draws it. */
export function outlineIntoBox(box: PictureBox, outline: DiagramZoomOutline): DiagramZoomOutline {
  return outlineBetween(outline, intoBox(box, outline.centre), 1 / unitOf(box));
}

/** An outline in a box's units, in picture units: a frame dragged on its canvas, as its step stores it. */
export function outlineFromBox(box: PictureBox, outline: DiagramZoomOutline): DiagramZoomOutline {
  return outlineBetween(outline, fromBox(box, outline.centre), unitOf(box));
}

function outlineBetween(outline: DiagramZoomOutline, centre: PicturePoint, by: number): DiagramZoomOutline {
  return {
    centre,
    ...(outline.radius !== undefined ? { radius: outline.radius * by } : {}),
    ...(outline.size !== undefined ? { size: [outline.size[0] * by, outline.size[1] * by] as [number, number] } : {}),
    ...(outline.angle ? { angle: outline.angle } : {}),
  };
}

/**
 * Marks moved from one set of units to another — a window, or the whole
 * picture — on one picture, or through `move` from one picture to the next: a
 * scale and a shift, with the move's turn and mirror between.
 */
export function unitsMove(from: PictureBox, to: PictureBox, move?: PictureMove): PictureMove {
  const [fromUnit, toUnit] = [unitOf(from), unitOf(to)];
  const through = (point: PicturePoint) => (move ? move.point(point) : point);
  return {
    point: (point) => intoBox(to, through(fromBox(from, point))),
    mirrors: move?.mirrors ?? false,
    turnDeg: move?.turnDeg ?? 0,
    ...(move?.quarterTurns !== undefined ? { quarterTurns: move.quarterTurns } : {}),
    ...(move?.vector
      ? {
          vector: ([x, y]: PicturePoint): PicturePoint => {
            const [vx, vy] = move.vector!([x * fromUnit, y * fromUnit]);
            return [vx / toUnit, vy / toUnit];
          },
        }
      : {}),
    ...(move?.corner
      ? {
          corner: (corner: PicturePoint, inside: PicturePoint) => {
            const at = move.corner!(fromBox(from, corner), fromBox(from, inside));
            return at && intoBox(to, at);
          },
        }
      : {}),
  };
}

/**
 * A step's marks carried by `move`, when they are in step with the picture
 * they were drawn on — `was`, the step before the move — and all read; then
 * in step with the step's picture now. Ones drawn on another picture stay as
 * they were. A step with a mark this build cannot read keeps them all, out of
 * step: the move would leave that one behind. Each mark is kept within
 * `reach`, the reach of the units it goes to: an enlarged step's window's
 * reaches as far as its whole picture's, so a mark across the model from a
 * small frame goes there and back exactly. One the move cannot take where it
 * goes even so — which `back`, the move undone, shows — keeps them all where
 * they were, out of step, rather than be held at reach's edge. Carried, each
 * is then `finished`, where it went.
 */
function carryMarks(
  step: DiagramStep,
  move: PictureMove | null,
  {
    was = step,
    reach = PICTURE_REACH,
    back,
    finish,
  }: {
    was?: DiagramStep;
    reach?: AnnotationReach;
    back?: { move: PictureMove; reach: AnnotationReach };
    finish?: (mark: KnownDiagramAnnotation) => KnownDiagramAnnotation;
  } = {}
): DiagramStep {
  if (!move || step.annotations.length === 0) return step;
  if (!step.annotations.every(isKnownAnnotation)) return { ...step, annotatedPictureKey: null };
  if (!was.picture || was.annotatedPictureKey !== was.picture.key) return step;
  const marks = step.annotations as KnownDiagramAnnotation[];
  const carried = withAnnotationReach(reach, () => marks.map((mark) => carryAnnotation(mark, move)));
  const lost =
    back !== undefined &&
    withAnnotationReach(back.reach, () =>
      carried.some((mark, index) => !sameMark(carryAnnotation(mark, back.move), marks[index]!))
    );
  if (lost) return { ...step, annotatedPictureKey: null };
  return { ...step, annotations: finish ? carried.map(finish) : carried, annotatedPictureKey: step.picture?.key ?? null };
}

/**
 * A line carried into an enlarged step's window from its whole picture (Zach,
 * 2026-10-07): one crossing the frame — `frame` in the window's units —
 * trimmed along itself to end {@link ZOOM_LINE_OVERSHOOT} past the rim at
 * each end that lay farther out, as a fold line ends just past the paper's
 * edge, and never made longer. Magnified, it would otherwise run on across
 * the page. A line wholly inside the frame or wholly outside it, and every
 * other mark, as it was: one outside keeps its "Outside the enlarged frame"
 * badge. Stored, so every surface draws the trimmed line, and dragged longer
 * by hand as any line is.
 */
export function trimmedAtFrame(mark: KnownDiagramAnnotation, frame: DiagramZoomOutline): KnownDiagramAnnotation {
  if (!LINE_KINDS.has(mark.kind)) return mark;
  const { from, to } = mark;
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const inside = length > 0 ? stretchInside(frame, from, to) : null;
  if (!inside) return mark;
  const run = ZOOM_LINE_OVERSHOOT / length;
  const [start, end] = [Math.max(0, inside[0] - run), Math.min(1, inside[1] + run)];
  if (start === 0 && end === 1) return mark;
  const at = (t: number): PicturePoint => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  return { ...mark, from: start === 0 ? from : at(start), to: end === 1 ? to : at(end) };
}

/** Whether two marks are one, but for float noise in their numbers. */
function sameMark(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameMark(value, b[index]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const [ka, kb] = [Object.keys(a), Object.keys(b)];
    return (
      ka.length === kb.length &&
      ka.every((key) => sameMark((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
    );
  }
  return a === b;
}

/** A set of units a step's marks are in — its window, or its whole picture — and how far they may reach there. */
interface MarkUnits {
  box: PictureBox;
  reach: AnnotationReach;
}

/** The marks' units: the window, or the whole picture. */
function marksUnits(step: DiagramStep, assets: Assets): MarkUnits | null {
  const window = stepWindow(step);
  if (window) return { box: window, reach: stepReach(step) };
  const whole = wholeBox(step, assets);
  return whole && { box: whole, reach: PICTURE_REACH };
}

/**
 * A step's marks moved from one set of units to another, when both are known,
 * and each can go there and back; each then `finished` where it went.
 */
function carryBetween(
  step: DiagramStep,
  from: MarkUnits | null,
  to: MarkUnits | null,
  finish?: (mark: KnownDiagramAnnotation) => KnownDiagramAnnotation
): DiagramStep {
  if (!from || !to) return step;
  return carryMarks(step, unitsMove(from.box, to.box), {
    reach: to.reach,
    back: { move: unitsMove(to.box, from.box), reach: from.reach },
    ...(finish ? { finish } : {}),
  });
}

/** `edit` applied to one step, when it is one and not locked. */
function withStep(
  document: DiagramDocument,
  stepId: string,
  edit: (step: DiagramStep) => DiagramStep
): DiagramDocument {
  const index = stepIndex(document, stepId);
  const entry = document.steps[index];
  if (!entry || isTurn(entry) || isLockedStep(entry)) return document;
  const next = edit(entry);
  if (next === entry) return document;
  const steps = document.steps.slice();
  steps[index] = next;
  return { ...document, steps };
}

/**
 * A step with `zoom` as its frame — or none — and its marks carried from the
 * units they were in to the new ones: from its whole picture into a window,
 * its lines trimmed at the frame ({@link trimmedAtFrame}).
 */
function withZoom(step: DiagramStep, zoom: DiagramStepZoom | undefined, assets: Assets): DiagramStep {
  const before = marksUnits(step, assets);
  const { zoom: _was, ...rest } = step;
  const next: DiagramStep = zoom ? { ...rest, zoom } : rest;
  const window = stepWindow(next);
  const frame = !stepWindow(step) && window && next.zoom?.frame ? outlineIntoBox(window, next.zoom.frame) : null;
  return carryBetween(next, before, marksUnits(next, assets), frame ? (mark) => trimmedAtFrame(mark, frame) : undefined);
}

/**
 * Enlarged turned on (Z2): the step captures a frame from the nearest
 * earlier step with an area or a frame, and its marks go from its whole
 * picture — or its old window — into the new one. A step is enlarged or holds
 * areas, not both: its own areas go in the same edit. The diagram as it was,
 * and no capture, when there is nothing to capture from.
 */
export function enlargeStep(
  document: DiagramDocument,
  stepId: string,
  assets: Assets
): { document: DiagramDocument; captured: ZoomCaptured | null } {
  return enlargeWith(document, stepId, capture(document, stepId), assets);
}

/** A step given a capture's frame, its own areas removed and its marks carried into the new window. */
function enlargeWith(
  document: DiagramDocument,
  stepId: string,
  captured: ZoomCaptured | null,
  assets: Assets
): { document: DiagramDocument; captured: ZoomCaptured | null } {
  if (!captured) return { document, captured: null };
  const next = withStep(document, stepId, (step) => {
    const withoutAreas = step.annotations.filter((mark) => !isKnownAnnotation(mark) || mark.kind !== 'zoom');
    const kept = withoutAreas.length === step.annotations.length ? step : { ...step, annotations: withoutAreas };
    return withZoom(kept, captured.zoom, assets);
  });
  return { document: next, captured };
}

/** Enlarged turned off: the frame dropped, the marks carried from the window to the whole picture. */
export function unenlargeStep(document: DiagramDocument, stepId: string, assets: Assets): DiagramDocument {
  return withStep(document, stepId, (step) => (step.zoom ? withZoom(step, undefined, assets) : step));
}

/**
 * Update Enlarged Steps (Z7): every step with this area's provenance,
 * wherever it sits now — before the area's step too, or after another area —
 * captured again from the area itself, as it is now, over any hand move, as
 * one edit; so each keeps its provenance. Nothing when the area is gone. The
 * captures, in order, and the steps they placed, for what counts them.
 */
export function updateEnlargedSteps(
  document: DiagramDocument,
  areaId: string,
  assets: Assets
): { document: DiagramDocument; captured: ZoomCaptured[]; stepIds: string[] } {
  const source = areaSource(document, areaId);
  if (!source) return { document, captured: [], stepIds: [] };
  let next = document;
  const captured: ZoomCaptured[] = [];
  const stepIds: string[] = [];
  for (const stepId of stepsFrom(document, areaId)) {
    // Only the steps it enlarged change, so the area's step, and the area, stay as they were.
    const step = enlargeWith(next, stepId, capture(next, stepId, source), assets);
    next = step.document;
    if (step.captured) {
      captured.push(step.captured);
      stepIds.push(stepId);
    }
  }
  return { document: next, captured, stepIds };
}

/**
 * An enlarged step's frame placed again on its own picture — its first, for a
 * seeded step, or a new one after a Refresh or a relink — from its stored
 * imprint: through the face that holds its paper point, then onto its spread.
 * Where it cannot be — no faces, or the point off this paper — a frame it has
 * stays where it was in picture units. Its marks, in the window's units, go
 * with the frame. The step itself when nothing changes.
 */
export function relandFrame(step: DiagramStep): DiagramStep {
  const { zoom } = step;
  if (!zoom || !step.picture) return step;
  const { frame } = placeOn(step, zoom.imprint, zoom.frame);
  if (!frame || sameOutline(frame, zoom.frame)) return step;
  return { ...step, zoom: { ...zoom, frame } };
}

/**
 * An enlarged step whose own picture was just given its faces — the same
 * picture, folded again for them (`withPaperFaces`), most often while another
 * step is enlarged from it or Updated — left as it shows: a step does not
 * change because of another step (D8). Its frame, copied in picture units
 * while it had no faces, stays where it is, and its imprint is made again
 * from it on the faces, as a capture from it makes one (`imprintOn`), a
 * picked anchor kept: the frame is then its imprint landed, and a later
 * re-pose carries it from where it shows. A centre in a strip the spread
 * opened settles on the layer above, as a frame set there by hand does
 * ({@link setFrameOutline}), its marks staying on their paper. A frame its
 * paper cannot anchor keeps no imprint: a copy in picture units, which the
 * Step pane says to anchor (`stepZoomStatus`). The step itself when it is
 * not enlarged, has no faces, or its frame no imprint to make again.
 */
export function anchorInPlace(step: DiagramStep, assets: Assets): DiagramStep {
  const { zoom } = step;
  if (!zoom?.frame || !zoom.imprint || !step.picture || !paperFacesOf(step)) return step;
  const { imprint: was, ...rest } = zoom;
  const imprint = imprintOn(step, zoom.frame, was.picked ? was.on : undefined);
  if (!imprint) return { ...step, zoom: rest };
  const anchored: DiagramStepZoom = { ...rest, imprint };
  const { frame } = placeOn(step, imprint, zoom.frame);
  if (!frame || nearOutline(frame, zoom.frame)) return { ...step, zoom: anchored };
  return withZoom(step, { ...anchored, frame }, assets);
}

/**
 * The frame moved, resized or reshaped by hand (Z10): as set, no smaller
 * than an area may be drawn, but for a centre dropped in a strip the spread
 * opened, which settles on the layer
 * above; its imprint made again on the same face, so later captures from it
 * land where it was left. On a step with no faces the frame as set is all
 * there is: the imprint it was captured with is dropped, so neither a later
 * capture from it nor a picture with faces puts it back where it was. The
 * marks go by the window's move, so they stay on the same paper.
 */
export function setFrameOutline(
  document: DiagramDocument,
  stepId: string,
  outline: DiagramZoomOutline,
  assets: Assets
): DiagramDocument {
  return withStep(document, stepId, (step) => {
    const { zoom } = step;
    if (!zoom || !step.picture) return step;
    const faces = paperFacesOf(step);
    let frame = heldFrame(sizedByHand(outline));
    let imprint = faces ? zoom.imprint : undefined;
    if (faces) {
      const drawn = toScene(faces, frame);
      let settled: DiagramZoomOutline = {
        ...drawn,
        centre: ontoSpread(faces, offSpread(faces, drawn.centre)),
      };
      const placed = toPicture(faces, settled);
      frame = heldFrame(placed);
      if (frame !== placed) settled = toScene(faces, frame);
      // On the same face; a frame that was copied in picture units is anchored by the default rule.
      const face = imprint ? faceAt(faces, imprint.on) : null;
      const anchor =
        face !== null && imprint ? { face, on: imprint.on, picked: imprint.picked === true } : anchorOf(faces, settled);
      const made = anchor && imprintFrame(faces, anchor.face, settled);
      if (anchor && made)
        imprint = {
          ...made,
          on: anchor.on,
          ...(anchor.picked ? { picked: true as const } : {}),
        };
    }
    const { imprint: _was, ...rest } = zoom;
    const next: DiagramStepZoom = {
      ...rest,
      shape: zoomShapeOf(frame),
      frame,
      ...(imprint ? { imprint } : {}),
    };
    return withZoom(step, next, assets);
  });
}

/**
 * A frame set by hand no smaller than an area may be drawn: a rim dragged to
 * its centre leaves the smallest frame, not a point a window paints at
 * thousands of times its size.
 */
function sizedByHand(outline: DiagramZoomOutline): DiagramZoomOutline {
  if (outline.radius !== undefined) {
    return outline.radius >= ZOOM_RADIUS.min ? outline : { ...outline, radius: ZOOM_RADIUS.min };
  }
  const [width, height] = outline.size!;
  if (width >= ZOOM_SIDE.min && height >= ZOOM_SIDE.min) return outline;
  return { ...outline, size: [Math.max(ZOOM_SIDE.min, width), Math.max(ZOOM_SIDE.min, height)] };
}

/**
 * The frame's anchor picked at a point on the paper, or reset to the default
 * rule (null): the frame stays where it is on its own step, and its imprint is
 * made again through the new face, which changes where later captures from it
 * land. A pick its paper does not hold changes nothing.
 */
export function setFrameAnchor(
  document: DiagramDocument,
  stepId: string,
  picked: PicturePoint | null
): DiagramDocument {
  return withStep(document, stepId, (step) => {
    const { zoom } = step;
    const faces = paperFacesOf(step);
    if (!zoom?.frame || !faces) return step;
    if (picked && faceAt(faces, picked) === null) return step;
    const drawn = toScene(faces, zoom.frame);
    const anchor = anchorOf(faces, drawn, picked ?? undefined);
    const made = anchor && imprintFrame(faces, anchor.face, drawn);
    if (!anchor || !made) return step;
    const imprint: ZoomImprint = {
      ...made,
      on: anchor.on,
      ...(anchor.picked ? { picked: true as const } : {}),
    };
    return { ...step, zoom: { ...zoom, imprint } };
  });
}

/**
 * The step re-posed — turned, turned over, its spread changed — `before` to
 * `after`, `move` the pose's own move of its picture (null when the change is
 * not one the app can follow): the frame landed again from its imprint on the
 * re-posed picture — a seeded step's first, when it has no frame yet — or,
 * with no faces, carried by the move; the marks by the pose's move too, from
 * the units they were in to the new window.
 */
export function reposeFrame(
  before: DiagramStep,
  after: DiagramStep,
  move: PictureMove | null,
  assets: Assets
): DiagramStep {
  const { zoom } = after;
  if (!zoom || !after.picture) return after;
  const landed = placeOn(after, zoom.imprint, undefined).frame;
  const frame = landed ?? (zoom.frame && (move ? carriedOutline(zoom.frame, move) : zoom.frame));
  if (!frame) return after;
  const next: DiagramStep = { ...after, zoom: { ...zoom, frame } };
  const [from, to] = [marksUnits(before, assets), marksUnits(next, assets)];
  if (!move || !from || !to) return next;
  return carryMarks(next, unitsMove(from.box, to.box, move), { was: before, reach: to.reach });
}

/**
 * How an enlarged step's own picture changed, as the app can say it: moved by
 * a pose it applied (turned, flipped, spread otherwise — the move its marks
 * are carried by, `annotationCarry.ts`), only recoloured (a crease pattern's
 * paper on the other side's colour, which moves nothing), or anything else —
 * a Refresh, a relink, a turn-over, Show as, a camera (null).
 */
export type OwnPictureChange = PictureMove | 'recoloured' | null;

/**
 * An enlarged step whose own picture changed, `before` to `after` (Revision
 * 2, D8 amended): every picture edit's one path for a frame, through
 * `withCarriedAnnotations`. The frame stays on its paper — its imprint landed
 * on the new picture through the face that holds its paper point, then onto
 * its spread — and the marks, in the window's units, go with it:
 *
 * - **re-posed** (`change` a move): {@link reposeFrame} — the frame landed,
 *   or carried by the move where the step has no faces; the marks by the
 *   pose's own move, window to window, still in step;
 * - **recoloured**: nothing moved, so the frame lands where it was and the
 *   marks stay in step with the new picture;
 * - **anything else**, a first picture included: {@link relandFrame} — the
 *   marks unchanged in the window's units, so they go with the frame, and out
 *   of step with a picture that changed, as any refresh leaves them (D8);
 *   out of step too when the picture's key is the same but the frame moved —
 *   a Refresh that gave an older capture its faces, landing a frame that was
 *   only copied — since the window shows other paper under them now. A
 *   folded picture shown as its crease pattern lands the frame on the paper
 *   its window showed instead ({@link landedOnSheet}), and folded again is
 *   anchored again by the default rule ({@link anchoredOffSheet}).
 *
 * `after` as it is for a step that is not enlarged, or has no picture now.
 */
export function followOwnPicture(
  before: DiagramStep,
  after: DiagramStep,
  change: OwnPictureChange,
  assets: Assets
): DiagramStep {
  if (!after.zoom || !after.picture) return after;
  if (!before.zoom || !before.picture || change === null) {
    const landed = landedOnSheet(before, after) ?? anchoredOffSheet(before, relandFrame(after));
    const stillInStep = landed !== after && landed.annotations.length > 0 && landed.annotatedPictureKey === after.picture.key;
    return stillInStep ? { ...landed, annotatedPictureKey: null } : landed;
  }
  if (change !== 'recoloured') return reposeFrame(before, after, change, assets);
  const landed = relandFrame(after);
  const inStep =
    before.annotations === after.annotations &&
    before.annotatedPictureKey !== null &&
    before.annotatedPictureKey === before.picture.key;
  return inStep ? { ...landed, annotatedPictureKey: after.picture.key } : landed;
}

/**
 * An enlarged folded step shown as its crease pattern — Show as, or Duplicate
 * As — (Z8 amended, Zach, 2026-10-07): its frame landed on the flat sheet on
 * the paper its window showed, imprinted afresh through the face on top at
 * the frame's centre, not through its anchor face. The anchor (Z9), the
 * backmost face outside the frame, is what a re-posed picture follows, since
 * it is least likely to move; but it lies under the paper the window showed,
 * as far off on the unfolded sheet as the model is folded — 288 sheet units
 * from the crane's head. A flat sheet moves no face, so it needs none. The
 * new imprint is kept, so the frame stays on that paper as the sheet is
 * turned. Null where this does not apply, for {@link relandFrame} to land
 * the frame as ever: `after` not a crease pattern, `before` not a folded
 * picture with faces, a picked anchor, which the frame follows wherever, or
 * no paper at the frame's centre, or none of it on the sheet.
 */
function landedOnSheet(before: DiagramStep, after: DiagramStep): DiagramStep | null {
  const { zoom } = after;
  const [was, now] = [paperFacesOf(before), paperFacesOf(after)];
  if (!zoom || !before.zoom?.frame || zoom.imprint?.picked || was?.kind !== 'flat' || now?.kind !== 'crease-pattern') return null;
  const drawn = toScene(was, before.zoom.frame);
  const face = topUnspread(was, offSpread(was, drawn.centre));
  const outline = face === null ? null : imprintFrame(was, face, drawn);
  if (!outline || faceAt(now, outline.centre) === null) return null;
  const imprint: ZoomImprint = { ...outline, on: outline.centre };
  const { frame } = placeOn(after, imprint, zoom.frame);
  return frame ? { ...after, zoom: { ...zoom, frame, imprint } } : null;
}

/**
 * An enlarged step's crease pattern shown folded again, its frame landed from
 * the sheet's imprint ({@link landedOnSheet}) where the paper it showed lies:
 * anchored again there by the default rule (Z9), as it was before the sheet
 * was shown, so a re-pose of the folded picture follows the face least likely
 * to move. The step itself where its frame did not land on the folded paper,
 * or its anchor is picked.
 */
function anchoredOffSheet(before: DiagramStep, landed: DiagramStep): DiagramStep {
  const { zoom } = landed;
  const [was, now] = [paperFacesOf(before), paperFacesOf(landed)];
  if (!zoom?.frame || !zoom.imprint || zoom.imprint.picked || was?.kind !== 'crease-pattern' || now?.kind !== 'flat') return landed;
  if (faceAt(now, zoom.imprint.on) === null) return landed;
  const imprint = imprintOn(landed, zoom.frame);
  return imprint ? { ...landed, zoom: { ...zoom, imprint } } : landed;
}

/**
 * The frame made the other shape (Shape, on a frame): about the same centre,
 * as an area's is (`outlineAsShape`), its imprint made again on the same
 * face and its marks carried by the window's move ({@link setFrameOutline}).
 * An Edge left unsaid follows the new shape by itself.
 */
export function setFrameShape(
  document: DiagramDocument,
  stepId: string,
  shape: DiagramZoomShape,
  assets: Assets
): DiagramDocument {
  const frame = frameOf(document, stepId);
  if (!frame || zoomShapeOf(frame) === shape) return document;
  return setFrameOutline(document, stepId, outlineAsShape(frame, shape), assets);
}

/** The frame's Size (Z4): that many times its area as it prints, held to its range; Fill for null. */
export function setFrameScale(document: DiagramDocument, stepId: string, scale: number | null): DiagramDocument {
  return withStep(document, stepId, (step) => {
    if (!step.zoom) return step;
    const { scale: was, ...rest } = step.zoom;
    if (scale === null || !Number.isFinite(scale)) return was === undefined ? step : { ...step, zoom: rest };
    const held = Math.min(ZOOM_SCALE.max, Math.max(ZOOM_SCALE.min, scale));
    return held === was ? step : { ...step, zoom: { ...rest, scale: held } };
  });
}

/** How the frame draws its edge: Cut or Whole; its shape's own for null. */
export function setFrameEdge(document: DiagramDocument, stepId: string, edge: DiagramZoomEdge | null): DiagramDocument {
  return withStep(document, stepId, (step) => {
    if (!step.zoom || (step.zoom.edge ?? null) === edge) return step;
    const { edge: _was, ...rest } = step.zoom;
    return { ...step, zoom: edge === null ? rest : { ...rest, edge } };
  });
}

/** A step a new step's seed enlarged, and its capture: how its frame was placed, or null until its first picture. */
export interface SeededStep {
  stepId: string;
  captured: ZoomCaptured;
}

/**
 * Steps just made — Add Step, Insert Step After, an upload of one picture or
 * several, cards pulled from References — each starting enlarged when the step
 * before it, turns passed, is (Z2, "yeah sounds right"): captured at creation
 * from that step's frame. The one way every new step is seeded. In the
 * diagram's order, so a run of new steps after an enlarged one is enlarged
 * through, every step of the run from the run's source — the step its first
 * is captured from — so each keeps the source's imprint: one captured from
 * the step before it, an upload with no faces, would have only its frame
 * (16h). A step `filled` in the same edit starts the run as it was before its
 * picture, its frame and imprint as it was seeded with them. A step made with
 * its picture has its frame landed at once; an empty one keeps its imprint for
 * its first picture ({@link landSeededFrame}). A step enlarged already — a
 * duplicate keeps its original's frame — is left as it is, as is one after a
 * step that is not enlarged. The diagram, and the steps seeded with their
 * captures, for what counts them.
 */
export function seedNewSteps(
  document: DiagramDocument,
  stepIds: readonly string[],
  assets: Assets,
  filled?: DiagramStep
): { document: DiagramDocument; seeded: SeededStep[] } {
  const made = new Set(stepIds);
  let next = document;
  const seeded: SeededStep[] = [];
  let run: ZoomSource | null = null;
  for (const entry of document.steps) {
    if (isTurn(entry)) continue;
    if (!made.has(entry.id) || entry.zoom) {
      run = entry.id === filled?.id && filled.zoom ? { step: filled, zoom: filled.zoom } : null;
      continue;
    }
    const source: ZoomSource | null = run ?? seedSource(next, entry.id);
    const result = enlargeWith(next, entry.id, source && capture(next, entry.id, source), assets);
    if (!result.captured || result.document === next) {
      run = null;
      continue;
    }
    run = source;
    next = result.document;
    seeded.push({ stepId: entry.id, captured: result.captured });
  }
  return { document: next, seeded };
}

/**
 * An enlarged step's first picture landing the frame it was seeded with — its
 * stored imprint, through the face that holds its paper point, then onto its
 * spread; copied in picture units where it cannot ({@link relandFrame}). The
 * frame now placed, and how, or null when the step has none to place.
 */
export function landFirstFrame(
  document: DiagramDocument,
  stepId: string
): { document: DiagramDocument; placed: ZoomCaptured['placed'] } | null {
  const index = stepIndex(document, stepId);
  const entry = document.steps[index];
  if (!entry || isTurn(entry) || isLockedStep(entry) || !entry.zoom || !entry.picture) return null;
  const placed = placeOn(entry, entry.zoom.imprint, entry.zoom.frame);
  if (!placed.frame) return null;
  const next = relandFrame(entry);
  if (next === entry) return { document, placed: placed.placed };
  const steps = document.steps.slice();
  steps[index] = next;
  return { document: { ...document, steps }, placed: placed.placed };
}

/** A step's first picture, landing the frame it was enlarged with while it had none. */
export interface LandedFirstFrame {
  document: DiagramDocument;
  /** How the frame was placed; null for a step that had a picture already, or is not enlarged. */
  placed: ZoomCaptured['placed'];
  /** The frame the step held before its picture, as it was enlarged with it: what says how it was enlarged. */
  enlargedWith?: DiagramStepZoom;
}

/**
 * A step given its first picture — `after` the diagram with it, `before`
 * without — landing the frame it was seeded with ({@link landFirstFrame}):
 * the diagram, and how the frame was placed; `after` as it is, and null, for
 * a step that had a picture already or is not enlarged.
 */
export function landSeededFrame(before: DiagramDocument, after: DiagramDocument, stepId: string): LandedFirstFrame {
  const was = before.steps[stepIndex(before, stepId)];
  if (!was || isTurn(was) || was.picture) return { document: after, placed: null };
  const landed = landFirstFrame(after, stepId);
  return landed ? { ...landed, ...(was.zoom ? { enlargedWith: was.zoom } : {}) } : { document: after, placed: null };
}

/** A step's frame, in its picture units; null for a step that is not enlarged or shows no window. */
function frameOf(document: DiagramDocument, stepId: string): DiagramZoomOutline | null {
  const entry = document.steps[stepIndex(document, stepId)];
  return entry && !isTurn(entry) && entry.picture && entry.zoom?.frame ? entry.zoom.frame : null;
}

/** An outline carried by a picture's move, as an area is: its centre, its size with the move, a rectangle's turn. */
function carriedOutline(outline: DiagramZoomOutline, move: PictureMove): DiagramZoomOutline {
  const area = carryAnnotation(
    {
      id: 'frame',
      kind: 'zoom',
      from: outline.centre,
      to: outline.centre,
      ...(outline.radius !== undefined ? { radius: outline.radius } : {}),
      ...(outline.size !== undefined ? { size: outline.size } : {}),
      ...(outline.angle !== undefined ? { angle: outline.angle } : {}),
    },
    move
  );
  return {
    centre: area.from,
    ...(area.radius !== undefined ? { radius: area.radius } : {}),
    ...(area.size !== undefined ? { size: area.size } : {}),
    ...(area.angle !== undefined ? { angle: area.angle } : {}),
  };
}

function sameOutline(a: DiagramZoomOutline, b: DiagramZoomOutline | undefined): boolean {
  return b !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** Whether two outlines are one, but for float noise: a frame imprinted and landed again where it was. */
function nearOutline(a: DiagramZoomOutline, b: DiagramZoomOutline): boolean {
  const near = (x: number | undefined, y: number | undefined) =>
    x === y || (x !== undefined && y !== undefined && Math.abs(x - y) <= 1e-9);
  return (
    near(a.centre[0], b.centre[0]) &&
    near(a.centre[1], b.centre[1]) &&
    near(a.radius, b.radius) &&
    near(a.size?.[0], b.size?.[0]) &&
    near(a.size?.[1], b.size?.[1]) &&
    near(a.angle ?? 0, b.angle ?? 0)
  );
}
