/**
 * Where a step's letters go.
 *
 * A letter names a mark or a line and sits beside it — but "beside" is shared
 * with everything else in the picture: the ring round the mark it names, the
 * rings round the other marks, the other letters, and on a card the step
 * number printed over the top-left corner. Placed one at a time with no memory
 * of each other, two letters at neighbouring marks land on one another, a
 * letter's halo erases a piece of its own ring, and a letter at the top-left
 * corner lands under the number.
 *
 * So the letters are laid out together, as one pass over the whole model in
 * drawing order. Each tries the same candidates in the same order — the
 * outward diagonal first, which is where a diagram puts a letter, then the
 * directions nearest to it — and takes the first that fits: inside the
 * drawing, off the reserved boxes, clear of every ring, off the lines the step
 * is about, and clear of every letter already placed. When nothing fits, the least-bad candidate is taken:
 * a letter that overlaps something is a reference the reader can still find,
 * and a missing letter is not.
 *
 * Decided in **projected** space, not sheet space. A mirrored projector gives
 * the two spaces opposite handedness, so a side read off the sheet would push
 * every letter on a back-side card inward, over the drawing, and leave the
 * margin it was aimed at empty. The canvas's projector is a camera, which is
 * the same argument again.
 */
import type { StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import type { DiagramProjector, DiagramSheet, SvgPoint } from '../stepDiagramGeometry';
import { DIAGRAM_LABEL_INK, DIAGRAM_MARK_INK, labelWidth } from './diagramInk';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LabelAnchor = 'start' | 'middle' | 'end';

export interface LabelPlacement {
  /** The `<text>` element's `x`, `y` and `text-anchor`, in the projector's units. */
  x: number;
  y: number;
  anchor: LabelAnchor;
  /** The box the letter is taken to fill — what the next letter keeps clear of. */
  box: Rect;
}

export interface LabelLayoutOptions {
  /**
   * Every letter stays inside this box: a card's viewBox. Absent, a letter may
   * go anywhere — the canvas, where the drawing has no edge of its own.
   */
  bounds?: Rect;
  /** Boxes no letter may cover: a card's step number, its badge. */
  reserved?: readonly Rect[];
}

/** A drawn line a letter should not sit across, in the projector's units. */
interface Segment {
  a: SvgPoint;
  b: SvgPoint;
}

/**
 * The lines a letter must keep off: the references the step is made against
 * and the crease it makes. An earlier crease is context, drawn a third as
 * heavy, and a letter over one of those is the lesser evil next to a letter
 * pushed away from its own mark.
 */
const LOUD_LINES = new Set<string>([
  'highlight',
  'mountain',
  'valley',
  'pinch',
  'pinch-mountain',
  'pinch-valley',
]);

function diagramLines(
  primitives: readonly StepDiagramPrimitive[],
  project: DiagramProjector
): Segment[] {
  const lines: Segment[] = [];
  for (const primitive of primitives) {
    if (primitive.kind !== 'line' || !LOUD_LINES.has(primitive.style)) continue;
    lines.push({ a: project(primitive.from), b: project(primitive.to) });
  }
  return lines;
}

/** How much of the segment lies inside `box` — Liang–Barsky, the length kept. */
function lengthInside(box: Rect, segment: Segment): number {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, segment.a.x - box.x],
    [dx, box.x + box.width - segment.a.x],
    [-dy, segment.a.y - box.y],
    [dy, box.y + box.height - segment.a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return 0;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return 0;
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}

/** The centre of every ring in the picture, in the projector's units. */
export function diagramMarks(
  primitives: readonly StepDiagramPrimitive[],
  project: DiagramProjector
): SvgPoint[] {
  const marks: SvgPoint[] = [];
  for (const primitive of primitives) {
    if (primitive.kind === 'point') marks.push(project(primitive.at));
  }
  return marks;
}

/** A ring's outer edge: its radius plus half its stroke, in the projector's units. */
export function markOuterRadius(project: DiagramProjector): number {
  return (DIAGRAM_MARK_INK.radius + DIAGRAM_MARK_INK.width / 2) * project.ink;
}

/**
 * The eight ways a letter can stand off its point, as the sign of each screen
 * axis, in turning order — so neighbours in the list are 45° apart and the
 * distance between two of them is a count of steps round it.
 */
type Direction = readonly [-1 | 0 | 1, -1 | 0 | 1];
const DIRECTIONS: readonly Direction[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/**
 * The candidate directions for a letter at `point`, best first.
 *
 * Outward from the sheet's middle, diagonally — a letter at a corner goes into
 * the corner's own margin — then the rest by how far they turn from that. Of a
 * pair that turn equally far, the more horizontal comes first, because a letter
 * beside its mark is the diagram's convention and a letter under it is the
 * fallback; of two diagonals, the one on the outward side.
 */
function directionsFor(point: SvgPoint, centre: SvgPoint, edge: number): Direction[] {
  const sx = point.x < centre.x - edge ? -1 : point.x > centre.x + edge ? 1 : 0;
  // Above when in the top half (screen up is smaller y), below otherwise.
  const sy = point.y <= centre.y ? -1 : 1;
  const preferred = DIRECTIONS.findIndex((d) => d[0] === sx && d[1] === sy);
  const turn = (k: number) => {
    const raw = Math.abs(k - preferred);
    return Math.min(raw, DIRECTIONS.length - raw);
  };
  const horizontal = (d: Direction) => (d[1] === 0 ? 2 : d[0] !== 0 ? 1 : 0);
  const outward = (d: Direction) => (sx !== 0 && d[0] === sx ? 1 : 0);
  return DIRECTIONS.map((direction, k) => ({ direction, k }))
    .sort(
      (a, b) =>
        turn(a.k) - turn(b.k) ||
        horizontal(b.direction) - horizontal(a.direction) ||
        outward(b.direction) - outward(a.direction)
    )
    .map((entry) => entry.direction);
}

/**
 * The box a letter fills when it stands `reach` off `point` in `direction`:
 * its near edge — or, diagonally, its near corner — is exactly that far away.
 */
function candidateBox(
  point: SvgPoint,
  direction: Direction,
  reach: number,
  width: number,
  height: number
): Rect {
  const [sx, sy] = direction;
  const length = Math.hypot(sx, sy);
  const cx = point.x + (sx / length) * reach + (sx * width) / 2;
  const cy = point.y + (sy / length) * reach + (sy * height) / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * The text attributes that put a letter in `box`.
 *
 * Anchored at the edge nearest its point rather than centred, so a glyph wider
 * than the box was told — a fallback font's, against the advances the box is
 * sized by — grows away from the mark, not over it.
 */
function placementOf(box: Rect, direction: Direction): LabelPlacement {
  const anchor: LabelAnchor = direction[0] > 0 ? 'start' : direction[0] < 0 ? 'end' : 'middle';
  const x =
    anchor === 'start' ? box.x : anchor === 'end' ? box.x + box.width : box.x + box.width / 2;
  return { x, y: box.y + DIAGRAM_LABEL_INK.glyph.baseline * box.height, anchor, box };
}

interface Obstacles {
  bounds: Rect | undefined;
  reserved: readonly Rect[];
  rings: readonly SvgPoint[];
  ringRadius: number;
  lines: readonly Segment[];
  /** The letter's halo, which is what a line under it loses. */
  halo: number;
  placed: Rect[];
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Whether the box reaches into the ring: its nearest point is inside the circle. */
function coversRing(box: Rect, ring: SvgPoint, radius: number): boolean {
  const nx = Math.min(Math.max(ring.x, box.x), box.x + box.width);
  const ny = Math.min(Math.max(ring.y, box.y), box.y + box.height);
  return Math.hypot(nx - ring.x, ny - ring.y) < radius;
}

/**
 * How badly a candidate collides — zero when it fits.
 *
 * Area, so that the fallback picks a letter that clips the corner of a ring over
 * one that sits across it. A ring is checked as the circle it is, and only then
 * charged by its bounding square: the diagonal candidate's near corner sits
 * inside that square and outside the circle, and it is the candidate the whole
 * layout prefers.
 */
function costOf(box: Rect, obstacles: Obstacles): number {
  let cost = 0;
  if (obstacles.bounds) cost += box.width * box.height - overlapArea(box, obstacles.bounds);
  for (const reserved of obstacles.reserved) cost += overlapArea(box, reserved);
  for (const ring of obstacles.rings) {
    if (!coversRing(box, ring, obstacles.ringRadius)) continue;
    const r = obstacles.ringRadius;
    cost += overlapArea(box, { x: ring.x - r, y: ring.y - r, width: 2 * r, height: 2 * r });
  }
  for (const other of obstacles.placed) cost += overlapArea(box, other);
  // A line under a letter is charged by the stretch of it the halo would
  // erase: the box grown by the halo, times the halo's width.
  const haloed = {
    x: box.x - obstacles.halo,
    y: box.y - obstacles.halo,
    width: box.width + 2 * obstacles.halo,
    height: box.height + 2 * obstacles.halo,
  };
  for (const line of obstacles.lines) cost += lengthInside(haloed, line) * obstacles.halo;
  return cost;
}

/**
 * Lay out every `label` in `primitives`, keyed by its index in that list.
 *
 * Sizes are in ink, like the glyph they place: a letter and the distance it
 * stands off its mark measured on different rulers only agree at one size.
 */
export function placeLabels(
  primitives: readonly StepDiagramPrimitive[],
  sheet: DiagramSheet,
  project: DiagramProjector,
  options: LabelLayoutOptions = {}
): Map<number, LabelPlacement> {
  const placed = new Map<number, LabelPlacement>();
  const size = DIAGRAM_LABEL_INK.size * project.ink;
  const height = DIAGRAM_LABEL_INK.glyph.height * size;
  const ringRadius = markOuterRadius(project);
  const reach = ringRadius + DIAGRAM_LABEL_INK.standoff * project.ink;
  // The paper's middle, which on the canvas is not half its size: the sheet
  // sits wherever the document put it, and a letter pushed "outward" from the
  // origin's corner would go inward on three quadrants of it.
  const centre = project(sheet.centre ?? [sheet.width / 2, sheet.height / 2]);
  const edge = 1e-6 * project.scale;
  const obstacles: Obstacles = {
    bounds: options.bounds,
    reserved: options.reserved ?? [],
    rings: diagramMarks(primitives, project),
    ringRadius,
    lines: diagramLines(primitives, project),
    halo: (DIAGRAM_LABEL_INK.halo / 2) * project.ink,
    placed: [],
  };
  primitives.forEach((primitive, index) => {
    if (primitive.kind !== 'label') return;
    const point = project(primitive.at);
    const width = labelWidth(primitive.text, size);
    let best: { placement: LabelPlacement; cost: number } | null = null;
    // Tight against the mark first; half a letter further out is still beside it.
    search: for (const distance of [reach, reach + height / 2]) {
      for (const direction of directionsFor(point, centre, edge)) {
        const box = candidateBox(point, direction, distance, width, height);
        const cost = costOf(box, obstacles);
        if (best === null || cost < best.cost) {
          best = { placement: placementOf(box, direction), cost };
        }
        if (cost === 0) break search;
      }
    }
    if (best === null) return;
    placed.set(index, best.placement);
    obstacles.placed.push(best.placement.box);
  });
  return placed;
}
