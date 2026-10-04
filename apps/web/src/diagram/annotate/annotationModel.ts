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
import { flattenPath, type Cubic } from '../../lib/cubicBezier';
import { graphemesOf } from '../../lib/paper/textWrap';
import { xmlText } from '../../lib/xmlEscape';
import {
  randomDiagramId,
  type DiagramAnnotationKind,
  type DiagramIdFactory,
  type DiagramPathNode,
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
 * - `straight`: a push, dragged, straight from `from` to `to`;
 * - `line`: a crease line, dragged, drawn in the diagram's pens;
 * - `point`: a sign or a label, put down with a click at one point (`to` is
 *   `from`).
 */
type AnnotationShape = 'arc' | 'straight' | 'line' | 'point';

const ANNOTATION_SHAPES: Readonly<Record<DiagramAnnotationKind, AnnotationShape>> = {
  'valley-arrow': 'arc',
  'mountain-arrow': 'arc',
  'fold-unfold-arrow': 'arc',
  'push-arrow': 'straight',
  'turn-over': 'point',
  rotate: 'point',
  'valley-line': 'line',
  'mountain-line': 'line',
  'hidden-line': 'line',
  label: 'point',
};

/** Every kind, in the order the rail offers them. */
export const ANNOTATION_KINDS = Object.keys(ANNOTATION_SHAPES) as readonly DiagramAnnotationKind[];

const kindsShaped = (shape: AnnotationShape): ReadonlySet<DiagramAnnotationKind> =>
  new Set(ANNOTATION_KINDS.filter((kind) => ANNOTATION_SHAPES[kind] === shape));

/** The fold arrows, which bulge on an arc. */
export const ARROW_KINDS = kindsShaped('arc');

/** The kinds placed with a click, at one point: `to` is `from`. */
export const POINT_KINDS = kindsShaped('point');

/** The crease lines, drawn in the diagram's pens. */
export const LINE_KINDS = kindsShaped('line');

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

/** The most annotations a step holds: a guard against a file that was never a diagram's. */
export const MAX_STEP_ANNOTATIONS = 500;

/** The most nodes a shaped arrow has: room for any arrow a diagram draws, and a bound on a file's. */
export const MAX_PATH_NODES = 24;

const clampReach = (value: number) => Math.min(ANNOTATION_REACH, Math.max(-ANNOTATION_REACH, value));

/** A point kept within {@link ANNOTATION_REACH}, where the file reader takes it as this build's. */
export function withinReach([x, y]: PicturePoint): PicturePoint {
  return [clampReach(x), clampReach(y)];
}

/**
 * An annotation as this build writes it: its points within reach, a sign or
 * a label at one point, a label's text clean for XML and no longer than a
 * label may be, an arrow's bulge within a half circle, a shaped arrow's path
 * as the reader takes it ({@link cleanPath}). The same object when it
 * already is.
 */
export function cleanAnnotation(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (annotation.path !== undefined) {
    const path = canBeShaped(annotation.kind) ? cleanPath(annotation.path) : null;
    if (path) {
      const ends = endsOf(path);
      const clean =
        path === annotation.path &&
        annotation.bend === undefined &&
        samePoint(annotation.from, ends.from) &&
        samePoint(annotation.to, ends.to);
      return clean ? annotation : withPath(annotation, path);
    }
    // A path this build would not write: the arrow is an arc again.
    const { path: _dropped, ...arc } = annotation;
    return cleanAnnotation(isArrowKind(arc.kind) ? { ...arc, bend: arc.bend ?? ARROW_BEND } : arc);
  }
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
 * A path as the file reader takes it for this build's: its nodes and handles
 * within reach — a handle drawn in along itself, so a smooth node stays
 * smooth — no handle before the tail or after the tip, and no more than
 * {@link MAX_PATH_NODES} nodes, the extras taken out of its middle (no edit
 * makes more). The same array when it already is; null for fewer than two.
 */
export function cleanPath(path: readonly DiagramPathNode[]): DiagramPathNode[] | null {
  if (path.length < 2) return null;
  const kept = path.length > MAX_PATH_NODES ? [...path.slice(0, MAX_PATH_NODES - 1), path[path.length - 1]!] : path;
  let changed = kept !== path;
  const last = kept.length - 1;
  const nodes = kept.map((node, index) => {
    const at = withinReach(node.at);
    const handle = (side: 'in' | 'out') => {
      const point = node[side];
      const allowed = side === 'in' ? index > 0 : index < last;
      return point && allowed ? handleWithinReach(at, point) : undefined;
    };
    const clean: DiagramPathNode = { at };
    const inHandle = handle('in');
    const outHandle = handle('out');
    if (inHandle) clean.in = inHandle;
    if (outHandle) clean.out = outHandle;
    if (node.type === 'corner') clean.type = 'corner';
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
  if (Math.abs(handle[0]) <= ANNOTATION_REACH && Math.abs(handle[1]) <= ANNOTATION_REACH) return handle;
  let share = 1;
  for (const axis of [0, 1] as const) {
    const run = handle[axis] - at[axis];
    if (handle[axis] > ANNOTATION_REACH) share = Math.min(share, (ANNOTATION_REACH - at[axis]) / run);
    if (handle[axis] < -ANNOTATION_REACH) share = Math.min(share, (-ANNOTATION_REACH - at[axis]) / run);
  }
  share = Math.max(0, share);
  return withinReach([at[0] + (handle[0] - at[0]) * share, at[1] + (handle[1] - at[1]) * share]);
}

/** A shaped arrow's ends: its first node and its last. */
function endsOf(path: readonly DiagramPathNode[]): { from: PicturePoint; to: PicturePoint } {
  const first = path[0]!.at;
  const last = path[path.length - 1]!.at;
  return { from: [first[0], first[1]], to: [last[0], last[1]] };
}

/** An arrow along `path`, its ends the path's, with no bend: a path is not an arc. */
export function withPath(annotation: KnownDiagramAnnotation, path: DiagramPathNode[]): KnownDiagramAnnotation {
  const { bend: _arc, ...rest } = annotation;
  return { ...rest, ...endsOf(path), path };
}

/**
 * Whether an arrow of `kind` may be shaped by hand (decision 1): the fold
 * arrows; a push and a line stay straight. A switch, so a new kind has to say.
 */
export function canBeShaped(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
      return true;
    case 'push-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'label':
      return false;
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
 * Half a label's width, in picture units, as it is drawn centred on its
 * point: about half an em for each Latin letter, a whole em for a wide one.
 * An estimate — the canvas cannot measure the text it draws — that the hit
 * test, the selection and a file's crop all share.
 */
export function labelHalfWidth(text: string): number {
  let ems = 0;
  for (const grapheme of graphemesOf(text)) ems += WIDE.test(grapheme) ? 1 : 0.6;
  return LABEL_SIZE * (Math.max(ems, 0.6) / 2 + 0.2);
}

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
  start: PicturePoint,
  end: PicturePoint,
  frame: PictureFrame,
  newId: DiagramIdFactory = randomDiagramId
): KnownDiagramAnnotation {
  const id = newId('annotation');
  const from = withinReach(start);
  const to = withinReach(end);
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
    return Math.min(ANNOTATION_REACH - high, Math.max(-ANNOTATION_REACH - low, delta[axis]));
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
  const { from, to, path } = annotation;
  const [dx, dy] = deltaWithinReach(path ? pathPoints(path) : [from, to], delta);
  if (dx === 0 && dy === 0) return annotation;
  if (path) return withPath(annotation, path.map((node) => shiftNode(node, [dx, dy])));
  const shift = (point: PicturePoint): PicturePoint => [point[0] + dx, point[1] + dy];
  return { ...annotation, from: shift(from), to: shift(to) };
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
 * arrow's end is a node, and its handle comes with it.
 */
export function moveAnnotationEnd(
  annotation: KnownDiagramAnnotation,
  end: 'from' | 'to',
  point: PicturePoint
): KnownDiagramAnnotation {
  const { path } = annotation;
  if (path) return withPath(annotation, movePathNodeTo(path, end === 'from' ? 0 : path.length - 1, point));
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
 * Whether Flip arc turns `kind` over: a fold arrow's bulge. Asked by every
 * surface that offers it (`annotationActions.ts`), and a switch, so a new
 * kind has to answer.
 */
export function flipsArc(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
      return true;
    case 'push-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'label':
      return false;
  }
}

/**
 * A fold arrow bulging the other way; anything else as it was. A shaped
 * arrow is mirrored across its chord, every node and handle, which is what
 * flipping an arc is; one whose ends meet has no chord, and stays.
 */
export function flipAnnotationArc(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (!flipsArc(annotation.kind)) return annotation;
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
  const path = shape.path.map((node) => ({
    ...node,
    at: mirror(node.at),
    ...(node.in ? { in: mirror(node.in) } : {}),
    ...(node.out ? { out: mirror(node.out) } : {}),
  }));
  // Mirrored inside the frame it was in can still leave reach: kept within it.
  return withPath(annotation, cleanPath(path) ?? path);
}

/**
 * Whether an annotation drawn this short would draw nothing: an arrow or
 * line needs a length. A shaped arrow's is along its path, so one that
 * loops back to end beside its tail is still an arrow.
 */
export function isDegenerate(annotation: KnownDiagramAnnotation, minLength: number): boolean {
  if (isPointKind(annotation.kind)) return false;
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
}

/**
 * An annotation carried through a picture's move. Every point moves — a
 * shaped arrow's every node and handle, which carries its curve exactly; a
 * mirror turns an arc's bulge and a rotation's sense over, and needs nothing
 * done to a path, whose handles are points too; a quarter turn (or three)
 * turns a turn-over's axis. A label's text stays upright.
 */
export function carryAnnotation(annotation: KnownDiagramAnnotation, move: PictureMove): KnownDiagramAnnotation {
  if (annotation.path) {
    const path = annotation.path.map((node) => ({
      ...node,
      at: move.point(node.at),
      ...(node.in ? { in: move.point(node.in) } : {}),
      ...(node.out ? { out: move.point(node.out) } : {}),
    }));
    // Kept within reach, as every carried point is, a handle drawn in along itself.
    return withPath(annotation, cleanPath(path) ?? path);
  }
  // Kept within reach: a carried point that would leave it was three frames off the picture already.
  const carried: KnownDiagramAnnotation = {
    ...annotation,
    from: withinReach(move.point(annotation.from)),
    to: withinReach(move.point(annotation.to)),
  };
  if (move.mirrors && annotation.bend !== undefined) carried.bend = -annotation.bend;
  if (move.mirrors && annotation.rotate) {
    carried.rotate = { ...annotation.rotate, direction: annotation.rotate.direction === 'cw' ? 'ccw' : 'cw' };
  }
  const quarters = move.quarterTurns ?? Math.round(move.turnDeg / 90);
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
