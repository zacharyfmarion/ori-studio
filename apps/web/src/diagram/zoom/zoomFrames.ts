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
 * | Enlarged turned on; Update | captured and landed ({@link enlargeStep}, {@link updateEnlargedSteps}) | whole picture or old window → new window |
 * | A seeded step's first picture; a refresh or relink | landed from its imprint ({@link relandFrame}) | unchanged |
 * | Enlarged turned off | dropped ({@link unenlargeStep}) | window → whole picture |
 * | Moved, resized or reshaped by hand | as set, its imprint made again ({@link setFrameOutline}) | by the window's move |
 * | Its anchor picked or reset | unchanged, its imprint made again ({@link setFrameAnchor}) | unchanged |
 * | The step re-posed | landed on the re-posed picture ({@link reposeFrame}) | the pose's move, window to window |
 * | The area or its step edited, moved or deleted | unchanged | unchanged |
 *
 * Pure: no store.
 */
import { carryAnnotation, type PictureMove, type PicturePoint } from '../annotate/annotationModel';
import {
  isKnownAnnotation,
  isLockedStep,
  isTurn,
  stepIndex,
  type DiagramAsset,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepZoom,
  type DiagramZoomOutline,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import {
  anchorOf,
  areaSource,
  capture,
  heldFrame,
  placeOn,
  stepsFrom,
  type ZoomCaptured,
  type ZoomImprint,
} from './zoomCapture';
import { faceAt, imprintFrame, offSpread, ontoSpread, paperFacesOf, toPicture, toScene } from './zoomImprint';
import { frameWindow, zoomShapeOf, type PictureBox } from './zoomModel';

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
 * step: the move would leave that one behind. So does one with a mark the
 * move cannot take where it goes, which `back`, the move undone, shows: a
 * mark more than reach's four windows from a small frame, say, which the
 * carry would hold at reach's edge and a carry back would leave there.
 */
function carryMarks(
  step: DiagramStep,
  move: PictureMove | null,
  was: DiagramStep = step,
  back?: PictureMove
): DiagramStep {
  if (!move || step.annotations.length === 0) return step;
  if (!step.annotations.every(isKnownAnnotation)) return { ...step, annotatedPictureKey: null };
  if (!was.picture || was.annotatedPictureKey !== was.picture.key) return step;
  const marks = step.annotations as KnownDiagramAnnotation[];
  const carried = marks.map((mark) => carryAnnotation(mark, move));
  if (back && carried.some((mark, index) => !sameMark(carryAnnotation(mark, back), marks[index]!))) {
    return { ...step, annotatedPictureKey: null };
  }
  return { ...step, annotations: carried, annotatedPictureKey: step.picture?.key ?? null };
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

/** The marks' units: the window, or the whole picture. */
function marksBox(step: DiagramStep, assets: Assets): PictureBox | null {
  return stepWindow(step) ?? wholeBox(step, assets);
}

/** A step's marks moved from one set of units to another, when both are known, and each can go there and back. */
function carryBetween(step: DiagramStep, from: PictureBox | null, to: PictureBox | null): DiagramStep {
  return from && to ? carryMarks(step, unitsMove(from, to), step, unitsMove(to, from)) : step;
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

/** A step with `zoom` as its frame — or none — and its marks carried from the units they were in to the new ones. */
function withZoom(step: DiagramStep, zoom: DiagramStepZoom | undefined, assets: Assets): DiagramStep {
  const before = marksBox(step, assets);
  const { zoom: _was, ...rest } = step;
  const next: DiagramStep = zoom ? { ...rest, zoom } : rest;
  return carryBetween(next, before, marksBox(next, assets));
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
 * captures, in order, for what counts them.
 */
export function updateEnlargedSteps(
  document: DiagramDocument,
  areaId: string,
  assets: Assets
): { document: DiagramDocument; captured: ZoomCaptured[] } {
  const source = areaSource(document, areaId);
  if (!source) return { document, captured: [] };
  let next = document;
  const captured: ZoomCaptured[] = [];
  for (const stepId of stepsFrom(document, areaId)) {
    // Only the steps it enlarged change, so the area's step, and the area, stay as they were.
    const step = enlargeWith(next, stepId, capture(next, stepId, source), assets);
    next = step.document;
    if (step.captured) captured.push(step.captured);
  }
  return { document: next, captured };
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
 * The frame moved, resized or reshaped by hand (Z10): as set, but for a
 * centre dropped in a strip the spread opened, which settles on the layer
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
    let frame = heldFrame(outline);
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
  const [from, to] = [marksBox(before, assets), marksBox(next, assets)];
  if (!move || !from || !to) return next;
  return carryMarks(next, unitsMove(from, to, move), before);
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
