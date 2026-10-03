/**
 * Annotations as data (D8): what each kind is made of, how one is made from a
 * drag or a click, how it is edited, and how it follows its picture when the
 * picture is turned or flipped.
 *
 * Everything is in picture units — the frame's top-left the origin, y down,
 * its longer side one unit (`KnownDiagramAnnotation`) — so nothing here knows
 * how big a picture is drawn.
 *
 * Pure: no DOM, no store, no React.
 */
import {
  randomDiagramId,
  type DiagramAnnotationKind,
  type DiagramIdFactory,
  type DiagramRotation,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';

export type PicturePoint = [number, number];

/** A picture's frame in picture units: its longer side is 1. */
export interface PictureFrame {
  width: number;
  height: number;
}

/** The fold arrows, which bulge, and whose bulge Flip arc turns over. */
export const ARROW_KINDS: ReadonlySet<DiagramAnnotationKind> = new Set([
  'valley-arrow',
  'mountain-arrow',
  'fold-unfold-arrow',
]);

/** The kinds placed with a click, at one point: `to` is `from`. */
export const POINT_KINDS: ReadonlySet<DiagramAnnotationKind> = new Set(['turn-over', 'rotate', 'label']);

/** The crease lines, drawn in the diagram's pens. */
export const LINE_KINDS: ReadonlySet<DiagramAnnotationKind> = new Set([
  'valley-line',
  'mountain-line',
  'hidden-line',
]);

export const ANNOTATION_KINDS: readonly DiagramAnnotationKind[] = [
  'valley-arrow',
  'mountain-arrow',
  'fold-unfold-arrow',
  'push-arrow',
  'turn-over',
  'rotate',
  'valley-line',
  'mountain-line',
  'hidden-line',
  'label',
];

/**
 * A 60° arc, as References draws a fold arrow (`foldArrowArc`): its sagitta
 * is `1 − cos 30°` of its chord.
 */
export const ARROW_BEND = 1 - Math.cos(Math.PI / 6);
/** The most an arc may bulge: a half circle. */
export const MAX_BEND = 0.5;

/** A label's letters, as a share of the frame's longer side: a fixed size in picture units (D8). */
export const LABEL_SIZE = 0.05;
/** What a new label says until it is typed over: the letter diagrams name a point with. */
export const NEW_LABEL_TEXT = 'A';
/** The longest label: a few words, not an instruction. */
export const LABEL_MAX_LENGTH = 80;

export const DEFAULT_ROTATION: DiagramRotation = { amount: 'quarter', direction: 'cw' };

/** How far past the frame an annotation may reach, in frame lengths: an arrow may start off the picture. */
export const ANNOTATION_REACH = 4;

export function isArrowKind(kind: DiagramAnnotationKind): boolean {
  return ARROW_KINDS.has(kind);
}

export function isPointKind(kind: DiagramAnnotationKind): boolean {
  return POINT_KINDS.has(kind);
}

/**
 * The bulge a new fold arrow is given: toward the frame's middle, as
 * References chooses the centre farther from the sheet's middle so its
 * arrows bulge inward (`foldArrowArc`). Either way for an arrow through the
 * middle.
 */
export function defaultBend(from: PicturePoint, to: PicturePoint, frame: PictureFrame): number {
  const middle: PicturePoint = [frame.width / 2, frame.height / 2];
  const left = leftNormal(from, to);
  const mid: PicturePoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const toward = (middle[0] - mid[0]) * left[0] + (middle[1] - mid[1]) * left[1];
  return toward < 0 ? -ARROW_BEND : ARROW_BEND;
}

/** A new annotation of `kind`, from a drag (`from` → `to`) or a click (`to` ignored for a point kind). */
export function createAnnotation(
  kind: DiagramAnnotationKind,
  from: PicturePoint,
  to: PicturePoint,
  frame: PictureFrame,
  newId: DiagramIdFactory = randomDiagramId
): KnownDiagramAnnotation {
  const id = newId('annotation');
  if (isPointKind(kind)) {
    const at: PicturePoint = [from[0], from[1]];
    const base: KnownDiagramAnnotation = { id, kind, from: at, to: [at[0], at[1]] };
    if (kind === 'label') return { ...base, text: NEW_LABEL_TEXT };
    if (kind === 'rotate') return { ...base, rotate: DEFAULT_ROTATION };
    return { ...base, axis: 'vertical' };
  }
  const annotation: KnownDiagramAnnotation = { id, kind, from: [from[0], from[1]], to: [to[0], to[1]] };
  return isArrowKind(kind) ? { ...annotation, bend: defaultBend(from, to, frame) } : annotation;
}

/** The whole annotation moved by `delta`. */
export function moveAnnotation(annotation: KnownDiagramAnnotation, delta: PicturePoint): KnownDiagramAnnotation {
  if (delta[0] === 0 && delta[1] === 0) return annotation;
  const shift = (point: PicturePoint): PicturePoint => [point[0] + delta[0], point[1] + delta[1]];
  return { ...annotation, from: shift(annotation.from), to: shift(annotation.to) };
}

/** One end put at `point`. A point kind has one place, so both move. */
export function moveAnnotationEnd(
  annotation: KnownDiagramAnnotation,
  end: 'from' | 'to',
  point: PicturePoint
): KnownDiagramAnnotation {
  const at: PicturePoint = [point[0], point[1]];
  if (isPointKind(annotation.kind)) return { ...annotation, from: at, to: [at[0], at[1]] };
  return end === 'from' ? { ...annotation, from: at } : { ...annotation, to: at };
}

/** A fold arrow bulging the other way; anything else as it was. */
export function flipAnnotationArc(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (!isArrowKind(annotation.kind)) return annotation;
  return { ...annotation, bend: -(annotation.bend ?? ARROW_BEND) };
}

/** Whether an annotation drawn this short would draw nothing: an arrow or line needs a length. */
export function isDegenerate(annotation: KnownDiagramAnnotation, minLength: number): boolean {
  if (isPointKind(annotation.kind)) return false;
  return Math.hypot(annotation.to[0] - annotation.from[0], annotation.to[1] - annotation.from[1]) < minLength;
}

/** The unit normal to the left of travel from `from` to `to`, as the page shows it (y down). */
function leftNormal(from: PicturePoint, to: PicturePoint): PicturePoint {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return [dy / length, -dx / length];
}

/**
 * The top of a fold arrow's arc: the point its bulge reaches, a sagitta of
 * `bend` chords to the left of its travel (to the right for a negative
 * bend). With the two ends, it fixes the arc.
 */
export function arrowApex(from: PicturePoint, to: PicturePoint, bend: number): PicturePoint {
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const left = leftNormal(from, to);
  const sagitta = bend * chord;
  return [(from[0] + to[0]) / 2 + left[0] * sagitta, (from[1] + to[1]) / 2 + left[1] * sagitta];
}

/**
 * How a picture's own change moved what it shows (D8: a pose the app
 * applied), so its annotations can follow: where a point went, whether the
 * change was a mirror, and how far it turned, clockwise.
 */
export interface PictureMove {
  point: (point: PicturePoint) => PicturePoint;
  mirrors: boolean;
  /** Clockwise degrees: a quarter turn is 90. */
  turnDeg: number;
}

/**
 * An annotation carried through a picture's move. Every point moves; a
 * mirror turns an arrow's bulge and a rotation's sense over; a quarter turn
 * (or three) turns a turn-over's axis. A label's text stays upright.
 */
export function carryAnnotation(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  const carried: KnownDiagramAnnotation = {
    ...annotation,
    from: move.point(annotation.from),
    to: move.point(annotation.to),
  };
  if (move.mirrors && annotation.bend !== undefined) carried.bend = -annotation.bend;
  if (move.mirrors && annotation.rotate) {
    carried.rotate = { ...annotation.rotate, direction: annotation.rotate.direction === 'cw' ? 'ccw' : 'cw' };
  }
  const quarters = Math.round(move.turnDeg / 90);
  if (annotation.axis && Math.abs(quarters) % 2 === 1) {
    carried.axis = annotation.axis === 'vertical' ? 'horizontal' : 'vertical';
  }
  return carried;
}

/** A picture flipped left to right inside its frame. */
export function mirrorMove(frame: PictureFrame): PictureMove {
  return { point: ([x, y]) => [frame.width - x, y], mirrors: true, turnDeg: 0 };
}

/** A picture's frame from its size: the longer side one unit. */
export function frameOf(width: number, height: number): PictureFrame | null {
  const longer = Math.max(width, height);
  if (!(longer > 0) || !Number.isFinite(longer)) return null;
  return { width: width / longer, height: height / longer };
}
