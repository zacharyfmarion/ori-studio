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
import type { CircleDrawingMode } from './circleDrawing';
import { flattenPath, type Cubic } from '../../lib/cubicBezier';
import { snapAngle, TRANSFORM_ROTATION_SNAP_RADIANS } from '../../lib/transformBox';
import { graphemesOf } from '../../lib/paper/textWrap';
import { xmlText } from '../../lib/xmlEscape';
import { needsNoGlyph, scriptFonts, textCjkKey } from '../fonts/fontScripts';
import { isAnnotationColor } from './annotationColors';
import { ANNOTATION_INK_MM, ptInPictureUnits } from './canvasInk';
import {
  isTextSizePt,
  PLAIN_TEXT_STYLE,
  sameTextStyle,
  TEXT_OFFSET_PT_MAX,
  TEXT_SIZE_PT,
  type TextStyle,
} from './textStyle';
import { cjkRunAdvance, labelAdvance } from './labelAdvances';
import {
  DIAGRAM_DIVISIONS_INK,
  type DiagramWhiteArrowFill,
  type DiagramWhiteArrowWidth,
} from '../../cp-workspace/references/diagram/diagramInk';
import type { WhiteArrowTail } from '../../cp-workspace/references/stepDiagramGeometry';
import {
  randomDiagramId,
  type DiagramTicks,
  type DiagramAnnotationKind,
  type DiagramBehind,
  type DiagramIdFactory,
  type DiagramPathNode,
  type DiagramPleatKinks,
  type DiagramRotation,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';

export type PicturePoint = [number, number];

/** A picture's frame in picture units: its longer side is 1. */
export interface PictureFrame {
  width: number;
  height: number;
}

/**
 * How each kind is drawn and put down, which every kind has to say — a
 * record, so a new kind is a compile error here until it does:
 * - `arc`: a fold arrow, dragged from tail to tip, bulging on an arc;
 * - `straight`: a push or a pleat arrow, dragged, straight from `from` to `to`;
 * - `path`: a white arrow, dragged straight from tail to tip, and always a
 *   path, shaped from there;
 * - `line`: a crease line, dragged, drawn in the diagram's pens;
 * - `point`: a sign, a label, a circle or a star (Revision 3), put down with
 *   a click at one point (`to` is `from`);
 * - `corner`: a right-angle mark, put down in a corner — with a click on a
 *   right angle, or a drag from its corner into the angle — `to` saying only
 *   which way it opens ({@link RIGHT_ANGLE_DIAGONAL});
 * - `callout`: a line from a point to a box of words, dragged from the point
 *   to where the box sits, or put down beside the point with a click;
 * - `angle`: an angle marked halved, put down by three presses — an arm, the
 *   vertex, the other arm — or with a bisector, `to` and `other` saying only
 *   which way its arms run (15b);
 * - `divisions`: equal divisions of a line, dragged from one end of it to
 *   the other or put down on a line with a click, drawn set off it, never
 *   along it — a mark, not a line, so a line's every consumer passes it by
 *   (Revision 2);
 * - `close-up`: a ring round an area of the picture and a larger one beside
 *   it, dragged between the area's bounding corners, or put down with a
 *   click (15f);
 * - `zoom`: an enlarge area, a circle or a rounded rectangle round what a
 *   later step may show enlarged, its centre `from` and `to` alike, put down
 *   with a drag or a click (Revision 2);
 * - `sight`: an eye, its centre `from` and `to` alike, the way it looks its
 *   `angle` — put down with a drag from the viewer toward what they look at,
 *   or a click that looks at the picture's middle (Revision 3). Not a point
 *   kind, which a click alone puts down, nor a corner, whose click would look
 *   for a right angle;
 * - `area`: an oval or a rectangle round an area of the picture, its centre
 *   `from` and `to` alike, its `size` in picture units and its `angle` its
 *   turn — dragged corner to corner as Enlarge in Frame's area is, or put
 *   down a standard size with a click (Revision 3);
 * - `x-ray`: a circular window cut into a flat fold's picture, its centre
 *   `from` and `to` alike, its `radius` in picture units, how many steps it
 *   peels its `depth`, and the point on the paper whose nearest face each
 *   step takes first its `anchor` (R3-34 A, R3-35 A) — dragged between its
 *   bounding corners, or put down a standard size with a click
 *   (Revision 3, R3-14 A).
 */
type AnnotationShape =
  | 'arc'
  | 'straight'
  | 'path'
  | 'line'
  | 'point'
  | 'corner'
  | 'callout'
  | 'angle'
  | 'divisions'
  | 'close-up'
  | 'zoom'
  | 'sight'
  | 'area'
  | 'x-ray';

const ANNOTATION_SHAPES: Readonly<Record<DiagramAnnotationKind, AnnotationShape>> = {
  'valley-arrow': 'arc',
  'mountain-arrow': 'arc',
  'fold-unfold-arrow': 'arc',
  'pleat-arrow': 'straight',
  'push-arrow': 'straight',
  'white-arrow': 'path',
  'turn-over': 'point',
  rotate: 'point',
  'valley-line': 'line',
  'mountain-line': 'line',
  'hidden-line': 'line',
  'solid-line': 'line',
  label: 'point',
  circle: 'point',
  star: 'point',
  'right-angle': 'corner',
  callout: 'callout',
  'angle-mark': 'angle',
  divisions: 'divisions',
  'close-up': 'close-up',
  zoom: 'zoom',
  eye: 'sight',
  oval: 'area',
  rectangle: 'area',
  'x-ray': 'x-ray',
};

/** Every kind, in the order the rail offers them. */
export const ANNOTATION_KINDS = Object.keys(ANNOTATION_SHAPES) as readonly DiagramAnnotationKind[];

const kindsShaped = (shape: AnnotationShape): ReadonlySet<DiagramAnnotationKind> =>
  new Set(ANNOTATION_KINDS.filter((kind) => ANNOTATION_SHAPES[kind] === shape));

/** The fold arrows, which bulge on an arc. */
export const ARROW_KINDS = kindsShaped('arc');

/** The kinds placed with a click, at one point: `to` is `from`. A circle is one: its centre. */
export const POINT_KINDS = kindsShaped('point');

/** The crease lines, drawn in the diagram's pens. */
export const LINE_KINDS = kindsShaped('line');

/** The shapes (Revision 3): an oval or a rectangle round an area, with a transform box. */
export const AREA_KINDS = kindsShaped('area');

/** Whether `kind` is a shape: an oval or a rectangle (Revision 3). */
export function isAreaKind(kind: DiagramAnnotationKind): kind is 'oval' | 'rectangle' {
  return AREA_KINDS.has(kind);
}

/** The marks put down in a corner, opening along its diagonal: the right angle. */
export const CORNER_KINDS = kindsShaped('corner');

/** The marks of an angle between two arms: the angle mark. */
export const ANGLE_KINDS = kindsShaped('angle');

/**
 * A 60° arc, as References draws a fold arrow (`foldArrowArc`): its sagitta
 * is `1 − cos 30°` of its chord.
 */
export const ARROW_BEND = 1 - Math.cos(Math.PI / 6);
/** The most an arc may bulge: a half circle. */
export const MAX_BEND = 0.5;

/**
 * A label's letters, as a share of the frame's longer side: a fixed size in
 * picture units (D8) — a label's size when it has none of its own in pt
 * (`sizePt`, 17b).
 */
export const LABEL_SIZE = 0.05;
/** What a new label says until it is typed over: the letter diagrams name a point with. */
export const NEW_LABEL_TEXT = 'A';
/** The longest label: a few words, not an instruction. A callout's words are held to it too. */
export const LABEL_MAX_LENGTH = 80;
/**
 * What a new callout says when nothing else is given: the words it is for.
 * The canvas gives it in the author's own language (`useAnnotateCanvas`).
 */
export const NEW_CALLOUT_TEXT = 'Repeat behind';
/**
 * How far a callout put down with a click sits from its point, in picture
 * units along each side: its box's near corner that far out, diagonally.
 */
export const CALLOUT_GAP = 0.08;

export const DEFAULT_ROTATION: DiagramRotation = { amount: 'quarter', direction: 'cw' };

/** A pleat arrow's Zs, as the Step pane offers them: a crimp's one to five. */
export const PLEAT_KINKS: readonly DiagramPleatKinks[] = [1, 2, 3, 4, 5];

/** A new pleat arrow's Zs, and one's that a file leaves unsaid: one, as a crimp's (decision 10). */
export const DEFAULT_PLEAT_KINKS: DiagramPleatKinks = 1;

/** A count of Zs a pleat arrow can have: `value` whole, and within one to five. */
export function pleatKinks(value: number): DiagramPleatKinks {
  if (!Number.isFinite(value)) return DEFAULT_PLEAT_KINKS;
  return Math.min(PLEAT_KINKS.length, Math.max(1, Math.round(value))) as DiagramPleatKinks;
}

/**
 * A mark with a side, on the side `mirrored` says — a pleat arrow's Zs
 * stepping, equal divisions' line lying, to the left of the way it runs —
 * `mirrored` written only when true.
 */
export function withSide(annotation: KnownDiagramAnnotation, mirrored: boolean): KnownDiagramAnnotation {
  const { mirrored: _side, ...rest } = annotation;
  return mirrored ? { ...rest, mirrored: true } : rest;
}

/** Whether a mark of `kind` has ticks the Layers pane sets: an angle mark, and equal divisions (ED7). */
export function hasTicks(kind: DiagramAnnotationKind): boolean {
  return kind === 'angle-mark' || kind === 'divisions';
}

/** The most layers an end can be behind, as the Step pane counts them: more than a picture shows stacked over a point. */
export const MAX_BEHIND_LAYERS = 9;

/**
 * The ends of a mark of `kind` that can be behind a flap (15e): a fold or
 * pleat arrow's tail and tip, a valley, mountain or solid line's two ends
 * (a solid line's dotted in its own pen and colour, 17a), and a circle's
 * centre. None for a hidden line, dotted already, nor in v1 for a
 * push, white or solid arrow, a sign, a label, a callout, or a mark in a
 * corner or an angle. A switch, so a new kind has to say.
 */
export function behindEnds(kind: DiagramAnnotationKind): readonly ('from' | 'to')[] {
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'valley-line':
    case 'mountain-line':
    case 'solid-line':
      return ['from', 'to'];
    case 'circle':
      return ['from'];
    case 'push-arrow':
    case 'white-arrow':
    case 'turn-over':
    case 'rotate':
    case 'hidden-line':
    case 'label':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'divisions':
    case 'close-up':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
    case 'star':
    case 'eye':
      return [];
  }
}

/**
 * A mark with its `end` behind `layers` deep, or in front for null: written
 * from end to end, and `behind` dropped once no end is.
 */
export function withBehind(annotation: KnownDiagramAnnotation, end: 'from' | 'to', layers: number | null): KnownDiagramAnnotation {
  const ends: DiagramBehind = { ...annotation.behind, [end]: layers ?? undefined };
  return withBehindEnds(annotation, ends);
}

/** A mark with every end that is behind `layers` deep. */
export function withBehindLayers(annotation: KnownDiagramAnnotation, layers: number): KnownDiagramAnnotation {
  const ends: DiagramBehind = {};
  for (const end of behindEnds(annotation.kind)) if (annotation.behind?.[end] !== undefined) ends[end] = layers;
  return withBehindEnds(annotation, ends);
}

/** `ends` as a mark's `behind`, `from` before `to`, only the ends its kind has, each a whole count within reach; none when no end is. */
function withBehindEnds(annotation: KnownDiagramAnnotation, ends: DiagramBehind): KnownDiagramAnnotation {
  const kept: DiagramBehind = {};
  for (const end of behindEnds(annotation.kind)) {
    const layers = ends[end];
    if (layers !== undefined && Number.isInteger(layers) && layers >= 1) kept[end] = Math.min(layers, MAX_BEHIND_LAYERS);
  }
  const { behind: _was, ...rest } = annotation;
  return kept.from !== undefined || kept.to !== undefined ? { ...rest, behind: kept } : rest;
}

/** A mark's `behind` kept to what its kind can have — none on a line made a hidden line — and the same mark when it already is. */
function cleanBehind(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (annotation.behind === undefined) return annotation;
  const cleaned = withBehindEnds(annotation, annotation.behind);
  const [was, now] = [annotation.behind, cleaned.behind];
  const same = now !== undefined && Object.keys(was).length === Object.keys(now).length && was.from === now.from && was.to === now.to;
  return same ? annotation : cleaned;
}

/**
 * A new white arrow's look, and one's that a file leaves unsaid: the Origami
 * House template's white arrow (`path4649`), regular and tapered to a point.
 */
export const DEFAULT_WHITE_ARROW: Readonly<{ width: DiagramWhiteArrowWidth; tail: WhiteArrowTail }> = {
  width: 'regular',
  tail: 'pointed',
};

/** What a white arrow looks like: its width, its tail and its fill, any of which the Step pane sets alone. */
export interface WhiteArrowLook {
  width?: DiagramWhiteArrowWidth;
  tail?: WhiteArrowTail;
  fill?: DiagramWhiteArrowFill;
}

/**
 * The solid arrow's look (decision 11): a white arrow as narrow as a push
 * arrow, its tail cut square — the flat bottom — and filled with the arrow's
 * ink. The Solid Arrow tool lays one so; Edit Path shapes and lengthens it
 * as any white arrow.
 */
export const SOLID_ARROW_LOOK: Readonly<Required<WhiteArrowLook>> = { width: 'narrow', tail: 'square', fill: 'black' };

/** Whether an annotation is a solid arrow: a white arrow filled with ink, named and counted as one. */
export function isSolidArrow(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'fill'>): boolean {
  return annotation.kind === 'white-arrow' && annotation.fill === 'black';
}

/** A white arrow in `look`, what it leaves unsaid as it was: its fill written only when black. */
export function withWhiteArrowLook(annotation: KnownDiagramAnnotation, look: WhiteArrowLook): KnownDiagramAnnotation {
  const { fill, ...rest } = look;
  const changed = { ...annotation, ...rest };
  if (fill === undefined) return changed;
  const { fill: _was, ...unfilled } = changed;
  return fill === 'black' ? { ...unfilled, fill } : unfilled;
}

/**
 * How far a star's or an eye's `scale` goes, times its print size (Revision
 * 3, R3-30a A): half to four times, a star 1.5 to 12 mm across, an eye 2.5
 * to 20 mm long. Its transform box holds a resize to it, and a file's past
 * it is a newer build's.
 */
export const GLYPH_SCALE = { min: 0.5, max: 4 } as const;

/** A star's or an eye's size as drawn, times its print size: unsaid, 1. */
export function glyphScaleOf({ scale }: Pick<KnownDiagramAnnotation, 'scale'>): number {
  return scale ?? 1;
}

/**
 * A star's turn as drawn, in degrees clockwise on the page, one point up at
 * 0; the way an eye looks, in degrees clockwise from looking right: unsaid, 0.
 */
export function glyphAngleOf({ angle }: Pick<KnownDiagramAnnotation, 'angle'>): number {
  return angle ?? 0;
}

/**
 * What a turn and a scale are kept to, dragged, laid or typed (18b): a
 * hundredth of a degree, as the Rotation row reads it, and a thousandth of
 * the print size — a micron on a 1.5 mm star — so a file is not written to
 * seventeen places (a typed 12.345 comes wrapped as 12.345000000000027), and
 * a drag back to where it began writes what was there.
 */
export const GLYPH_ANGLE_PRECISION = 0.01;
export const GLYPH_SCALE_PRECISION = 0.001;

/** `value` to the nearest `step`, written to the step's places, and never as −0. */
export function keptTo(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6)) + 0;
}

/** A scale held to {@link GLYPH_SCALE}; 1 for one that is no number. */
export function glyphScaleWithin(scale: number): number {
  return Number.isFinite(scale) ? Math.min(GLYPH_SCALE.max, Math.max(GLYPH_SCALE.min, scale)) : 1;
}

/** Degrees clockwise turned into [0, 360), as the file reads a star's turn; 0 for no number. */
export function glyphAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const turned = degrees % 360;
  const within = turned < 0 ? turned + 360 : turned;
  // A turn a hair short of a whole one is upright again, not 359.9999999.
  return Math.abs(within - 360) < 1e-9 || Math.abs(within) < 1e-9 ? 0 : within;
}

/**
 * A turn as a drag, a typed Rotation, a laid eye or a carry writes it: to a
 * hundredth of a degree ({@link GLYPH_ANGLE_PRECISION}) within the range
 * `within` turns it into — a star's or an eye's [0, 360) ({@link glyphAngle}),
 * a shape's [0, 180) ({@link rectangleAngle}). Wrapped, rounded, and wrapped
 * again (18d follow-up): rounded only once it is in range, since the wrap's
 * own float error survives a rounding before it (a shape's typed 192.35 was
 * written 12.349999999999994); and wrapped after, so a turn rounded up to a
 * whole one is upright (359.996 is 0, never 360).
 */
export function keptTurn(degrees: number, within: (degrees: number) => number): number {
  return within(keptTo(within(degrees), GLYPH_ANGLE_PRECISION));
}

/** A star or an eye at `scale` times its print size, held to its range: written only when it is not 1. */
export function withGlyphScale(annotation: KnownDiagramAnnotation, scale: number): KnownDiagramAnnotation {
  const next = glyphScaleWithin(scale);
  const { scale: _was, ...rest } = annotation;
  return next === 1 ? rest : { ...rest, scale: next };
}

/** A star or an eye turned to `degrees` clockwise, within [0, 360): written only when it is turned. */
export function withGlyphAngle(annotation: KnownDiagramAnnotation, degrees: number): KnownDiagramAnnotation {
  const next = glyphAngle(degrees);
  const { angle: _was, ...rest } = annotation;
  return next === 0 ? rest : { ...rest, angle: next };
}

/** A star filled with ink or an outline (R3-4 C, R3-5 A): its fill written only when it is filled, as a white arrow's is. */
export function withStarFill(annotation: KnownDiagramAnnotation, fill: DiagramWhiteArrowFill): KnownDiagramAnnotation {
  return withWhiteArrowLook(annotation, { fill });
}

/**
 * A star or an eye as this build writes it: its centre within reach and `to`
 * on it; a star's fill only when it is filled, and an eye never filled; its
 * turn within [0, 360) and its scale within {@link GLYPH_SCALE}, each dropped
 * when it is no number. The same object when it already is.
 */
function cleanGlyph(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const from = withinReach(annotation.from);
  const { fill: wasFill, angle: wasAngle, scale: wasScale, ...rest } = annotation;
  const fill = annotation.kind === 'star' && wasFill === 'black' ? wasFill : undefined;
  const angle = wasAngle !== undefined && Number.isFinite(wasAngle) ? glyphAngle(wasAngle) : undefined;
  const scale = wasScale !== undefined && Number.isFinite(wasScale) ? glyphScaleWithin(wasScale) : undefined;
  const same =
    samePoint(from, annotation.from) && samePoint(from, annotation.to) && fill === wasFill && angle === wasAngle && scale === wasScale;
  if (same) return annotation;
  return {
    ...rest,
    from,
    to: [from[0], from[1]],
    ...(fill !== undefined ? { fill } : {}),
    ...(angle !== undefined ? { angle } : {}),
    ...(scale !== undefined ? { scale } : {}),
  };
}

/** How far past the frame an annotation may reach, in frame lengths: an arrow may start off the picture. */
export const ANNOTATION_REACH = 4;

/** The shortest arrow or line, as a share of the frame: anything shorter was a slip. */
export const MIN_ANNOTATION_LENGTH = 0.015;

/** The most annotations a step holds: a guard against a file that was never a diagram's. */
export const MAX_STEP_ANNOTATIONS = 500;

/** The most nodes a shaped arrow has: room for any arrow a diagram draws, and a bound on a file's. */
export const MAX_PATH_NODES = 24;

/**
 * How far along its diagonal a right-angle mark's `to` is written, in
 * picture units. Only its direction is read: a move carries it by its
 * corner and the way it opens (`carryAnnotation`), never `to` as a point.
 */
export const RIGHT_ANGLE_DIAGONAL = 0.02;

/**
 * How far inside its angle a right angle's corner is carried by a spread, in
 * picture units: off every edge, on its face, and clear of the stored grid's
 * rounding, which the carry counts as on a corner. A depth spread moves a face
 * whole and takes it back exactly; an affine one costs about this times its
 * amount.
 */
const CORNER_NUDGE = 1e-3;

/**
 * Where a step's marks may lie, in their own units, and the file reader still
 * take them as this build's: a box, `min` to `max` along each axis.
 */
export interface AnnotationReach {
  min: PicturePoint;
  max: PicturePoint;
}

/** A step's reach when it shows its whole picture: {@link ANNOTATION_REACH} frames about its frame, each way. */
export const PICTURE_REACH: AnnotationReach = {
  min: [-ANNOTATION_REACH, -ANNOTATION_REACH],
  max: [ANNOTATION_REACH, ANNOTATION_REACH],
};

/** The reach marks are cleaned and carried within: a picture's, but while {@link withAnnotationReach} runs. */
let activeReach: AnnotationReach = PICTURE_REACH;

/**
 * `run`, with every mark it cleans or carries kept within `reach` rather than
 * a whole picture's: an enlarged step's marks are in its window's units, and
 * may lie as far off as the whole picture's (`zoomModel.windowReach`), kept
 * where they are though not drawn.
 */
export function withAnnotationReach<T>(reach: AnnotationReach, run: () => T): T {
  const was = activeReach;
  activeReach = reach;
  try {
    return run();
  } finally {
    activeReach = was;
  }
}

/**
 * How many of `reach`'s units a picture's frame spans: one in a whole
 * picture's, more in an enlarged step's window's, whose reach is the whole
 * picture's in the window's units (`zoomModel.windowReach`). A size that is
 * held to the picture's frame — an area's side or radius — reaches this many
 * times as far in those units, so a mark carried into a window and back
 * keeps its size, as a point keeps its place.
 */
export function unitsPerFrame(reach: AnnotationReach = activeReach): number {
  const span = (axis: 0 | 1) => (reach.max[axis] - reach.min[axis]) / (PICTURE_REACH.max[axis] - PICTURE_REACH.min[axis]);
  return Math.max(1, span(0), span(1));
}

/** Whether a point lies within `reach`: where the file reader takes it as this build's. */
export function isWithinReach([x, y]: PicturePoint, reach: AnnotationReach = PICTURE_REACH): boolean {
  return x >= reach.min[0] && x <= reach.max[0] && y >= reach.min[1] && y <= reach.max[1];
}

/** A point kept within reach — a whole picture's, or the step's being edited — where the file reader takes it as this build's. */
export function withinReach([x, y]: PicturePoint, reach: AnnotationReach = activeReach): PicturePoint {
  return [Math.min(reach.max[0], Math.max(reach.min[0], x)), Math.min(reach.max[1], Math.max(reach.min[1], y))];
}

/**
 * An annotation as this build writes it: its points within reach, a sign or
 * a label at one point, a label's or a callout's text clean for XML and no
 * longer than a label may be, an arrow's bulge within a half circle, a
 * shaped arrow's path as the reader takes it ({@link cleanPath}). The same
 * object when it already is.
 */
export function cleanAnnotation(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  return cleanTextStyle(cleanColor(cleanBehind(cleanShape(annotation))));
}

/**
 * Whether two annotations say the same, field for field, whatever order their
 * keys are in and with a field set to nothing the same as one left out: what
 * tells an edit from a control pressed on the value it already shows, and a
 * mark a References card brought changed from one left as it came (17d).
 */
export function sameAnnotation(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameAnnotation(value, b[index]));
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const fields = (value: object) => Object.entries(value).filter(([, field]) => field !== undefined);
  const [fa, fb] = [fields(a), new Map(fields(b))];
  return fa.length === fb.size && fa.every(([key, field]) => fb.has(key) && sameAnnotation(field, fb.get(key)));
}

/** A mark's colour kept only where its kind has one, and one a mark can store: the same mark when it already is. */
function cleanColor(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (annotation.color === undefined) return annotation;
  return carriesColor(annotation.kind) && isAnnotationColor(annotation.color) ? annotation : withColor(annotation, null);
}

function cleanShape(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  // A return is a fold-and-unfold arrow's shaped by hand, back along its path: without one, it goes.
  if (annotation.back !== undefined && (annotation.kind !== 'fold-unfold-arrow' || annotation.path === undefined)) {
    const { back: _dropped, ...rest } = annotation;
    return cleanShape(rest);
  }
  // A white arrow is always a path: one without is laid straight between its ends.
  if (annotation.path === undefined && isAlwaysPath(annotation.kind)) {
    return cleanShape(withPath(annotation, straightPath(annotation.from, annotation.to)));
  }
  if (annotation.path !== undefined) {
    const path = canBeShaped(annotation.kind) ? cleanPath(annotation.path) : null;
    if (path) {
      const ends = endsOf(path);
      // A return as the reader takes it too, from the tip; one this build would not write is derived again.
      const back = annotation.back && cleanPath(annotation.back);
      const clean =
        path === annotation.path &&
        back === annotation.back &&
        (!back || samePoint(back[0]!.at, ends.to)) &&
        annotation.bend === undefined &&
        samePoint(annotation.from, ends.from) &&
        samePoint(annotation.to, ends.to);
      if (clean) return annotation;
      const { back: _was, ...arrow } = annotation;
      return withPath(back ? { ...arrow, back } : arrow, path);
    }
    // A path this build would not write: the arrow is an arc again, its return derived.
    const { path: _dropped, back: _back, ...arc } = annotation;
    return cleanShape(isArrowKind(arc.kind) ? { ...arc, bend: arc.bend ?? ARROW_BEND } : arc);
  }
  if (isCornerKind(annotation.kind)) return cleanCorner(annotation);
  if (isAngleKind(annotation.kind)) return cleanAngle(annotation);
  if (annotation.kind === 'divisions') return cleanDivisions(annotation);
  if (annotation.kind === 'close-up') return cleanCloseUp(annotation);
  if (annotation.kind === 'zoom') return cleanZoom(annotation);
  if (annotation.kind === 'star' || annotation.kind === 'eye') return cleanGlyph(annotation);
  if (isAreaKind(annotation.kind)) return cleanArea(annotation);
  if (annotation.kind === 'x-ray') return cleanXRay(annotation);
  const from = withinReach(annotation.from);
  const to = isPointKind(annotation.kind) ? from : withinReach(annotation.to);
  const text = annotation.text === undefined ? undefined : cleanLabelText(annotation.text);
  const bend = cleanBend(annotation.bend);
  if (samePoint(from, annotation.from) && samePoint(to, annotation.to) && text === annotation.text && bend === annotation.bend) {
    return annotation;
  }
  return {
    ...annotation,
    from,
    to: [to[0], to[1]],
    ...(text !== undefined ? { text } : {}),
    ...(bend !== undefined ? { bend } : {}),
  };
}

/**
 * A right-angle mark as this build writes it: its corner within reach, and
 * `to` {@link RIGHT_ANGLE_DIAGONAL} along the way it opens, within reach too
 * — the corner drawn in, should it lie so near reach's edge that `to` would
 * pass it, so the way it opens is kept. The same object when it already is.
 */
function cleanCorner(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const from = withinReach(annotation.from);
  const length = Math.hypot(annotation.to[0] - annotation.from[0], annotation.to[1] - annotation.from[1]);
  const written =
    samePoint(from, annotation.from) &&
    Math.abs(length - RIGHT_ANGLE_DIAGONAL) <= 1e-12 &&
    samePoint(withinReach(annotation.to), annotation.to);
  if (written) return annotation;
  return { ...annotation, ...rightAngleAt(from, rightAngleDiagonal(annotation)) };
}

/**
 * How far along each arm an angle mark keeps the point that says which way
 * the arm runs: only its direction is read, as a right angle's diagonal's
 * is, and kept this near its vertex the point is within reach wherever the
 * vertex is.
 */
export const ANGLE_MARK_ARM = RIGHT_ANGLE_DIAGONAL;

/** An angle mark's ticks across each half, as written: one, two or three. */
export const ANGLE_MARK_TICKS: readonly DiagramTicks[] = [1, 2, 3];

/**
 * An angle mark's two arms, each a unit direction from its vertex; null when
 * one has none, or they lie along one line — there is no angle to mark.
 */
export function angleMarkArms(
  annotation: Pick<KnownDiagramAnnotation, 'from' | 'to' | 'other'>
): [PicturePoint, PicturePoint] | null {
  const { from, other } = annotation;
  if (!other) return null;
  const unit = ([x, y]: PicturePoint): PicturePoint | null => {
    const length = Math.hypot(x - from[0], y - from[1]);
    return length > 0 ? [(x - from[0]) / length, (y - from[1]) / length] : null;
  };
  const first = unit(annotation.to);
  const second = unit(other);
  if (!first || !second || Math.abs(first[0] * second[1] - first[1] * second[0]) < 1e-9) return null;
  return [first, second];
}

/**
 * An angle mark at `vertex` between the arms toward `first` and `second`, as
 * this build writes one: its vertex within reach, each arm's point
 * {@link ANGLE_MARK_ARM} along it. Null when they make no angle.
 */
export function angleMarkAt(
  vertex: PicturePoint,
  first: PicturePoint,
  second: PicturePoint
): Pick<KnownDiagramAnnotation, 'from' | 'to' | 'other'> | null {
  const arms = angleMarkArms({ from: vertex, to: first, other: second });
  if (!arms) return null;
  const from = withinReach(vertex);
  const along = ([x, y]: PicturePoint): [number, number] => {
    const [u, v] = withinReach([from[0] + x * ANGLE_MARK_ARM, from[1] + y * ANGLE_MARK_ARM]);
    return [u, v];
  };
  return { from, to: along(arms[0]), other: along(arms[1]) };
}

/**
 * An angle mark as this build writes it ({@link angleMarkAt}), its ticks one
 * of three; one with no angle is left as it is — the reader refuses it, and
 * no drawing makes one. The same object when it already is.
 */
function cleanAngle(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const placed = angleMarkAt(annotation.from, annotation.to, annotation.other ?? annotation.to);
  if (!placed) return annotation;
  const ticks = annotation.ticks === undefined || ANGLE_MARK_TICKS.includes(annotation.ticks) ? annotation.ticks : 1;
  const written =
    samePoint(placed.from, annotation.from) &&
    samePoint(placed.to, annotation.to) &&
    annotation.other !== undefined &&
    samePoint(placed.other!, annotation.other) &&
    ticks === annotation.ticks;
  if (written) return annotation;
  const { ticks: _ticks, ...rest } = annotation;
  return { ...rest, ...placed, ...(ticks !== undefined ? { ticks } : {}) };
}

/**
 * Equal divisions' parts (ED5): two to thirty-two — the largest
 * box-pleating grid commonly marked; past it a printed mark is a ruler — and
 * the sketch's four for a new mark.
 */
export const DIVISIONS_PARTS = { min: 2, max: 32, laid: 4 } as const;

/**
 * How far equal divisions' line is set off the line they measure, in mm as
 * it prints (ED3): none, where the dividers straddle it — the template's
 * |\|\| symbol — to 15; a new mark's 2.5, the sketch's at the 50 mm a canvas
 * and a card draw at; the Layers pane's steps of 0.5, which Shift holds a
 * drag to; and the tenth a drag and a typed value are kept to.
 */
export const DIVISIONS_OFFSET_MM = { min: 0, max: 15, laid: 2.5, step: 0.5, precision: 0.1 } as const;

/** Equal divisions' parts, whole and within {@link DIVISIONS_PARTS}; the laid count for one that is no number. */
export function divisionsParts(value: number): number {
  if (!Number.isFinite(value)) return DIVISIONS_PARTS.laid;
  return Math.min(DIVISIONS_PARTS.max, Math.max(DIVISIONS_PARTS.min, Math.round(value)));
}

/**
 * Equal divisions' offset held to its range (in mm) and kept to a tenth —
 * or, with `halves`, as Shift holds a drag, to a half.
 */
export function divisionsOffsetWithin(offset: number, halves = false): number {
  if (!Number.isFinite(offset)) return DIVISIONS_OFFSET_MM.laid;
  const step = halves ? DIVISIONS_OFFSET_MM.step : DIVISIONS_OFFSET_MM.precision;
  const kept = Math.round(offset / step) * step;
  return Math.min(DIVISIONS_OFFSET_MM.max, Math.max(DIVISIONS_OFFSET_MM.min, Number(kept.toFixed(1))));
}

/** Equal divisions' parts as drawn: a file's always says; a guard puts down the laid count. */
export function divisionsPartsOf({ parts }: Pick<KnownDiagramAnnotation, 'parts'>): number {
  return parts ?? DIVISIONS_PARTS.laid;
}

/** Equal divisions' offset as drawn, in mm: a file's always says; a guard puts down the laid one. */
export function divisionsOffsetOf({ offset }: Pick<KnownDiagramAnnotation, 'offset'>): number {
  return offset ?? DIVISIONS_OFFSET_MM.laid;
}

/**
 * How far out equal divisions' line must stand, in mm as it prints, for
 * Short Dividers to change how they are drawn (R3-2 A): a divider's
 * overshoot past the line, about 1.65 mm. The note under the switch says
 * this number, so it cannot drift from the rule.
 */
export const SHORT_DIVIDERS_FROM_MM = DIAGRAM_DIVISIONS_INK.overshoot * ANNOTATION_INK_MM;

/**
 * Whether Short Dividers changes how equal divisions `offset` mm off their
 * line are drawn (R3-2 A): only once the line stands further out than
 * {@link SHORT_DIVIDERS_FROM_MM}. Nearer, every divider already straddles
 * the line that far either side, short or not (`divisionsShape`).
 */
export function shortDividersShow(offset: number): boolean {
  return offset > SHORT_DIVIDERS_FROM_MM;
}

/**
 * Whether new equal divisions measuring the line from `from` to `to` lie to
 * its left (`mirrored`): on the side away from the frame's middle — off the
 * paper when the line is an edge — as a callout's box goes; to the right of
 * the way it runs on a line through the middle.
 */
export function divisionsAwayFromMiddle(from: PicturePoint, to: PicturePoint, frame: PictureFrame): boolean {
  const right: PicturePoint = [-(to[1] - from[1]), to[0] - from[0]];
  const length = Math.hypot(right[0], right[1]);
  if (!(length > 0)) return false;
  const middle: PicturePoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const toward = ((frame.width / 2 - middle[0]) * right[0] + (frame.height / 2 - middle[1]) * right[1]) / length;
  // Off a line through the middle by less than a hair: it is through it.
  return toward > 1e-9;
}

/**
 * Equal divisions with their line `offset` mm off the one they measure, held
 * and kept as {@link divisionsOffsetWithin} holds them; `side`, where given,
 * the side it lies on (`mirrored`).
 */
export function withDivisionsOffset(
  annotation: KnownDiagramAnnotation,
  offset: number,
  { halves = false, mirrored }: { halves?: boolean; mirrored?: boolean } = {}
): KnownDiagramAnnotation {
  const placed = { ...annotation, offset: divisionsOffsetWithin(offset, halves) };
  return mirrored === undefined ? placed : withSide(placed, mirrored);
}

/** Equal divisions in `parts` parts, held to their range ({@link divisionsParts}). */
export function withParts(annotation: KnownDiagramAnnotation, parts: number): KnownDiagramAnnotation {
  return { ...annotation, parts: divisionsParts(parts) };
}

/** Equal divisions printing their count, or not: `numbered` written only when true (ED6). */
export function withNumbered(annotation: KnownDiagramAnnotation, numbered: boolean): KnownDiagramAnnotation {
  const { numbered: _was, ...rest } = annotation;
  return numbered ? { ...rest, numbered: true } : rest;
}

/**
 * Equal divisions whose dividers between their ends are short strokes across
 * their line, or run to the line they measure: `shortDividers` written only
 * when true (Revision 3, R3-1 A).
 */
export function withShortDividers(annotation: KnownDiagramAnnotation, short: boolean): KnownDiagramAnnotation {
  const { shortDividers: _was, ...rest } = annotation;
  return short ? { ...rest, shortDividers: true } : rest;
}

/**
 * Equal divisions as this build writes them: their ends within reach, their
 * parts whole and in range, their offset in range — never rounded, so a value
 * the reader takes is written back as it was — their ticks one of three, and
 * `mirrored`, `numbered` and `shortDividers` only when true. The same object
 * when they already are.
 */
function cleanDivisions(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const from = withinReach(annotation.from);
  const to = withinReach(annotation.to);
  const parts = divisionsParts(divisionsPartsOf(annotation));
  const was = divisionsOffsetOf(annotation);
  const offset = Number.isFinite(was) ? Math.min(DIVISIONS_OFFSET_MM.max, Math.max(DIVISIONS_OFFSET_MM.min, was)) : DIVISIONS_OFFSET_MM.laid;
  const ticks = annotation.ticks === undefined || ANGLE_MARK_TICKS.includes(annotation.ticks) ? annotation.ticks : undefined;
  const written =
    samePoint(from, annotation.from) &&
    samePoint(to, annotation.to) &&
    parts === annotation.parts &&
    offset === annotation.offset &&
    ticks === annotation.ticks &&
    (annotation.mirrored === undefined || annotation.mirrored === true) &&
    (annotation.numbered === undefined || annotation.numbered === true) &&
    (annotation.shortDividers === undefined || annotation.shortDividers === true);
  if (written) return annotation;
  const { ticks: _ticks, mirrored, numbered, shortDividers, ...rest } = annotation;
  return {
    ...rest,
    from,
    to: [to[0], to[1]],
    parts,
    offset,
    ...(ticks !== undefined ? { ticks } : {}),
    ...(mirrored === true ? { mirrored: true as const } : {}),
    ...(numbered === true ? { numbered: true as const } : {}),
    ...(shortDividers === true ? { shortDividers: true as const } : {}),
  };
}

/**
 * Whether equal divisions draw alike on either side of their line: lying on
 * it, with no count beside it — the template's symbol, its dividers
 * straddling the line evenly and its ticks leaning as the page sets them.
 */
function divisionsAlikeEitherSide(annotation: KnownDiagramAnnotation): boolean {
  return !(divisionsOffsetOf(annotation) > 0) && annotation.numbered !== true;
}

/**
 * What equal divisions draw, whichever way they were laid: the line they
 * measure as its two ends in order, the side their line lies on as a
 * direction on the picture — none for divisions alike on either side — and
 * what they say. Two that draw alike have the same — a mark flipped along
 * its own line, its ends swapped and its side turned over, draws as it did.
 */
function divisionsFootprint(annotation: KnownDiagramAnnotation): number[] {
  const { from, to } = annotation;
  const [a, b] = from[0] < to[0] || (from[0] === to[0] && from[1] <= to[1]) ? [from, to] : [to, from];
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const sign = divisionsAlikeEitherSide(annotation) ? 0 : annotation.mirrored === true ? -1 : 1;
  const side = [(-(to[1] - from[1]) / length) * sign, ((to[0] - from[0]) / length) * sign];
  return [
    ...a,
    ...b,
    ...side,
    divisionsPartsOf(annotation),
    divisionsOffsetOf(annotation),
    annotation.ticks ?? 1,
    annotation.numbered === true ? 1 : 0,
  ];
}

/**
 * The unit direction a right-angle mark opens in, from its corner along the
 * diagonal into the angle; {@link DEFAULT_RIGHT_ANGLE_DIAGONAL} for one whose
 * `to` is its corner, which opens no way.
 */
export function rightAngleDiagonal({ from, to }: Pick<KnownDiagramAnnotation, 'from' | 'to'>): PicturePoint {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(length > 0)) return [DEFAULT_RIGHT_ANGLE_DIAGONAL[0], DEFAULT_RIGHT_ANGLE_DIAGONAL[1]];
  return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
}

/** Up and to the right, as the page shows it: a square in the corner of an ∟. */
export const DEFAULT_RIGHT_ANGLE_DIAGONAL: PicturePoint = [Math.SQRT1_2, -Math.SQRT1_2];

/**
 * A right-angle mark's two points, its corner at `corner` and opening along
 * `direction` (any length; the default way for none): `to`
 * {@link RIGHT_ANGLE_DIAGONAL} along it. Both within reach — at reach's very
 * edge the corner is drawn in rather than the way it opens turned.
 */
export function rightAngleAt(corner: PicturePoint, direction: PicturePoint): { from: PicturePoint; to: PicturePoint } {
  const length = Math.hypot(direction[0], direction[1]);
  const [ux, uy] = length > 0 ? [direction[0] / length, direction[1] / length] : DEFAULT_RIGHT_ANGLE_DIAGONAL;
  const at = withinReach(corner);
  const ahead: PicturePoint = [at[0] + RIGHT_ANGLE_DIAGONAL * ux, at[1] + RIGHT_ANGLE_DIAGONAL * uy];
  const to = withinReach(ahead);
  // The corner as it was put, to the bit, wherever `to` was not drawn in: a snapped corner stays on its point.
  if (samePoint(to, ahead)) return { from: at, to };
  return { from: [to[0] - RIGHT_ANGLE_DIAGONAL * ux, to[1] - RIGHT_ANGLE_DIAGONAL * uy], to };
}

/**
 * A right-angle mark turned a quarter clockwise about its corner, as the page
 * shows it: into the next quadrant of a crossing, where a drag or a click
 * found the wrong one. Anything else as it was.
 */
export function turnRightAngle(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (!isCornerKind(annotation.kind)) return annotation;
  const [dx, dy] = rightAngleDiagonal(annotation);
  // A quarter turn clockwise with y down: (x, y) to (−y, x).
  return { ...annotation, ...rightAngleAt(annotation.from, [-dy, dx]) };
}

/**
 * A path as the file reader takes it for this build's: its nodes and handles
 * within reach — a node brought in carries its handles with it, and a handle
 * is drawn in along itself, so a smooth node stays smooth — no handle before
 * the tail or after the tip, a corner only where two segments meet, and no
 * more than {@link MAX_PATH_NODES} nodes, the extras taken out of its middle
 * (no edit makes more). The same array when it already is; null for fewer
 * than two.
 */
export function cleanPath(path: readonly DiagramPathNode[]): DiagramPathNode[] | null {
  if (path.length < 2) return null;
  const kept = path.length > MAX_PATH_NODES ? [...path.slice(0, MAX_PATH_NODES - 1), path[path.length - 1]!] : path;
  let changed = kept !== path;
  const last = kept.length - 1;
  const nodes = kept.map((node, index) => {
    const at = withinReach(node.at);
    const moved = !samePoint(at, node.at);
    const handle = (side: 'in' | 'out') => {
      const point = node[side];
      const allowed = side === 'in' ? index > 0 : index < last;
      if (!point || !allowed) return undefined;
      // Moved with its node, as a drag of the node moves it.
      const carried: PicturePoint = moved
        ? [point[0] + (at[0] - node.at[0]), point[1] + (at[1] - node.at[1])]
        : point;
      return handleWithinReach(at, carried);
    };
    const clean: DiagramPathNode = { at };
    const inHandle = handle('in');
    const outHandle = handle('out');
    if (inHandle) clean.in = inHandle;
    if (outHandle) clean.out = outHandle;
    if (node.type === 'corner' && index > 0 && index < last) clean.type = 'corner';
    const same =
      samePoint(at, node.at) &&
      sameHandle(clean.in, node.in) &&
      sameHandle(clean.out, node.out) &&
      clean.type === node.type;
    if (same) return node;
    changed = true;
    return clean;
  });
  return changed ? nodes : (path as DiagramPathNode[]);
}

function sameHandle(a: PicturePoint | undefined, b: PicturePoint | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && samePoint(a, b));
}

/**
 * A handle kept within reach without turning it: drawn in along itself
 * toward its node, which is within reach, to where it meets reach's edge.
 */
export function handleWithinReach(at: PicturePoint, handle: PicturePoint): PicturePoint {
  const reach = activeReach;
  if (isWithinReach(handle, reach)) return handle;
  let share = 1;
  for (const axis of [0, 1] as const) {
    const run = handle[axis] - at[axis];
    if (handle[axis] > reach.max[axis]) share = Math.min(share, (reach.max[axis] - at[axis]) / run);
    if (handle[axis] < reach.min[axis]) share = Math.min(share, (reach.min[axis] - at[axis]) / run);
  }
  share = Math.max(0, share);
  return withinReach([at[0] + (handle[0] - at[0]) * share, at[1] + (handle[1] - at[1]) * share]);
}

/** The path straight from `from` to `to`: two nodes, no handles. What a white arrow is laid as. */
export function straightPath(from: PicturePoint, to: PicturePoint): DiagramPathNode[] {
  return [{ at: [from[0], from[1]] }, { at: [to[0], to[1]] }];
}

/** Whether a path runs straight between its ends as it was laid: two nodes, each handle on its node or none. */
export function isStraightPath(path: readonly DiagramPathNode[]): boolean {
  const onNode = (node: DiagramPathNode, side: 'in' | 'out') => {
    const handle = node[side];
    return handle === undefined || samePoint(handle, node.at);
  };
  return path.length === 2 && path.every((node) => onNode(node, 'in') && onNode(node, 'out'));
}

/** A shaped arrow's ends: its first node and its last. */
function endsOf(path: readonly DiagramPathNode[]): { from: PicturePoint; to: PicturePoint } {
  const first = path[0]!.at;
  const last = path[path.length - 1]!.at;
  return { from: [first[0], first[1]], to: [last[0], last[1]] };
}

/**
 * An arrow along `path`, its ends the path's, with no bend: a path is not an
 * arc. A return shaped by hand starts where the path now ends: wherever the tip
 * went, the return goes from it.
 */
export function withPath(annotation: KnownDiagramAnnotation, path: DiagramPathNode[]): KnownDiagramAnnotation {
  const { bend: _arc, ...rest } = annotation;
  const shaped = { ...rest, ...endsOf(path), path };
  return annotation.back ? { ...shaped, back: returnFrom(annotation.back, path[path.length - 1]!.at) } : shaped;
}

/** A return re-anchored at `tip`: its first node put there, its handle moved with it; as it was when it is there. */
export function returnFrom(back: DiagramPathNode[], tip: PicturePoint): DiagramPathNode[] {
  const first = back[0];
  if (!first || samePoint(first.at, tip)) return back;
  return [shiftNode(first, [tip[0] - first.at[0], tip[1] - first.at[1]]), ...back.slice(1)];
}

/**
 * Whether an arrow of `kind` may be shaped by hand (decision 1): the fold
 * arrows and the white arrow; a push, a pleat arrow and a line stay straight.
 * A switch, so a new kind has to say.
 */
export function canBeShaped(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'white-arrow':
      return true;
    case 'pleat-arrow':
    case 'push-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
    case 'label':
    case 'circle':
    case 'star':
    case 'eye':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'divisions':
    case 'close-up':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
      return false;
  }
}

/**
 * Whether every annotation of `kind` is a path (Q13): a white arrow, laid
 * straight and shaped from there, never an arc. A fold arrow is an arc until
 * it is first shaped (decision 2).
 */
export function isAlwaysPath(kind: DiagramAnnotationKind): boolean {
  return ANNOTATION_SHAPES[kind] === 'path';
}

/**
 * Whether an arrow has been shaped by hand: a fold arrow made a path, a white
 * arrow no longer the straight one it was laid as. Reset takes either back;
 * the first edit that shapes one is what `diagram arrow shaped` counts.
 */
export function isShapedArrow(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'path'>): boolean {
  if (!canBeShaped(annotation.kind) || annotation.path === undefined) return false;
  return !isAlwaysPath(annotation.kind) || !isStraightPath(annotation.path);
}

/**
 * Whether an annotation of `kind` carries words — a label's, or a callout's
 * in its box — that the Step pane edits and a page sets in the diagram's
 * fonts. A switch, so a new kind has to say.
 */
export function carriesText(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'label':
    case 'callout':
      return true;
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
    case 'circle':
    case 'star':
    case 'eye':
    case 'right-angle':
    case 'angle-mark':
    case 'divisions':
    case 'close-up':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
      return false;
  }
}

/**
 * Whether an annotation of `kind` has a colour of its own (RM3): a solid line
 * (17a) and a label (17b). Every other mark is drawn in the style's inks, as
 * Annotate's decision 7 has it — a callout too, whose words, box and line
 * would each need one. A switch, so a new kind has to say.
 */
export function carriesColor(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'solid-line':
    case 'label':
      return true;
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'circle':
    case 'star':
    case 'eye':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'divisions':
    case 'close-up':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
      return false;
  }
}

/**
 * A mark in `color`, or in the style's ink for null: written only where its
 * kind has a colour ({@link carriesColor}), and dropped from any other —
 * a solid line made another type of line loses it.
 */
export function withColor(annotation: KnownDiagramAnnotation, color: string | null): KnownDiagramAnnotation {
  const { color: _was, ...rest } = annotation;
  return color !== null && carriesColor(annotation.kind) ? { ...rest, color } : rest;
}

/**
 * Whether an annotation of `kind` has Text's options (17b): Bold, a halo, a
 * size in pt and words hung off its anchor — a label. A callout keeps its
 * look: its words sit in a box sized from them, which a size or a weight
 * would resize, and a halo means nothing in a white box (§4). A switch, so a
 * new kind has to say.
 */
export function carriesTextStyle(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'label':
      return true;
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
    case 'circle':
    case 'star':
    case 'eye':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'divisions':
    case 'close-up':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
      return false;
  }
}

/** A label's look ({@link TextStyle}); a mark with no text options is {@link PLAIN_TEXT_STYLE}. */
export function textStyleOf(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'color' | 'bold' | 'halo' | 'sizePt'>): TextStyle {
  if (!carriesTextStyle(annotation.kind)) return { ...PLAIN_TEXT_STYLE };
  return {
    color: annotation.color ?? null,
    bold: annotation.bold === true,
    halo: annotation.halo === true,
    sizePt: annotation.sizePt ?? null,
  };
}

/**
 * A label in `style`, the options it leaves out as they were: each written
 * only when set — Bold and the halo only true, a size within
 * {@link TEXT_SIZE_PT} — so a label in {@link PLAIN_TEXT_STYLE} is written
 * as every label was before (17b). Any other mark, and a label already in
 * that style, as it was.
 */
export function withTextStyle(annotation: KnownDiagramAnnotation, style: Partial<TextStyle>): KnownDiagramAnnotation {
  if (!carriesTextStyle(annotation.kind)) return annotation;
  const was = textStyleOf(annotation);
  const next = { ...was, ...style };
  if (sameTextStyle(next, was)) return annotation;
  const { color: _color, bold: _bold, halo: _halo, sizePt: _size, ...rest } = annotation;
  return {
    ...rest,
    ...(next.color !== null ? { color: next.color } : {}),
    ...(next.bold ? { bold: true as const } : {}),
    ...(next.halo ? { halo: true as const } : {}),
    ...(next.sizePt !== null && isTextSizePt(next.sizePt) ? { sizePt: next.sizePt } : {}),
  };
}

/** Whether a label's words hang off its anchor (17b): it has an offset, in pt, from `from`. */
export function isHungText(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'offsetPt'>): boolean {
  return carriesTextStyle(annotation.kind) && annotation.offsetPt !== undefined;
}

/** An offset kept to what a label stores: each axis within {@link TEXT_OFFSET_PT_MAX}; null for one that is not two finite numbers. */
function offsetWithin(offset: readonly number[]): [number, number] | null {
  if (offset.length !== 2 || !offset.every(Number.isFinite)) return null;
  const within = (value: number) => Math.min(TEXT_OFFSET_PT_MAX, Math.max(-TEXT_OFFSET_PT_MAX, value));
  return [within(offset[0]!), within(offset[1]!)];
}

/** A label with its words hung `offsetPt` off its anchor, each axis within reach — or centred on it again, for null. */
export function withLabelOffset(annotation: KnownDiagramAnnotation, offsetPt: readonly [number, number] | null): KnownDiagramAnnotation {
  const { offsetPt: _was, ...rest } = annotation;
  if (offsetPt === null || !carriesTextStyle(annotation.kind)) return rest;
  const kept = offsetWithin(offsetPt);
  return kept ? { ...rest, offsetPt: kept } : rest;
}

/**
 * A label's size, its em, in picture units as the canvas and a card draw the
 * frame (50 mm): its size in pt there, or {@link LABEL_SIZE} of the frame.
 */
export function labelSize(annotation: Pick<KnownDiagramAnnotation, 'sizePt'>): number {
  return annotation.sizePt !== undefined ? ptInPictureUnits(annotation.sizePt) : LABEL_SIZE;
}

/**
 * Where a label's words are centred, in picture units as the canvas draws
 * the frame: its anchor, or — hung text (17b) — its anchor and its offset,
 * a print length, at the canvas's 50 mm. Where a press finds it.
 */
export function labelCentre(annotation: Pick<KnownDiagramAnnotation, 'from' | 'offsetPt'>): PicturePoint {
  const { from, offsetPt } = annotation;
  if (!offsetPt) return from;
  const unit = ptInPictureUnits(1);
  return [from[0] + offsetPt[0] * unit, from[1] + offsetPt[1] * unit];
}

/**
 * Hung text taken by its words and moved `by`, in picture units on the
 * canvas (17b): the words go by the pointer's travel, in pt at the canvas's
 * 50 mm, and its anchor stays. Any other mark as it was.
 */
export function moveLabelWords(annotation: KnownDiagramAnnotation, by: PicturePoint): KnownDiagramAnnotation {
  if (!annotation.offsetPt || !carriesTextStyle(annotation.kind)) return annotation;
  if (by[0] === 0 && by[1] === 0) return annotation;
  const unit = ptInPictureUnits(1);
  return withLabelOffset(annotation, [annotation.offsetPt[0] + by[0] / unit, annotation.offsetPt[1] + by[1] / unit]);
}

/**
 * A mark's text options kept to what this build writes (17b): none on a mark
 * that has no text options, Bold and a halo only true, a size within its
 * range, an offset two finite numbers within reach. The same mark when it
 * already is.
 */
function cleanTextStyle(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const { bold, halo, sizePt, offsetPt } = annotation;
  if (bold === undefined && halo === undefined && sizePt === undefined && offsetPt === undefined) return annotation;
  const { bold: _bold, halo: _halo, sizePt: _size, offsetPt: _offset, ...plain } = annotation;
  if (!carriesTextStyle(annotation.kind)) return plain;
  const keptSize =
    sizePt === undefined || !Number.isFinite(sizePt)
      ? undefined
      : Math.min(TEXT_SIZE_PT.max, Math.max(TEXT_SIZE_PT.min, sizePt));
  const keptOffset = offsetPt === undefined ? null : offsetWithin(offsetPt);
  const same =
    (bold === undefined || bold === true) &&
    (halo === undefined || halo === true) &&
    keptSize === sizePt &&
    (offsetPt === undefined || (keptOffset !== null && keptOffset[0] === offsetPt[0] && keptOffset[1] === offsetPt[1]));
  if (same) return annotation;
  return {
    ...plain,
    ...(bold === true ? { bold } : {}),
    ...(halo === true ? { halo } : {}),
    ...(keptSize !== undefined ? { sizePt: keptSize } : {}),
    ...(keptOffset !== null ? { offsetPt: keptOffset } : {}),
  };
}

/**
 * The ends a selected annotation offers to take hold of, each shown as a
 * dot: an arrow's or a line's two, a callout's point — its box is taken
 * where it is drawn — and a label's anchor when its words hang off it (17b,
 * {@link isHungText}), as a callout's point; none for any other mark at one
 * point, nor a right angle,
 * which offers its corner and the way it opens instead
 * ({@link rightAngleGrips}), nor an angle mark, moved whole; equal divisions
 * offer the ends of the line they measure. Asked of the annotation, as a
 * label's answer is its own; a switch on its kind, so a new kind has to say.
 */
export function annotationEnds(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'offsetPt'>): readonly ('from' | 'to')[] {
  const { kind } = annotation;
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
    case 'divisions':
      return ['to', 'from'];
    case 'callout':
      return ['from'];
    case 'label':
      return annotation.offsetPt !== undefined ? ['from'] : [];
    case 'turn-over':
    case 'rotate':
    case 'circle':
    case 'star':
    case 'eye':
    case 'right-angle':
    case 'angle-mark':
    case 'close-up':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
      return [];
  }
}

function cleanBend(bend: number | undefined): number | undefined {
  if (bend === undefined) return undefined;
  if (bend === 0 || !Number.isFinite(bend)) return ARROW_BEND;
  return Math.sign(bend) * Math.min(MAX_BEND, Math.abs(bend));
}

/** A label's text as stored: what XML can hold, on one line, at most {@link LABEL_MAX_LENGTH} characters. */
export function cleanLabelText(text: string): string {
  const clean = xmlText(text).replace(/[\r\n]+/g, ' ');
  return clean.length <= LABEL_MAX_LENGTH ? clean : clean.slice(0, LABEL_MAX_LENGTH);
}

function samePoint(a: PicturePoint, b: PicturePoint): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** A wide grapheme: Han, kana, Hangul, and the full-width forms and CJK punctuation. */
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

/**
 * Half a label's width, in the units of `size`, its em — picture units at
 * {@link LABEL_SIZE} unless said — as it is drawn centred on its point: its
 * Latin as wide as the font it is set in sets it (`labelAdvance`), Regular
 * or `bold` (17b), a whole em for a wide grapheme or one that font has no
 * width for; and a fifth of an em past that, more than any Latin glyph's ink
 * stands past its advance (ť's 0.109 em). The canvas cannot measure the text
 * it draws: the hit test, the selection and a file's crop all share this. A
 * halo reaches further still ({@link TEXT_HALO_EMS}): its measurers add it.
 */
export function labelHalfWidth(text: string, { bold = false, size = LABEL_SIZE }: { bold?: boolean; size?: number } = {}): number {
  return size * (Math.max(textEms(text, bold), 0.6) / 2 + 0.2);
}

/**
 * How wide a line of a label's or a callout's text is set, in ems, each
 * grapheme in the font its run is set in (`labelRuns`): Latin as Noto Sans
 * sets it (`labelAdvance`); a digit, a space or a sign among CJK words as
 * the widest CJK font sets it (`cjkRunAdvance`); a whole em for a wide
 * grapheme or one its font has no width for. The one measure a label's reach
 * and a callout's box are both taken from.
 */
export function textEms(text: string, bold = false): number {
  const graphemes = graphemesOf(text);
  // Any CJK key: only whether a grapheme is set in Noto Sans is asked.
  const fonts = scriptFonts(graphemes, textCjkKey(text, 'sc'));
  // A character its run's font has no glyph for is set in the other, which
  // has it, as a page sets it (`coverFonts`): ‱ among CJK words in Noto Sans,
  // ⸻ among Latin ones in a CJK font. Each at the text's weight (17b).
  const latinRunEms = (character: string) => characterEms(character, bold) ?? cjkCharacterEms(character, bold);
  const cjkRunEms = (character: string) => cjkCharacterEms(character, bold) ?? characterEms(character, bold);
  let ems = 0;
  graphemes.forEach((grapheme, index) => {
    ems += graphemeEms(grapheme, fonts[index] === 'latin' ? latinRunEms : cjkRunEms);
  });
  return ems;
}

/** A grapheme's advance in ems, its combining marks included, as `textEms` counts it: each character as `measure` reads it. */
function graphemeEms(grapheme: string, measure: (character: string) => number | null): number {
  if (WIDE.test(grapheme)) return 1;
  let ems = 0;
  let unknown = false;
  for (const character of grapheme) {
    // A joiner or a variation selector draws nothing.
    if (needsNoGlyph(character)) continue;
    const each = measure(character);
    if (each === null) unknown = true;
    else ems += each;
  }
  // One the font has no glyph for is drawn by the browser's fallback as one
  // glyph, however many code points spell it: an emoji's skin tone, a flag's
  // two letters, a family's members.
  return unknown ? Math.max(ems, 1) : ems;
}

/** One character's advance in ems among CJK words, as the widest CJK font sets it at its weight; null where none has it. */
function cjkCharacterEms(character: string, bold: boolean): number | null {
  const advance = cjkRunAdvance(character.codePointAt(0)!, bold);
  return advance === null ? null : advance / 1000;
}

/**
 * One character's advance in ems, as Noto Sans sets it at its weight: its own glyph's, or
 * — for a letter it has no glyph for, as polytonic Greek's ἀ — its
 * decomposition's, a letter and its marks, which is how the font sets it.
 * Null when neither is in the font.
 */
function characterEms(character: string, bold: boolean): number | null {
  const advance = labelAdvance(character.codePointAt(0)!, bold);
  if (advance !== null) return advance / 1000;
  const parts = character.normalize('NFD');
  if (parts === character) return null;
  let ems = 0;
  for (const part of parts) {
    const each = labelAdvance(part.codePointAt(0)!, bold);
    if (each === null) return null;
    ems += each / 1000;
  }
  return ems;
}

export function isArrowKind(kind: DiagramAnnotationKind): boolean {
  return ARROW_KINDS.has(kind);
}

export function isPointKind(kind: DiagramAnnotationKind): boolean {
  return POINT_KINDS.has(kind);
}

export function isAngleKind(kind: DiagramAnnotationKind): boolean {
  return ANGLE_KINDS.has(kind);
}

export function isCornerKind(kind: DiagramAnnotationKind): boolean {
  return CORNER_KINDS.has(kind);
}

/**
 * Whether a click puts an annotation of `kind` down: a point kind's at its
 * point, a right angle's in the corner it is in, a callout's beside its
 * point, a close-up's area round it, an enlarge area a standard size round
 * it, an eye looking at the picture's middle, an oval or a rectangle a
 * standard size round it, an x-ray's window a standard size round it
 * (Revision 3). A drag draws the rest.
 */
export function placedByClick(kind: DiagramAnnotationKind): boolean {
  const shape = ANNOTATION_SHAPES[kind];
  return (
    isPointKind(kind) ||
    isCornerKind(kind) ||
    shape === 'callout' ||
    shape === 'close-up' ||
    shape === 'zoom' ||
    shape === 'sight' ||
    shape === 'area' ||
    shape === 'x-ray'
  );
}

/**
 * A new eye (Revision 3, R3-8 A), put down freely (R3-24 A) at `start`,
 * where the viewer stands, looking toward `end`, what they look at — at any
 * angle, or with `steps` (Shift) held to 15° steps (R3-28 A). A click, or a
 * drag shorter than a slip, looks toward the picture's middle; at the middle
 * itself, right, the way an eye with no `angle` looks. Its turn kept to a
 * hundredth of a degree, written only when it is turned.
 */
export function eyeLooking(
  start: PicturePoint,
  end: PicturePoint,
  frame: PictureFrame,
  { steps = false }: { steps?: boolean } = {},
  newId: DiagramIdFactory = randomDiagramId
): KnownDiagramAnnotation {
  const id = newId('annotation');
  const from = withinReach(start);
  const dragged = Math.hypot(end[0] - from[0], end[1] - from[1]) >= MIN_ANNOTATION_LENGTH;
  const toward: PicturePoint = dragged ? end : [frame.width / 2, frame.height / 2];
  const [dx, dy] = [toward[0] - from[0], toward[1] - from[1]];
  const eye: KnownDiagramAnnotation = { id, kind: 'eye', from: [from[0], from[1]], to: [from[0], from[1]] };
  if (!(Math.hypot(dx, dy) > 1e-9)) return eye;
  const radians = Math.atan2(dy, dx);
  const turned = steps ? snapAngle(radians, TRANSFORM_ROTATION_SNAP_RADIANS) : radians;
  return withGlyphAngle(eye, keptTurn((turned * 180) / Math.PI, glyphAngle));
}

/**
 * The bulge a new fold arrow is given: away from the frame's middle. It was
 * toward it, as References' own arrows bulge (`foldArrowArc`, which draws a
 * References step's arrows and is not this), until Zach found he flipped
 * nearly every arc he drew (2026-10-06). Either way for an arrow through the
 * middle.
 */
export function defaultBend(from: PicturePoint, to: PicturePoint, frame: PictureFrame): number {
  const middle: PicturePoint = [frame.width / 2, frame.height / 2];
  const left = leftNormal(from, to);
  const mid: PicturePoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const toward = (middle[0] - mid[0]) * left[0] + (middle[1] - mid[1]) * left[1];
  // A positive bend bulges to the left of the travel (`arrowApex`): away is the side the middle is not on.
  return toward > 0 ? -ARROW_BEND : ARROW_BEND;
}

/**
 * A new annotation of `kind`, from a drag (`from` → `to`) or a click (`to`
 * ignored for a point kind; for a right angle, the way it opens from its
 * corner `from`). Equal divisions measure the line dragged along, in four
 * parts, their line 2.5 mm off on the side away from the middle. A callout
 * says `calloutText` — the author's language's
 * "Repeat behind" — and one clicked, or dragged shorter than a slip, has its
 * box put beside its point ({@link calloutBeside}). A close-up's drag bounds its
 * area, a click's a corner's worth, and its close-up goes beside the
 * picture ({@link closeUpBeside}).
 */
export function createAnnotation(
  kind: DiagramAnnotationKind,
  start: PicturePoint,
  end: PicturePoint,
  frame: PictureFrame,
  newId: DiagramIdFactory = randomDiagramId,
  calloutText: string = NEW_CALLOUT_TEXT,
  circleMode: CircleDrawingMode = 'bounds'
): KnownDiagramAnnotation {
  const id = newId('annotation');
  if (isCornerKind(kind)) {
    // In the corner `start`, opening toward `end`: the way a drag went, or
    // the way a click on a right angle found; the default way for neither.
    return { id, kind, ...rightAngleAt(start, [end[0] - start[0], end[1] - start[1]]) };
  }
  if (kind === 'eye') return eyeLooking(start, end, frame, {}, () => id);
  // An oval or a rectangle, corner to corner as Enlarge in Frame's area is; a click's standard size (Revision 3).
  if (isAreaKind(kind)) return areaFromCorners(kind, start, end, {}, () => id);
  const from = withinReach(start);
  const to = withinReach(end);
  if (kind === 'circle' || kind === 'zoom' || kind === 'x-ray' || kind === 'close-up') {
    // Bounds uses a dragged square; Center keeps the first point as its centre.
    // A click retains each tool's established default size in either mode.
    const side = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    const click = side < MIN_ZOOM_SIDE;
    const box = areaFromCorners('oval', from, to, { square: true }, () => id);
    const centre = click || circleMode === 'center' ? from : box.from;
    const radius = click
      ? kind === 'close-up' ? DEFAULT_CLOSE_UP_RADIUS : ZOOM_CLICK.radius
      : zoomRadiusWithin(circleMode === 'center' ? Math.hypot(to[0] - from[0], to[1] - from[1]) : box.size![0] / 2);
    const circle: KnownDiagramAnnotation = { id, kind, from: [...centre], to: [...centre], ...(kind !== 'circle' || !click ? { radius } : {}) };
    if (kind === 'x-ray') return { ...circle, depth: XRAY_DEPTH.laid };
    if (kind === 'close-up') return { ...circle, to: closeUpBeside(centre, radius, DEFAULT_CLOSE_UP_SCALE, frame), scale: DEFAULT_CLOSE_UP_SCALE };
    return circle;
  }
  if (kind === 'callout') {
    const text = cleanLabelText(calloutText);
    const short = Math.hypot(to[0] - from[0], to[1] - from[1]) < MIN_ANNOTATION_LENGTH;
    const box = short ? calloutBeside(from, text, frame) : to;
    return { id, kind, from: [from[0], from[1]], to: [box[0], box[1]], text };
  }
  if (isPointKind(kind)) {
    const at: PicturePoint = [from[0], from[1]];
    const base: KnownDiagramAnnotation = { id, kind, from: at, to: [at[0], at[1]] };
    if (kind === 'label') return { ...base, text: NEW_LABEL_TEXT };
    if (kind === 'rotate') return { ...base, rotate: DEFAULT_ROTATION };
    if (kind === 'turn-over') return { ...base, axis: 'vertical' };
    // A circle is its centre and nothing more: no letter (decision 8).
    return base;
  }
  const annotation: KnownDiagramAnnotation = { id, kind, from: [from[0], from[1]], to: [to[0], to[1]] };
  if (kind === 'divisions') {
    // The sketch's four parts and one tick, the line 2.5 mm off on the side
    // away from the picture's middle (ED3, ED5).
    const laid = { ...annotation, parts: DIVISIONS_PARTS.laid, offset: DIVISIONS_OFFSET_MM.laid };
    return withSide(laid, divisionsAwayFromMiddle(from, to, frame));
  }
  // A white arrow is laid straight, to be shaped with Edit Path, in the template's look.
  if (isAlwaysPath(kind)) return { ...withPath(annotation, straightPath(from, to)), ...DEFAULT_WHITE_ARROW };
  return isArrowKind(kind) ? { ...annotation, bend: defaultBend(from, to, frame) } : annotation;
}

/**
 * Where a callout put down with a click has its box: out from its point away
 * from the frame's middle, diagonally — up and to the right from the middle
 * itself — its near corner {@link CALLOUT_GAP} out from the point along each
 * side. Diagrams put such a box beside the model, not on it.
 */
export function calloutBeside(from: PicturePoint, text: string, frame: PictureFrame): PicturePoint {
  const away = (value: number, middle: number, otherwise: 1 | -1) =>
    Math.abs(value - middle) < 1e-9 ? otherwise : Math.sign(value - middle);
  const sx = away(from[0], frame.width / 2, 1);
  const sy = away(from[1], frame.height / 2, -1);
  const { halfWidth, halfHeight } = calloutHalfBox(text);
  return withinReach([from[0] + sx * (halfWidth + CALLOUT_GAP), from[1] + sy * (halfHeight + CALLOUT_GAP)]);
}

/**
 * A callout's letters, as a share of the frame's longer side: a label's
 * size, so the two read alike on a page.
 */
export const CALLOUT_TEXT_SIZE = LABEL_SIZE;
/** The room either side of a callout's words, past their advance, in ems: more than any glyph's ink stands out (ť's 0.109 em). */
export const CALLOUT_PAD_EMS = 0.5;
/**
 * Half a callout's box's height, in ems, about the middle its words are
 * centred on: a line's ink — a capital's accent above, a descender below,
 * Han's em box, none more than 0.6 em from the middle — and room round it.
 */
export const CALLOUT_HALF_HEIGHT_EMS = 0.85;

/**
 * Half a callout's box, in picture units, round the middle of its words: as
 * wide as they are set ({@link textEms}) and a pad, never narrower than a
 * label is, and as tall as a line of them and a pad. The one place a box's
 * size is decided: the drawing, the reach, the hit test and the selection
 * all take it from here.
 */
export function calloutHalfBox(text: string): { halfWidth: number; halfHeight: number } {
  return {
    halfWidth: CALLOUT_TEXT_SIZE * (Math.max(textEms(text), 0.6) / 2 + CALLOUT_PAD_EMS),
    halfHeight: CALLOUT_TEXT_SIZE * CALLOUT_HALF_HEIGHT_EMS,
  };
}

/** A callout as it is drawn, in picture units: its box, and the line from its point to it. */
export interface CalloutShape {
  /** The box round its words, its middle `to`: the inside of its outline, whose pen is drawn outside it. */
  box: { x: number; y: number; width: number; height: number };
  /**
   * The line from the point the callout marks to where it meets the box's
   * outline, on its way to the box's middle; null when the point is inside
   * the box, or on its outline.
   */
  line: readonly [PicturePoint, PicturePoint] | null;
}

/**
 * A callout's shape ({@link CalloutShape}): its box from
 * {@link calloutHalfBox}, its line stopped at the box's edge. Its words are
 * centred on `to`, as a label's are on its point.
 */
export function calloutShape({ from, to, text }: Pick<KnownDiagramAnnotation, 'from' | 'to' | 'text'>): CalloutShape {
  const { halfWidth, halfHeight } = calloutHalfBox(text ?? '');
  const box = { x: to[0] - halfWidth, y: to[1] - halfHeight, width: 2 * halfWidth, height: 2 * halfHeight };
  const dx = from[0] - to[0];
  const dy = from[1] - to[1];
  if (Math.abs(dx) <= halfWidth && Math.abs(dy) <= halfHeight) return { box, line: null };
  // From the box's middle toward the point, the share of the way at which it leaves the box.
  const leaves = Math.min(dx === 0 ? Infinity : halfWidth / Math.abs(dx), dy === 0 ? Infinity : halfHeight / Math.abs(dy));
  return { box, line: [from, [to[0] + dx * leaves, to[1] + dy * leaves]] };
}

/**
 * A callout's box as its outline is stroked, in the units of `box` and its
 * pen `pen`: grown by half the pen on every side, to the stroke's middle, so
 * the pen lies outside the box its words were measured for and never covers
 * them. The drawing strokes it, the selection washes it, and the hit test
 * reaches half a pen past it, to the ink's outer edge.
 */
export function calloutDrawnBox(box: CalloutShape['box'], pen: number): CalloutShape['box'] {
  return { x: box.x - pen / 2, y: box.y - pen / 2, width: box.width + pen, height: box.height + pen };
}

/**
 * How many times larger a close-up draws its area (15f): the range the Step
 * pane and a ring's drag hold it to — less is hardly closer, and more is a
 * detail no diagram draws.
 */
export const CLOSE_UP_SCALE = { min: 1.25, max: 6 } as const;
/** A new close-up's scale, and one's that a file leaves unsaid: twice (decision 12). */
export const DEFAULT_CLOSE_UP_SCALE = 2;
/** What the Step pane steps a scale by, and Shift holds a ring's drag to: halves. */
export const CLOSE_UP_SCALE_STEP = 0.5;
/** The area a click puts down: its radius, in picture units — a flap's corner, near enough. */
export const DEFAULT_CLOSE_UP_RADIUS = 0.08;
/** The smallest area's radius, in picture units: a drag shorter than a slip is a click. */
export const MIN_CLOSE_UP_RADIUS = MIN_ANNOTATION_LENGTH;
/** The largest: an area wider than the picture shows nothing more of it. */
export const MAX_CLOSE_UP_RADIUS = 1;
/** How far clear of the picture's frame a new close-up's ring stands, in picture units. */
export const CLOSE_UP_GAP = 0.05;

/** A close-up's area's radius: a file's always says it; a guard puts down a click's. */
export function closeUpRadius({ radius }: Pick<KnownDiagramAnnotation, 'radius'>): number {
  return radius ?? DEFAULT_CLOSE_UP_RADIUS;
}

/** A close-up's scale, twice when a file leaves it unsaid. */
export function closeUpScale({ scale }: Pick<KnownDiagramAnnotation, 'scale'>): number {
  return scale ?? DEFAULT_CLOSE_UP_SCALE;
}

/** A close-up as it is drawn (15f), in picture units. */
export interface CloseUpShape {
  /** The ring round the area shown larger. */
  area: { centre: PicturePoint; radius: number };
  /** The close-up's ring: the area's, `scale` times larger. */
  inset: { centre: PicturePoint; radius: number };
  scale: number;
  /**
   * The line between the rings, on the line through their centres, from one
   * rim to the other, as Triceratops 73 draws it; null where the rings meet.
   */
  line: readonly [PicturePoint, PicturePoint] | null;
}

/**
 * A close-up's shape ({@link CloseUpShape}). Inside its ring a point of the
 * picture `p` is drawn at `inset.centre + scale × (p − area.centre)`.
 */
export function closeUpShape(annotation: Pick<KnownDiagramAnnotation, 'from' | 'to' | 'radius' | 'scale'>): CloseUpShape {
  const { from, to } = annotation;
  const radius = closeUpRadius(annotation);
  const scale = closeUpScale(annotation);
  const insetRadius = radius * scale;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const apart = Math.hypot(dx, dy);
  const line: CloseUpShape['line'] =
    apart > radius + insetRadius
      ? [
          [from[0] + (dx / apart) * radius, from[1] + (dy / apart) * radius],
          [to[0] - (dx / apart) * insetRadius, to[1] - (dy / apart) * insetRadius],
        ]
      : null;
  return { area: { centre: from, radius }, inset: { centre: to, radius: insetRadius }, scale, line };
}

/**
 * The picture's frame as a close-up draws it (15f), in picture units: `frame`
 * made `scale` times larger about the area's centre, and moved onto the
 * close-up's.
 */
export function closeUpFrame(
  { area, inset, scale }: CloseUpShape,
  frame: PictureFrame
): { x: number; y: number; width: number; height: number } {
  return {
    x: inset.centre[0] - scale * area.centre[0],
    y: inset.centre[1] - scale * area.centre[1],
    width: scale * frame.width,
    height: scale * frame.height,
  };
}

/**
 * Where a new close-up goes (15f): off the picture, its ring
 * {@link CLOSE_UP_GAP} clear of the frame, level with its area — beside a
 * frame as tall as it is wide or taller, where a page has room across it,
 * and above or below a wider one — on the side nearer its area, so the line
 * between them is short.
 */
export function closeUpBeside(centre: PicturePoint, radius: number, scale: number, frame: PictureFrame): PicturePoint {
  const reach = CLOSE_UP_GAP + radius * scale;
  if (frame.width <= frame.height) {
    return withinReach([centre[0] >= frame.width / 2 ? frame.width + reach : -reach, centre[1]]);
  }
  return withinReach([centre[0], centre[1] >= frame.height / 2 ? frame.height + reach : -reach]);
}

/** A close-up's area's radius held to its range, the picture's frame's in the marks' units ({@link unitsPerFrame}); a click's for one that is no number. */
export function closeUpRadiusWithin(radius: number): number {
  if (!Number.isFinite(radius)) return DEFAULT_CLOSE_UP_RADIUS;
  return Math.min(MAX_CLOSE_UP_RADIUS * unitsPerFrame(), Math.max(MIN_CLOSE_UP_RADIUS, radius));
}

/**
 * A close-up's scale held to its range ({@link CLOSE_UP_SCALE}) to a
 * hundredth — or with `halves`, as Shift holds a ring's drag, to a half.
 */
export function closeUpScaleWithin(scale: number, halves = false): number {
  if (!Number.isFinite(scale)) return DEFAULT_CLOSE_UP_SCALE;
  const min = halves ? Math.ceil(CLOSE_UP_SCALE.min * 2) / 2 : CLOSE_UP_SCALE.min;
  const rounded = halves ? Math.round(scale * 2) / 2 : Math.round(scale * 100) / 100;
  return Math.min(CLOSE_UP_SCALE.max, Math.max(min, rounded));
}

/**
 * A close-up resized by one of its rings (15f): the area's to `radius` — the
 * close-up grows with it, its scale kept — or the close-up's to `radius`,
 * which sets its scale ({@link closeUpScaleWithin}).
 */
export function withCloseUpRing(
  annotation: KnownDiagramAnnotation,
  ring: 'from' | 'to',
  radius: number,
  halves = false
): KnownDiagramAnnotation {
  if (ring === 'from') return { ...annotation, radius: closeUpRadiusWithin(radius) };
  return { ...annotation, scale: closeUpScaleWithin(radius / closeUpRadius(annotation), halves) };
}

/** A close-up at `scale`, held to its range: the Step pane's. */
export function withCloseUpScale(annotation: KnownDiagramAnnotation, scale: number): KnownDiagramAnnotation {
  return { ...annotation, scale: closeUpScaleWithin(scale) };
}

/**
 * A close-up as this build writes it: its centres within reach, and its
 * area's radius and its scale within their ranges, an unsaid scale left
 * unsaid — never rounded, so a value the reader takes is written back as it
 * was. The same object when it already is.
 */
function cleanCloseUp(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const from = withinReach(annotation.from);
  const to = withinReach(annotation.to);
  const radius = closeUpRadiusWithin(closeUpRadius(annotation));
  const scale =
    annotation.scale === undefined
      ? undefined
      : Number.isFinite(annotation.scale)
        ? Math.min(CLOSE_UP_SCALE.max, Math.max(CLOSE_UP_SCALE.min, annotation.scale))
        : DEFAULT_CLOSE_UP_SCALE;
  const same =
    samePoint(from, annotation.from) && samePoint(to, annotation.to) && radius === annotation.radius && scale === annotation.scale;
  return same ? annotation : { ...annotation, from, to, radius, ...(scale !== undefined ? { scale } : {}) };
}

/**
 * An enlarge area's Size (Revision 2): how many times the area as it prints
 * the steps enlarged from it print, when it is fixed rather than Fill — the
 * close-up's range.
 */
export const ZOOM_SCALE = CLOSE_UP_SCALE;
/** An enlarge area's circle: its radius, in picture units, as a close-up's area's range. */
export const ZOOM_RADIUS = { min: MIN_CLOSE_UP_RADIUS, max: MAX_CLOSE_UP_RADIUS } as const;
/** An enlarge area's rounded rectangle: each side, in picture units — up to twice the frame, about any centre. */
export const ZOOM_SIDE = { min: MIN_ANNOTATION_LENGTH, max: 2 } as const;
/** The smallest area's radius or side: a drag shorter than a slip is a click. */
export const MIN_ZOOM_SIDE = MIN_ANNOTATION_LENGTH;
/** The area a click puts down, in picture units: a circle of this radius, or a square of this size. */
export const ZOOM_CLICK = { radius: 0.15, size: [0.3, 0.3] as const } as const;

/** An enlarge area's circle's radius held to its range, as a close-up's is; a click's for one that is no number. */
export function zoomRadiusWithin(radius: number): number {
  if (!Number.isFinite(radius)) return ZOOM_CLICK.radius;
  return Math.min(ZOOM_RADIUS.max * unitsPerFrame(), Math.max(ZOOM_RADIUS.min, radius));
}

/** One side of an enlarge area's rounded rectangle held to its range, as a close-up's radius is; a click's for one that is no number. */
export function zoomSideWithin(side: number): number {
  if (!Number.isFinite(side)) return ZOOM_CLICK.size[0];
  return Math.min(ZOOM_SIDE.max * unitsPerFrame(), Math.max(ZOOM_SIDE.min, side));
}

/** An angle, in degrees, as a rectangle reads it: a half turn is no turn, so within [0, 180). */
export function rectangleAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const turned = degrees % 180;
  // A hair under no turn, -1e-14, rounds to 180 itself once a half turn is added: that is no turn too.
  const within = turned < 0 ? turned + 180 : turned;
  return within >= 180 ? 0 : within;
}

/**
 * An enlarge area as this build writes it (Revision 2): its centre within
 * reach and `to` on it; exactly one of a circle's `radius` and a rounded
 * rectangle's `size`, each in its range — a circle when it has a radius,
 * else a rectangle, else the click's circle; a turn only on a rectangle, as
 * it was written; a Size in its range, unsaid left unsaid; an edge and an
 * anchor only when they read. Never rounded, so a value the reader takes is
 * written back as it was. The same object when it already is.
 */
function cleanZoom(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const from = withinReach(annotation.from);
  const { radius: wasRadius, size: wasSize, angle: wasAngle, scale: wasScale, edge: wasEdge, anchor: wasAnchor, ...rest } = annotation;
  const sized = wasRadius === undefined && wasSize !== undefined;
  const radius = sized ? undefined : zoomRadiusWithin(wasRadius ?? ZOOM_CLICK.radius);
  const size: [number, number] | undefined = sized ? [zoomSideWithin(wasSize[0]), zoomSideWithin(wasSize[1])] : undefined;
  const angle = sized && wasAngle !== undefined && Number.isFinite(wasAngle) ? wasAngle : undefined;
  const scale =
    wasScale === undefined
      ? undefined
      : Number.isFinite(wasScale)
        ? Math.min(ZOOM_SCALE.max, Math.max(ZOOM_SCALE.min, wasScale))
        : undefined;
  const edge = wasEdge === 'cut' || wasEdge === 'whole' ? wasEdge : undefined;
  const anchor =
    wasAnchor !== undefined && Number.isFinite(wasAnchor[0]) && Number.isFinite(wasAnchor[1]) ? wasAnchor : undefined;
  const same =
    samePoint(from, annotation.from) &&
    samePoint(from, annotation.to) &&
    radius === wasRadius &&
    (size === undefined ? wasSize === undefined : wasSize !== undefined && samePoint(size, wasSize)) &&
    angle === wasAngle &&
    scale === wasScale &&
    edge === wasEdge &&
    anchor === wasAnchor;
  if (same) return annotation;
  return {
    ...rest,
    from,
    to: [from[0], from[1]],
    ...(radius !== undefined ? { radius } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(angle !== undefined ? { angle } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(edge !== undefined ? { edge } : {}),
    ...(anchor !== undefined ? { anchor } : {}),
  };
}

/**
 * An enlarge area carried with the paper (Revision 2), as a close-up's area
 * is: its centre with the face under it, its size as the move scales the
 * picture as a whole — never stretched with whatever face a spread moves
 * under its rim — and a rounded rectangle's turn with the move's, at any
 * angle: its long side goes where the move takes the way it ran, which a
 * mirror turns over with the side. Its anchor is on the paper, which no move
 * of the picture moves.
 */
function carryZoom(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  if (annotation.size !== undefined && annotation.radius === undefined) return carryArea(annotation, move);
  const carried = withinReach(move.point(annotation.from));
  const [rx, ry] = carriedVector(annotation.from, move, [closeUpRadius(annotation), 0]);
  return { ...annotation, from: carried, to: [carried[0], carried[1]], radius: zoomRadiusWithin(Math.hypot(rx, ry)) };
}

/**
 * An area with a `size` carried with the paper: an enlarge area's rounded
 * rectangle (Revision 2), and an oval or a rectangle (Revision 3, its math
 * shared). Its centre goes with the face under it; its size by the move's
 * scale as a whole — never stretched with whatever face a spread moves under
 * its rim — each side held to its range; and its turn with the move's, at
 * any angle: its long side goes where the move takes the way it ran, which a
 * mirror turns over with the side, its angle negated. Within [0, 180), as a
 * half turn draws it the same, and written only when it is turned.
 */
function carryArea(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  const { from, size } = annotation;
  const carried = withinReach(move.point(from));
  const radians = ((annotation.angle ?? 0) * Math.PI) / 180;
  const [ux, uy] = carriedVector(from, move, [Math.cos(radians), Math.sin(radians)]);
  const stretch = Math.hypot(ux, uy);
  const [width, height] = size ?? [ZOOM_CLICK.size[0], ZOOM_CLICK.size[1]];
  const { angle: _was, ...rest } = annotation;
  // To a billionth of a degree: a quarter turn is 90, not 90.00000000000001.
  const angle = rectangleAngle(Number(((Math.atan2(uy, ux) * 180) / Math.PI).toFixed(9)));
  return {
    ...rest,
    from: carried,
    to: [carried[0], carried[1]],
    size: [zoomSideWithin(width * stretch), zoomSideWithin(height * stretch)],
    ...(angle !== 0 ? { angle } : {}),
  };
}

/** `vector` at `from` as a move carries it: its own `vector`, or where it takes a step along it. */
function carriedVector(from: PicturePoint, move: PictureMove, vector: PicturePoint): PicturePoint {
  if (move.vector) return move.vector(vector);
  const [x0, y0] = move.point(from);
  const [x1, y1] = move.point([from[0] + vector[0], from[1] + vector[1]]);
  return [x1 - x0, y1 - y0];
}

/**
 * How far an oval's or a rectangle's sides go, in picture units (Revision 3,
 * R3-30b A): an enlarge area's, from a slip to twice the picture's frame,
 * about any centre — held as a drag goes ({@link zoomSideWithin}), and past
 * it in a file a newer build's. One rule for both kinds of area.
 */
export const AREA_SIDE = ZOOM_SIDE;

/**
 * A new area dragged corner to corner: an enlarge area's rounded rectangle
 * (Revision 2, Enlarge in Frame), or an oval or a rectangle (Revision 3) —
 * `square` making it square on its longer side, an oval a circle, and
 * `fromMiddle` drawing it out from its centre. A drag shorter than a
 * twentieth of a click's either way puts down a click's square at `start`.
 * Put down where the pointer is: nothing snaps (R3-24 A).
 */
export function areaFromCorners(
  kind: 'zoom' | 'oval' | 'rectangle',
  start: PicturePoint,
  end: PicturePoint,
  { square = false, fromMiddle = false }: { square?: boolean; fromMiddle?: boolean } = {},
  newId: DiagramIdFactory = randomDiagramId
): KnownDiagramAnnotation {
  const id = newId('annotation');
  let dx = end[0] - start[0];
  let dy = end[1] - start[1];
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  const scale = fromMiddle ? 2 : 1;
  const [width, height] = [Math.abs(dx) * scale, Math.abs(dy) * scale];
  const centre: PicturePoint = fromMiddle ? start : [start[0] + dx / 2, start[1] + dy / 2];
  const clicked = Math.min(width, height) < ZOOM_CLICK.size[0] / 20;
  const size: [number, number] = clicked
    ? [ZOOM_CLICK.size[0], ZOOM_CLICK.size[1]]
    : [zoomSideWithin(width), zoomSideWithin(height)];
  const at = withinReach(clicked ? start : centre);
  return { id, kind, from: at, to: [at[0], at[1]], size };
}

/**
 * An oval or a rectangle set to a box (Revision 3): centred on `centre`
 * within reach, its sides `size` held to {@link AREA_SIDE}, its turn as it
 * was. What its transform box's squares write.
 */
export function withAreaBox(annotation: KnownDiagramAnnotation, centre: PicturePoint, size: readonly [number, number]): KnownDiagramAnnotation {
  const at = withinReach(centre);
  return { ...annotation, from: at, to: [at[0], at[1]], size: [zoomSideWithin(size[0]), zoomSideWithin(size[1])] };
}

/**
 * An oval or a rectangle turned to `degrees` clockwise (Revision 3), kept
 * within [0, 180) to a hundredth of a degree as a glyph's turn is
 * ({@link keptTurn}): a half turn draws it the same. Written only when it is
 * turned.
 */
export function withAreaAngle(annotation: KnownDiagramAnnotation, degrees: number): KnownDiagramAnnotation {
  const next = keptTurn(degrees, rectangleAngle);
  const { angle: _was, ...rest } = annotation;
  return next === 0 ? rest : { ...rest, angle: next };
}

/**
 * An oval or a rectangle as this build writes it (Revision 3): its centre
 * within reach and `to` on it; its size, each side within {@link AREA_SIDE}
 * — a click's square where it has none; a turn only as a number, within
 * [0, 180). The same object when it already is.
 */
function cleanArea(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const from = withinReach(annotation.from);
  const { size: wasSize, angle: wasAngle, ...rest } = annotation;
  const size: [number, number] = wasSize
    ? [zoomSideWithin(wasSize[0]), zoomSideWithin(wasSize[1])]
    : [ZOOM_CLICK.size[0], ZOOM_CLICK.size[1]];
  const angle = wasAngle !== undefined && Number.isFinite(wasAngle) ? rectangleAngle(wasAngle) : undefined;
  const same =
    samePoint(from, annotation.from) &&
    samePoint(from, annotation.to) &&
    wasSize !== undefined &&
    samePoint(size, wasSize) &&
    angle === wasAngle;
  if (same) return annotation;
  return { ...rest, from, to: [from[0], from[1]], size, ...(angle !== undefined ? { angle } : {}) };
}

/**
 * How many steps an x-ray peels its window by (Revision 3, R3-34 A): from
 * one, with no upper bound — a depth past the window's steps draws at the
 * deepest, so a larger number means nothing new — and one as it is laid,
 * until its Depth is typed (R3-18a A).
 */
export const XRAY_DEPTH = { min: 1, laid: 1 } as const;

/** An x-ray's depth as drawn: its own, or one for a mark that has none. */
export function xrayDepthOf({ depth }: Pick<KnownDiagramAnnotation, 'depth'>): number {
  return depth !== undefined && Number.isInteger(depth) && depth >= XRAY_DEPTH.min ? depth : XRAY_DEPTH.laid;
}

/** A depth an x-ray can store: a whole number from one, `value` rounded; one for a value that is no number. */
export function xrayDepthWithin(value: number): number {
  if (!Number.isFinite(value)) return XRAY_DEPTH.laid;
  return Math.max(XRAY_DEPTH.min, Math.round(value));
}

/** An x-ray taking away `depth` layers, held to what it can store. */
export function withXRayDepth(annotation: KnownDiagramAnnotation, depth: number): KnownDiagramAnnotation {
  return { ...annotation, depth: xrayDepthWithin(depth) };
}

/**
 * An x-ray as this build writes it (Revision 3): its centre within reach and
 * `to` on it; its window's radius in Enlarge's circle's range; its depth a
 * whole number from one, always written; an anchor only as two numbers. The
 * same object when it already is.
 */
function cleanXRay(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  const from = withinReach(annotation.from);
  const { radius: wasRadius, depth: wasDepth, anchor: wasAnchor, ...rest } = annotation;
  const radius = zoomRadiusWithin(wasRadius ?? ZOOM_CLICK.radius);
  const depth = wasDepth === undefined ? XRAY_DEPTH.laid : xrayDepthWithin(wasDepth);
  const anchor =
    wasAnchor !== undefined && Number.isFinite(wasAnchor[0]) && Number.isFinite(wasAnchor[1]) ? wasAnchor : undefined;
  const same =
    samePoint(from, annotation.from) &&
    samePoint(from, annotation.to) &&
    radius === wasRadius &&
    depth === wasDepth &&
    anchor === wasAnchor;
  if (same) return annotation;
  return { ...rest, from, to: [from[0], from[1]], radius, depth, ...(anchor !== undefined ? { anchor } : {}) };
}

/**
 * `delta`, cut short so that every one of `points` moved by it stays within
 * reach: what keeps a shape whole when it is moved against reach's edge.
 */
function deltaWithinReach(points: readonly PicturePoint[], delta: PicturePoint): PicturePoint {
  const limit = (axis: 0 | 1) => {
    let low = Infinity;
    let high = -Infinity;
    for (const point of points) {
      low = Math.min(low, point[axis]);
      high = Math.max(high, point[axis]);
    }
    return Math.min(activeReach.max[axis] - high, Math.max(activeReach.min[axis] - low, delta[axis]));
  };
  return [limit(0), limit(1)];
}

/** Every point a path is made of: its nodes and their handles. */
function pathPoints(path: readonly DiagramPathNode[]): PicturePoint[] {
  return path.flatMap((node) => [node.at, ...(node.in ? [node.in] : []), ...(node.out ? [node.out] : [])]);
}

/** Every point of a node moved by `delta`. */
function shiftNode(node: DiagramPathNode, [dx, dy]: PicturePoint): DiagramPathNode {
  const shift = (point: PicturePoint): PicturePoint => [point[0] + dx, point[1] + dy];
  return {
    ...node,
    at: shift(node.at),
    ...(node.in ? { in: shift(node.in) } : {}),
    ...(node.out ? { out: shift(node.out) } : {}),
  };
}

/** The whole annotation moved by `delta`, no further than keeps it within reach: its shape kept. */
export function moveAnnotation(annotation: KnownDiagramAnnotation, delta: PicturePoint): KnownDiagramAnnotation {
  const { from, to, path, back } = annotation;
  const [dx, dy] = deltaWithinReach(path ? [...pathPoints(path), ...pathPoints(back ?? [])] : [from, to], delta);
  if (dx === 0 && dy === 0) return annotation;
  if (path) {
    const moved = back ? { ...annotation, back: back.map((node) => shiftNode(node, [dx, dy])) } : annotation;
    return withPath(moved, path.map((node) => shiftNode(node, [dx, dy])));
  }
  const shift = (point: PicturePoint): PicturePoint => [point[0] + dx, point[1] + dy];
  const other = annotation.other ? { other: shift(annotation.other) } : {};
  return { ...annotation, from: shift(from), to: shift(to), ...other };
}

/**
 * A shaped arrow's node put at `point`, its handles with it — as far toward
 * `point` as keeps the three within reach.
 */
export function movePathNodeTo(
  path: readonly DiagramPathNode[],
  index: number,
  point: PicturePoint
): DiagramPathNode[] {
  const node = path[index];
  if (!node) return [...path];
  const target = withinReach(point);
  const delta = deltaWithinReach(pathPoints([node]), [target[0] - node.at[0], target[1] - node.at[1]]);
  return path.map((each, at) => (at === index ? shiftNode(each, delta) : each));
}

/**
 * One end put at `point`. A point kind has one place, so both move; a shaped
 * arrow's end is a node, and its handle comes with it; a right angle's
 * corner moves whole, and its other end turns it.
 */
export function moveAnnotationEnd(
  annotation: KnownDiagramAnnotation,
  end: 'from' | 'to',
  point: PicturePoint
): KnownDiagramAnnotation {
  const { path } = annotation;
  if (path) return withPath(annotation, movePathNodeTo(path, end === 'from' ? 0 : path.length - 1, point));
  if (isCornerKind(annotation.kind)) {
    // Its corner moves with the way it opens kept; its other end turns it toward the point.
    return end === 'from'
      ? { ...annotation, ...rightAngleAt(point, rightAngleDiagonal(annotation)) }
      : { ...annotation, ...rightAngleAt(annotation.from, [point[0] - annotation.from[0], point[1] - annotation.from[1]]) };
  }
  const at = withinReach(point);
  if (isPointKind(annotation.kind)) return { ...annotation, from: at, to: [at[0], at[1]] };
  return end === 'from' ? { ...annotation, from: at } : { ...annotation, to: at };
}

/**
 * A fold arrow's shape: an arc, with the bulge it is drawn with — its own,
 * or References' 60° for one written without one — or the path it was
 * shaped along. The one place an absent bend is filled in, and a switch for
 * every caller, so none can take a shaped arrow for the default arc.
 */
export type ArrowShape = { kind: 'arc'; bend: number } | { kind: 'path'; path: readonly DiagramPathNode[] };

export function arrowShape(annotation: Pick<KnownDiagramAnnotation, 'bend' | 'path'>): ArrowShape {
  return annotation.path ? { kind: 'path', path: annotation.path } : { kind: 'arc', bend: annotation.bend ?? ARROW_BEND };
}

/**
 * A path as cubic Béziers, in picture units: one from each node to the next,
 * through the first's `out` and the second's `in`, a missing handle on its
 * node.
 */
export function pathCubics(path: readonly DiagramPathNode[]): Cubic[] {
  const cubics: Cubic[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    cubics.push([a.at, a.out ?? a.at, b.in ?? b.at, b.at]);
  }
  return cubics;
}

/** How far a run of points travels. */
function polylineLength(points: readonly (readonly [number, number])[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  }
  return length;
}

/** How long a path is, to within a thousandth of a frame: what says it has a length at all. */
export function pathLength(path: readonly DiagramPathNode[]): number {
  return polylineLength(flattenPath(pathCubics(path), 1e-4));
}

/**
 * Whether Flip arc turns `kind` over: a fold arrow's bulge, or a white
 * arrow's, mirrored across its chord as a shaped fold arrow is — and a pleat
 * arrow's Zs, stepping to the other side of it (15c), and equal divisions'
 * line, over to the other side of the line it measures (Revision 2). Not an
 * eye: F on an eye is its Flip row's Horizontal (R3-9b A, amended 2026-10-08;
 * `flipKeyAction`). Asked by every surface that offers it
 * (`annotationActions.ts`), and a switch, so a new kind has to answer.
 */
export function flipsArc(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'white-arrow':
    case 'pleat-arrow':
    case 'divisions':
      return true;
    case 'push-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
    case 'label':
    case 'circle':
    case 'star':
    case 'eye':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'close-up':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
      return false;
  }
}

/**
 * Whether Flip changes what `annotation` draws: an arc that bends, or a path
 * — or a return shaped by hand — with a node or a handle off the line between
 * its ends. A straight arrow — a white arrow as it is laid, or one with nodes
 * added along it — and one whose ends meet mirror onto themselves.
 */
export function flipChangesArc(annotation: KnownDiagramAnnotation): boolean {
  if (!flipsArc(annotation.kind)) return false;
  // A pleat arrow's Zs change sides, whichever way it points.
  if (annotation.kind === 'pleat-arrow') return true;
  // Equal divisions' line goes over, unless they are alike either way.
  if (annotation.kind === 'divisions') return !divisionsAlikeEitherSide(annotation);
  const shape = arrowShape(annotation);
  if (shape.kind === 'arc') return shape.bend !== 0;
  const { from, to } = annotation;
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(chord > 1e-9)) return false;
  const off = ([x, y]: PicturePoint) =>
    Math.abs((x - from[0]) * (to[1] - from[1]) - (y - from[1]) * (to[0] - from[0])) / chord > 1e-9;
  return [...shape.path, ...(annotation.back ?? [])].some(
    (node) => off(node.at) || (node.in !== undefined && off(node.in)) || (node.out !== undefined && off(node.out))
  );
}

/**
 * A fold arrow bulging the other way; a pleat arrow's Zs or equal divisions'
 * line on the other side; anything else as it was. A shaped
 * arrow is mirrored across its chord, every node and handle — a return shaped
 * by hand with it — which is what flipping an arc is; one whose ends meet has
 * no chord, and stays.
 */
export function flipAnnotationArc(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (!flipsArc(annotation.kind)) return annotation;
  if (annotation.kind === 'pleat-arrow' || annotation.kind === 'divisions') return withSide(annotation, annotation.mirrored !== true);
  const shape = arrowShape(annotation);
  if (shape.kind === 'arc') return { ...annotation, bend: -shape.bend };
  const { from, to } = annotation;
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(chord > 1e-9)) return annotation;
  const ux = (to[0] - from[0]) / chord;
  const uy = (to[1] - from[1]) / chord;
  const mirror = ([x, y]: PicturePoint): PicturePoint => {
    const along = (x - from[0]) * ux + (y - from[1]) * uy;
    const foot: PicturePoint = [from[0] + along * ux, from[1] + along * uy];
    return [2 * foot[0] - x, 2 * foot[1] - y];
  };
  const mirrored = (nodes: readonly DiagramPathNode[]) => {
    const each = nodes.map((node) => ({
      ...node,
      at: mirror(node.at),
      ...(node.in ? { in: mirror(node.in) } : {}),
      ...(node.out ? { out: mirror(node.out) } : {}),
    }));
    // Mirrored inside the frame it was in can still leave reach: kept within it.
    return cleanPath(each) ?? each;
  };
  // A return shaped by hand is mirrored with the path, across the same chord.
  const withBack = annotation.back ? { ...annotation, back: mirrored(annotation.back) } : annotation;
  return withPath(withBack, mirrored(shape.path));
}

/**
 * Whether an annotation drawn this short would draw nothing: an arrow or
 * line needs a length. A shaped arrow's is along its path, so one that
 * loops back to end beside its tail is still an arrow.
 */
export function isDegenerate(annotation: KnownDiagramAnnotation, minLength: number): boolean {
  // A right angle has a corner and a way to open, not a length; a callout's
  // box is drawn wherever it sits, its point under it or not.
  // A close-up, an enlarge area or a shape has an area, never less than a
  // slip's (`closeUpRadiusWithin`, `zoomSideWithin`), not a length.
  const shape = ANNOTATION_SHAPES[annotation.kind];
  if (
    isPointKind(annotation.kind) ||
    isCornerKind(annotation.kind) ||
    shape === 'callout' ||
    shape === 'close-up' ||
    shape === 'zoom' ||
    shape === 'sight' ||
    shape === 'area' ||
    shape === 'x-ray'
  ) {
    return false;
  }
  // An angle mark has a vertex and two arms, not a length: none when its arms make no angle.
  if (isAngleKind(annotation.kind)) return angleMarkArms(annotation) === null;
  if (annotation.path) return pathLength(annotation.path) < minLength;
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
  /**
   * How many quarter turns the move counts as, for a turn-over's axis: from
   * the two poses' own, not the move's, so a turn made in 15° presses and
   * turned back in one says the same thing. Absent, the move's own, rounded.
   */
  quarterTurns?: number;
  /**
   * How a direction on the picture is carried by the move as a whole — its
   * turn, its mirror, its change of frame — without the stretch a spread
   * gives each face of its own: for a mark that keeps its shape round one
   * point (a callout's box, beside its point). Absent, the move is the same
   * everywhere and `point` says it.
   */
  vector?: (vector: PicturePoint) => PicturePoint;
  /**
   * Where a corner goes with the face it is a corner of and `inside` — a
   * point just inside the angle a mark in it opens into — lies in, when one
   * does: the face a right angle is drawn in though another face has come
   * over its inside since. Null when none does, and absent where every face
   * moves alike; `point` carries it then.
   */
  corner?: (corner: PicturePoint, inside: PicturePoint) => PicturePoint | null;
  /**
   * The picture now shows the paper's other side: a References step turned
   * over (RM7), whose card names its folds from that side as its own lines
   * do (`seenFromTheBack`). Every mark that says which way a fold goes is
   * named from it too ({@link kindFromOtherSide}). Absent, the same side: a
   * mark flipped in place, an upload mirrored, a crease pattern put on its
   * back's colour (which moves nothing at all).
   */
  otherSide?: true;
}

/**
 * The kind a mark is named by from the paper's other side (RM7): a valley
 * line or arrow seen from the back is a mountain, and a mountain a valley,
 * as References names a card's folds (`seenFromTheBack`). A shaped arrow's
 * head is its kind's, so it goes with it. Every other mark says no way to
 * fold — a fold-and-unfold arrow, a hidden or solid line, a circle, text — or
 * one no turn-over changes, and keeps its kind. A switch, so a new kind has
 * to say.
 */
export function kindFromOtherSide(kind: DiagramAnnotationKind): DiagramAnnotationKind {
  switch (kind) {
    case 'valley-line':
      return 'mountain-line';
    case 'mountain-line':
      return 'valley-line';
    case 'valley-arrow':
      return 'mountain-arrow';
    case 'mountain-arrow':
      return 'valley-arrow';
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'turn-over':
    case 'rotate':
    case 'hidden-line':
    case 'solid-line':
    case 'label':
    case 'circle':
    case 'star':
    case 'eye':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'divisions':
    case 'close-up':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
      return kind;
  }
}

/**
 * An annotation carried through a picture's move. Every point moves — a
 * shaped arrow's every node and handle, which carries its curve exactly; a
 * mirror turns an arc's bulge, a rotation's sense and the side a pleat
 * arrow's Zs step to over, and needs nothing
 * done to a path, whose handles are points too; a quarter turn (or three)
 * turns a turn-over's axis. A label's text stays upright; words hung off
 * their anchor (17b) keep their side of it as the picture turns or mirrors,
 * as far off it in print as they were ({@link carryHungText}). Onto the
 * paper's other side, a fold is named from there ({@link PictureMove.otherSide}),
 * drawn by hand or not: which way it goes is the paper's.
 */
export function carryAnnotation(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  const carried = carriedOnPicture(annotation, move);
  if (!move.otherSide) return carried;
  const kind = kindFromOtherSide(carried.kind);
  return kind === carried.kind ? carried : { ...carried, kind };
}

/** An annotation's every point and side carried through a picture's move ({@link carryAnnotation}), its kind kept. */
function carriedOnPicture(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  if (annotation.kind === 'callout') return carryCallout(annotation, move);
  if (isHungText(annotation)) return carryHungText(annotation, move);
  if (annotation.kind === 'close-up') return carryCloseUp(annotation, move);
  // An x-ray's window is Enlarge's circle, carried with the face under its centre; its anchor is on the
  // paper, which no move of the picture moves, and its depth is kept (Revision 3, R3-21 A).
  if (annotation.kind === 'zoom' || annotation.kind === 'x-ray' || (annotation.kind === 'circle' && annotation.radius !== undefined)) return carryZoom(annotation, move);
  if (annotation.kind === 'eye') return carryEye(annotation, move);
  if (isAreaKind(annotation.kind)) return carryArea(annotation, move);
  if (annotation.path) {
    const carry = (nodes: readonly DiagramPathNode[]) => {
      const carried = nodes.map((node) => ({
        ...node,
        at: move.point(node.at),
        ...(node.in ? { in: move.point(node.in) } : {}),
        ...(node.out ? { out: move.point(node.out) } : {}),
      }));
      // Kept within reach, as every carried point is, a handle drawn in along itself.
      return cleanPath(carried) ?? carried;
    };
    // A return shaped by hand goes with it, every point as the path's.
    const withBack = annotation.back ? { ...annotation, back: carry(annotation.back) } : annotation;
    return withPath(withBack, carry(annotation.path));
  }
  if (isAngleKind(annotation.kind)) return carryAngle(annotation, move);
  // Kept within reach: a carried point that would leave it was three frames off the picture already.
  if (isCornerKind(annotation.kind)) {
    const opens = rightAngleDiagonal(annotation);
    if (move.vector) {
      // A spread moves each face its own way, and a corner lies on the edge of
      // every face that meets there: carried with the face it is a corner of
      // and drawn in, else by a point just inside its angle, it goes with that
      // face, opening as the turn takes it — never by its corner and `to`
      // apart, which two faces may carry.
      const nudge: PicturePoint = [opens[0] * CORNER_NUDGE, opens[1] * CORNER_NUDGE];
      const nudged: PicturePoint = [annotation.from[0] + nudge[0], annotation.from[1] + nudge[1]];
      const corner = move.corner?.(annotation.from, nudged);
      if (corner) return { ...annotation, ...rightAngleAt(corner, move.vector(opens)) };
      const inside = move.point(nudged);
      const back = move.vector(nudge);
      return { ...annotation, ...rightAngleAt([inside[0] - back[0], inside[1] - back[1]], move.vector(opens)) };
    }
    // Its corner where the point went, opening the way its diagonal went: so
    // a mirror turns it over and a turn turns it, and its legs stay parallel
    // to the lines, as far inside them, under any similarity.
    const from = move.point(annotation.from);
    const to = move.point(annotation.to);
    return { ...annotation, ...rightAngleAt(from, [to[0] - from[0], to[1] - from[1]]) };
  }
  const carried: KnownDiagramAnnotation = {
    ...annotation,
    from: withinReach(move.point(annotation.from)),
    to: withinReach(move.point(annotation.to)),
  };
  // An arc bulges the other way: the one it is drawn with, References' 60° where none is written.
  if (move.mirrors && isArrowKind(annotation.kind)) carried.bend = -(annotation.bend ?? ARROW_BEND);
  // A pleat arrow's Zs, and equal divisions' line, stay on their side of the
  // paper: a mirror turns the side they lie on over. A turn leaves it, and
  // equal divisions' offset is a print size, which no move scales.
  if (move.mirrors && (annotation.kind === 'pleat-arrow' || annotation.kind === 'divisions')) {
    return withSide(carried, annotation.mirrored !== true);
  }
  if (move.mirrors && annotation.rotate) {
    carried.rotate = { ...annotation.rotate, direction: annotation.rotate.direction === 'cw' ? 'ccw' : 'cw' };
  }
  const quarters = move.quarterTurns ?? Math.round(move.turnDeg / 90);
  if (annotation.axis && Math.abs(quarters) % 2 === 1) {
    carried.axis = annotation.axis === 'vertical' ? 'horizontal' : 'vertical';
  }
  return carried;
}

/**
 * An angle mark carried as a right angle is: its vertex with the face it is
 * drawn in — the one a point just inside its angle lies in — and its arms
 * turned as the picture turns there; under a move the same everywhere, each
 * point where it went.
 */
function carryAngle(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  const arms = angleMarkArms(annotation);
  if (!arms || !annotation.other) return annotation;
  const [first, second] = arms;
  let placed: ReturnType<typeof angleMarkAt>;
  if (move.vector) {
    // Its inside: between its arms, which make an angle under a half turn.
    const middle = [first[0] + second[0], first[1] + second[1]];
    const length = Math.hypot(middle[0]!, middle[1]!) || 1;
    const nudge: PicturePoint = [(middle[0]! / length) * CORNER_NUDGE, (middle[1]! / length) * CORNER_NUDGE];
    const nudged: PicturePoint = [annotation.from[0] + nudge[0], annotation.from[1] + nudge[1]];
    const inside = move.point(nudged);
    const back = move.vector(nudge);
    const vertex = move.corner?.(annotation.from, nudged) ?? [inside[0] - back[0], inside[1] - back[1]];
    const a = move.vector(first);
    const b = move.vector(second);
    placed = angleMarkAt(vertex, [vertex[0] + a[0], vertex[1] + a[1]], [vertex[0] + b[0], vertex[1] + b[1]]);
  } else {
    placed = angleMarkAt(move.point(annotation.from), move.point(annotation.to), move.point(annotation.other));
  }
  return placed ? { ...annotation, ...placed } : annotation;
}

/**
 * A callout carried with the face under its point: the point moves as a
 * point does, and the box keeps its place beside it — turned and mirrored as
 * the picture is, never spread with whatever face lies under the box, which
 * may be another, or none off the paper. Its words stay upright, so its box
 * does: it is put the way the picture turned its offset, its line as long as
 * it was ({@link keptBeside}).
 */
function carryCallout(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  const { from, to } = annotation;
  const offset: PicturePoint = [to[0] - from[0], to[1] - from[1]];
  const carried = withinReach(move.point(from));
  let turned: PicturePoint;
  if (move.vector) turned = move.vector(offset);
  else {
    const [x0, y0] = move.point(from);
    const [x1, y1] = move.point([from[0] + offset[0], from[1] + offset[1]]);
    turned = [x1 - x0, y1 - y0];
  }
  const beside = keptBeside(annotation.text ?? '', offset, turned);
  return { ...annotation, from: carried, to: withinReach([carried[0] + beside[0], carried[1] + beside[1]]) };
}

/**
 * Where a callout's box goes from its point once its offset `offset` is
 * carried to `turned`: along `turned`, as far as keeps its line as long as it
 * was — scaled with the picture — past the box's outline. The box is upright
 * and some times wider than tall, so the turned offset itself could bring the
 * point inside it, and lose the line, after a quarter turn. A point already
 * inside stays as far in. Exactly undone by the move back; a mirror or a half
 * turn, which face the box the same way, is the turned offset.
 */
function keptBeside(text: string, offset: PicturePoint, turned: PicturePoint): PicturePoint {
  const length = Math.hypot(offset[0], offset[1]);
  const turnedLength = Math.hypot(turned[0], turned[1]);
  if (!(length > 0) || !(turnedLength > 0)) return turned;
  const { halfWidth, halfHeight } = calloutHalfBox(text);
  // From the box's middle to its outline, along a unit direction.
  const outline = ([x, y]: PicturePoint) =>
    Math.min(x === 0 ? Infinity : halfWidth / Math.abs(x), y === 0 ? Infinity : halfHeight / Math.abs(y));
  const way: PicturePoint = [turned[0] / turnedLength, turned[1] / turnedLength];
  const was = outline([offset[0] / length, offset[1] / length]);
  const now = outline(way);
  const along = now * Math.min(length / was, 1) + (turnedLength / length) * Math.max(length - was, 0);
  return [way[0] * along, way[1] * along];
}

/**
 * A label whose words hang off its anchor (17b), carried as a callout's box
 * is: its anchor moves as a point does, and its offset is turned and mirrored
 * as the picture is there — by `move.vector`, or where the move takes the
 * offset's far end — its length kept in pt: a print length, which no move
 * scales. So Turn over and Upright keep a letter on the same side of its
 * ring, and a change of units — an enlarged step's window — keeps it as far
 * off. Only a turn that would carry an axis past {@link TEXT_OFFSET_PT_MAX}
 * shortens it, along the same way.
 */
function carryHungText(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  const { from } = annotation;
  const [dx, dy] = annotation.offsetPt!;
  const carried = withinReach(move.point(from));
  const moved: KnownDiagramAnnotation = { ...annotation, from: carried, to: [carried[0], carried[1]] };
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return moved;
  const unit = ptInPictureUnits(1);
  const offset: PicturePoint = [dx * unit, dy * unit];
  let turned: PicturePoint;
  if (move.vector) turned = move.vector(offset);
  else {
    const [x0, y0] = move.point(from);
    const [x1, y1] = move.point([from[0] + offset[0], from[1] + offset[1]]);
    turned = [x1 - x0, y1 - y0];
  }
  const turnedLength = Math.hypot(turned[0], turned[1]);
  if (!(turnedLength > 0)) return moved;
  const way: PicturePoint = [turned[0] / turnedLength, turned[1] / turnedLength];
  // A turn that is no quarter turn can carry an axis past what a label stores (45° takes
  // [180, 180] to [0, 255]): the words come in along the same way until it is back in reach,
  // so what this build writes, it reads back as its own.
  const along = Math.min(length, TEXT_OFFSET_PT_MAX / Math.max(Math.abs(way[0]), Math.abs(way[1])));
  return withLabelOffset(moved, [way[0] * along, way[1] * along]);
}

/**
 * A close-up carried with the face under its area's centre, as a callout's
 * point is (15f): the close-up keeps its place beside it, turned and
 * mirrored as the picture is, never spread with whatever face lies under it
 * — another, or none off the paper; and the area keeps its size on the
 * picture, its radius scaled as the move scales the picture as a whole, its
 * scale kept.
 */
function carryCloseUp(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  const { from, to } = annotation;
  const carried = withinReach(move.point(from));
  const turned = (vector: PicturePoint): PicturePoint => {
    if (move.vector) return move.vector(vector);
    const [x0, y0] = move.point(from);
    const [x1, y1] = move.point([from[0] + vector[0], from[1] + vector[1]]);
    return [x1 - x0, y1 - y0];
  };
  const [dx, dy] = turned([to[0] - from[0], to[1] - from[1]]);
  const [rx, ry] = turned([closeUpRadius(annotation), 0]);
  return {
    ...annotation,
    from: carried,
    to: withinReach([carried[0] + dx, carried[1] + dy]),
    radius: closeUpRadiusWithin(Math.hypot(rx, ry)),
  };
}

/**
 * An eye carried with the paper (Revision 3): its centre with the face under
 * it, as a point is, and the way it looks turned as the picture turns there —
 * by `move.vector`, or where the move takes a step along it — as an enlarge
 * area's turn is ({@link carryZoom}): a turn turns it, and a mirror reflects
 * it, so Turn Over has it look across the paper as it did. Its scale is a
 * print size, which no move changes. Its turn kept to a hundredth of a
 * degree, as a drag of it writes one.
 */
function carryEye(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  const { from } = annotation;
  const carried = withinReach(move.point(from));
  const radians = (glyphAngleOf(annotation) * Math.PI) / 180;
  const look: PicturePoint = [Math.cos(radians), Math.sin(radians)];
  let turned: PicturePoint;
  if (move.vector) turned = move.vector(look);
  else {
    const [x0, y0] = move.point(from);
    const [x1, y1] = move.point([from[0] + look[0], from[1] + look[1]]);
    turned = [x1 - x0, y1 - y0];
  }
  const moved: KnownDiagramAnnotation = { ...annotation, from: carried, to: [carried[0], carried[1]] };
  if (!(Math.hypot(turned[0], turned[1]) > 0)) return moved;
  return withGlyphAngle(moved, keptTurn((Math.atan2(turned[1], turned[0]) * 180) / Math.PI, glyphAngle));
}

/** Which way Flip turns a mark over: left to right, or top to bottom. */
export type FlipAxis = 'horizontal' | 'vertical';

/**
 * Whether Flip can turn a mark of `kind` over (Zach, 2026-10-05): every mark
 * with a side to it, and an eye, which looks one way (R3-9b A): about its
 * centre, Horizontal takes its angle to 180° less it, Vertical to its
 * negative. A circle, a label, a turn-over and a star are their point, drawn
 * the same either way over. An enlarge area is not offered it: Revision 2
 * gives an area no Flip, and a turned rounded rectangle, which one would draw
 * at another angle, takes its turn only from its paper (`carryZoom`). A
 * switch, so a new kind has to say.
 */
export function flipsOver(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'divisions':
    case 'close-up':
    case 'eye':
      return true;
    // An enlarge area: not offered, though a turned rounded rectangle has a side (see above).
    case 'turn-over':
    case 'label':
    case 'circle':
    case 'star':
    case 'zoom':
    case 'oval':
    case 'rectangle':
    case 'x-ray':
      return false;
  }
}

/**
 * The point Flip turns a mark over about: an arrow's or a line's middle — the
 * middle of its ends, or of its path's nodes and a return's shaped by hand —
 * so it stays where it is, and the middle of the line equal divisions
 * measure; any other mark's anchor, `from`: a right angle's
 * corner, an angle mark's vertex, a callout's point, a close-up's area, a
 * sign's place.
 */
export function flipCentre(annotation: KnownDiagramAnnotation): PicturePoint {
  const shape = ANNOTATION_SHAPES[annotation.kind];
  if (shape !== 'arc' && shape !== 'straight' && shape !== 'path' && shape !== 'line' && shape !== 'divisions') {
    return annotation.from;
  }
  const points = annotation.path
    ? [...annotation.path, ...(annotation.back ?? [])].map((node) => node.at)
    : [annotation.from, annotation.to];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * A mark turned over in place: mirrored left to right (`horizontal`) or top
 * to bottom (`vertical`) about {@link flipCentre}, as a mirrored picture
 * carries it ({@link carryAnnotation}) — an arc bulging the other way, a
 * rotation turning the other way, a pleat's Zs on the other side, a callout's
 * box and a close-up over on the other side of what they mark, a label's
 * words upright. The mark itself for one that does not flip ({@link flipsOver}).
 */
export function flipAnnotation(annotation: KnownDiagramAnnotation, axis: FlipAxis): KnownDiagramAnnotation {
  if (!flipsOver(annotation.kind)) return annotation;
  const [cx, cy] = flipCentre(annotation);
  const point =
    axis === 'horizontal'
      ? ([x, y]: PicturePoint): PicturePoint => [2 * cx - x, y]
      : ([x, y]: PicturePoint): PicturePoint => [x, 2 * cy - y];
  return carryAnnotation(annotation, { point, mirrors: true, turnDeg: 0 });
}

/**
 * Whether Flip changes what a mark draws: not a line flipped along itself,
 * nor a mark whose sides are alike that way — it would turn over onto itself.
 */
export function flipChangesMark(annotation: KnownDiagramAnnotation, axis: FlipAxis): boolean {
  const flipped = flipAnnotation(annotation, axis);
  if (annotation.kind === 'divisions') {
    // Its ends swap and its side turns over along a line flipped along
    // itself: what it draws, not how it is written, says whether it changed.
    const [was, now] = [divisionsFootprint(annotation), divisionsFootprint(flipped)];
    return was.some((value, index) => Math.abs(value - now[index]!) > 1e-12);
  }
  return JSON.stringify(flipped) !== JSON.stringify(annotation);
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
