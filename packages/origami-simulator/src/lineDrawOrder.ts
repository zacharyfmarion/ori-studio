// Where each line goes in a painter's order: as late as nothing covers it.
//
// The GPU draws every face and then every line, depth-tested: a crease shows
// wherever no paper lies in front of it, at its full width. A vector painter
// has no depth buffer, so it interleaves faces and lines in the order the BSP
// gives — and that order is a valid one, not the only one. Between a line and
// a face that does not cover it, the tree picks a side by which half-space the
// line falls in, and it often draws the line first.
//
// On screen that matters only where the face touches the line: the line's own
// face along its length, or any face meeting it at a vertex. A face drawn
// after a line it touches paints over the half of its ink that hangs off the
// face's edge — and over more than that, because the painter strokes every
// face in its own colour to close the seams between faces. A crease came out
// at a fraction of its weight, shifted to one side along each piece, with a
// notch or a gap wherever another crease met it: on a pleated model, a fold
// line that kinks at every crossing, where the live view draws it straight.
//
// So each line moves to just before the first face drawn after it that covers
// some of it, or to the end when none does. Every face it passes covers none
// of it, so the order stays a valid one; only which ink lies on top where they
// touch changes, and it is the line's, as on the GPU.

export type Point = readonly [number, number];

/** What one drawn item is, for the order: a line it may move, or a face it moves past. */
export type DrawShape =
  | { kind: 'line'; a: Point; b: Point }
  | FaceShape
  /** Neither: it keeps its place, and no line moves past it. */
  | { kind: 'fixed' };

interface FaceShape {
  kind: 'face';
  /** One even-odd set of closed rings: a ring inside an odd number of the others is a hole. */
  rings: ReadonlyArray<ReadonlyArray<Point>>;
  /** The face it is a piece of, when consecutive pieces of one face are put back together. */
  group?: number;
}

/**
 * How far inside a face a line must run before the face covers it, in the
 * items' units (scene px). A line along a face's edge, or meeting it at a
 * corner, lies on the face's boundary to within rounding, and is not covered
 * by it. Above the 0.01 px a stored scene's coordinates are snapped to
 * (`storedSceneStep`), which can set a cut end of a crease that far off the
 * edge of the face it lies on; far below a hundredth of any pen.
 */
export const COVER_EPS = 0.02;

/** Grid cells per side at most: enough to keep candidate lists short on the largest scenes. */
const MAX_GRID_CELLS = 128;

export interface LineOrderOptions {
  /** See {@link COVER_EPS}. */
  eps?: number;
  /**
   * How near a face may come to a line before its edge and seam reach the
   * line's ink, in the items' units: half the widest pen and half the seam,
   * or more. Given, a line that lands inside a run of one face's pieces — the
   * pieces a producer merges back into one face — goes before the run's
   * earlier pieces too, as long as none of them comes this near it, so the
   * line does not split the face where it costs the line nothing.
   */
  reach?: number;
  /**
   * Whether the line at index `line` stays under the face at index `face`
   * even where the face does not cover it: a face whose order against the
   * line the caller has decided some other way. Asked only of faces after the
   * line that come near it. Absent, only a cover keeps a line under a face.
   */
  stays?: (line: number, face: number) => boolean;
}

/**
 * `items` with each line moved to just before the first face after it that
 * covers some of it ({@link coversLine}) or that it {@link LineOrderOptions.stays}
 * under, or to the end of the drawing when none does. Faces and fixed items
 * keep their order; lines that land at the same place keep theirs. A line
 * never moves past a fixed item.
 */
export function linesAsLateAsUncovered<T>(
  items: readonly T[],
  shapeOf: (item: T) => DrawShape,
  { eps = COVER_EPS, reach, stays }: LineOrderOptions = {}
): T[] {
  const count = items.length;
  const shapes = items.map(shapeOf);
  const grid = faceGrid(shapes);
  // The first fixed item at or after each index: as far as a line may go.
  const nextFixed = new Int32Array(count + 1);
  nextFixed[count] = count;
  for (let index = count - 1; index >= 0; index -= 1) {
    nextFixed[index] = shapes[index]!.kind === 'fixed' ? index : nextFixed[index + 1]!;
  }

  // Per line, the index it is drawn just before; -1 for every other item.
  const before = new Int32Array(count).fill(-1);
  const seen = new Int32Array(count).fill(-1);
  for (let index = 0; index < count; index += 1) {
    const shape = shapes[index]!;
    if (shape.kind !== 'line') continue;
    let first = nextFixed[index + 1]!;
    let covered = false;
    if (grid) {
      const candidates: number[] = [];
      grid.visit(segmentBox(shape.a, shape.b, eps), (face) => {
        if (face <= index || face >= first || seen[face] === index) return;
        seen[face] = index;
        candidates.push(face);
      });
      candidates.sort((l, r) => l - r);
      for (const face of candidates) {
        const faceShape = shapes[face] as FaceShape;
        if (coversLine(faceShape.rings, shape.a, shape.b, eps)) {
          first = face;
          covered = true;
          break;
        }
        if (stays?.(index, face)) {
          first = face;
          break;
        }
      }
    }
    // Only past a cover's own earlier pieces: a face the line stays under is
    // ordered against it by the caller, piece by piece.
    before[index] = reach === undefined || !covered ? first : runStartFor(shapes, index, first, shape, reach);
  }

  const moved = new Map<number, T[]>();
  for (let index = 0; index < count; index += 1) {
    const target = before[index]!;
    if (target < 0) continue;
    const list = moved.get(target);
    if (list) list.push(items[index]!);
    else moved.set(target, [items[index]!]);
  }
  const out: T[] = [];
  for (let index = 0; index <= count; index += 1) {
    const arriving = moved.get(index);
    if (arriving) for (const item of arriving) out.push(item);
    if (index < count && before[index] === -1) out.push(items[index]!);
  }
  return out;
}

/**
 * Whether some of the segment `a`–`b` runs inside the rings (even-odd) by more
 * than `eps`: whether a face drawn over the line would hide any of it. A
 * segment along the rings' edge, or touching them at a point, is not covered.
 *
 * The rings' edges cut the segment into spans that each lie wholly inside or
 * wholly outside, and each span is sampled away from its ends, where it meets
 * an edge.
 */
export function coversLine(
  rings: ReadonlyArray<ReadonlyArray<Point>>,
  a: Point,
  b: Point,
  eps: number = COVER_EPS
): boolean {
  const box = ringsBox(rings);
  const line = segmentBox(a, b, 0);
  if (
    !box ||
    line.minX >= box.maxX - eps ||
    line.maxX <= box.minX + eps ||
    line.minY >= box.maxY - eps ||
    line.maxY <= box.minY + eps
  ) {
    return false;
  }
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const cuts = [0, 1];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const denominator = dx * ey - dy * ex;
      // Parallel, along the edge or beside it: either way it cuts nothing.
      if (Math.abs(denominator) < 1e-12) continue;
      const px = p[0] - a[0];
      const py = p[1] - a[1];
      const t = (px * ey - py * ex) / denominator;
      const u = (px * dy - py * dx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
  }
  cuts.sort((l, r) => l - r);
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const from = cuts[i]!;
    const to = cuts[i + 1]!;
    if (!(to > from)) continue;
    for (const share of SPAN_SAMPLES) {
      const t = from + (to - from) * share;
      const point: Point = [a[0] + dx * t, a[1] + dy * t];
      if (insideRings(rings, point) && distanceToRings(rings, point) > eps) return true;
    }
  }
  return false;
}

/**
 * Where line `index` goes when its first cover is `first`: back over the
 * pieces of `first`'s face just before it, as long as each lies after the
 * line and paints over none of its ink that `first` leaves alone ({@link
 * reachesUncoveredInk}) — before all of them, when none does, so the producer
 * still puts the face back together around the line.
 *
 * The usual case is a crease that leaves a corner of the face and runs on
 * under it: the earlier piece meets it only at that corner, which the cover
 * paints over as well, so drawing the line before the whole face loses
 * nothing the line would have shown.
 */
function runStartFor(
  shapes: readonly DrawShape[],
  index: number,
  first: number,
  line: { a: Point; b: Point },
  reach: number
): number {
  const cover = shapes[first];
  if (cover?.kind !== 'face' || cover.group === undefined) return first;
  let start = first;
  while (start - 1 > index) {
    const piece = shapes[start - 1]!;
    if (piece.kind !== 'face' || piece.group !== cover.group) break;
    if (reachesUncoveredInk(piece.rings, cover.rings, line, reach)) break;
    start -= 1;
  }
  return start;
}

/** Most samples a line is read at: a long line is sampled more coarsely than `reach / 2`. */
const MAX_INK_SAMPLES = 256;

/**
 * Whether a face drawn after the line would paint over ink of it that the
 * cover, drawn after it anyway, does not: a point of the line within `reach`
 * of `piece` and further than that from `cover`. Sampled every half reach.
 */
function reachesUncoveredInk(
  piece: ReadonlyArray<ReadonlyArray<Point>>,
  cover: ReadonlyArray<ReadonlyArray<Point>>,
  { a, b }: { a: Point; b: Point },
  reach: number
): boolean {
  const box = ringsBox(piece);
  const line = segmentBox(a, b, reach);
  if (!box || box.minX > line.maxX || box.maxX < line.minX || box.minY > line.maxY || box.maxY < line.minY) {
    return false;
  }
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.min(MAX_INK_SAMPLES, Math.ceil(length / Math.max(reach / 2, 1e-9))));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (distanceToShape(piece, point) <= reach && distanceToShape(cover, point) > reach) return true;
  }
  return false;
}

/** Zero inside the rings (even-odd); otherwise the distance to their nearest edge. */
function distanceToShape(rings: ReadonlyArray<ReadonlyArray<Point>>, point: Point): number {
  return insideRings(rings, point) ? 0 : distanceToRings(rings, point);
}

/** Where a span between two crossings is sampled: its middle, and halfway to each end. */
const SPAN_SAMPLES = [0.5, 0.25, 0.75] as const;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function segmentBox(a: Point, b: Point, margin: number): Box {
  return {
    minX: Math.min(a[0], b[0]) - margin,
    minY: Math.min(a[1], b[1]) - margin,
    maxX: Math.max(a[0], b[0]) + margin,
    maxY: Math.max(a[1], b[1]) + margin,
  };
}

function ringsBox(rings: ReadonlyArray<ReadonlyArray<Point>>): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

/** Even-odd, over every ring: inside an odd number of them. */
function insideRings(rings: ReadonlyArray<ReadonlyArray<Point>>, [x, y]: Point): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < xj + ((y - yj) / (yi - yj)) * (xi - xj)) inside = !inside;
    }
  }
  return inside;
}

function distanceToRings(rings: ReadonlyArray<ReadonlyArray<Point>>, point: Point): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const distance = distanceToSegment(point, ring[i]!, ring[(i + 1) % ring.length]!);
      if (distance < best) best = distance;
    }
  }
  return best;
}

function distanceToSegment([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** The faces by where they lie, so a line asks only the faces near it. */
interface FaceGrid {
  visit(box: Box, onFace: (index: number) => void): void;
}

function faceGrid(shapes: readonly DrawShape[]): FaceGrid | null {
  const boxes: Array<Box | null> = shapes.map((shape): Box | null =>
    shape.kind === 'face' ? ringsBox(shape.rings) : null
  );
  let faces = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    if (!box) continue;
    faces += 1;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  if (faces === 0) return null;
  const side = Math.max(1, Math.min(MAX_GRID_CELLS, Math.ceil(Math.sqrt(faces))));
  const width = Math.max(maxX - minX, 1e-9);
  const height = Math.max(maxY - minY, 1e-9);
  const column = (x: number) => Math.max(0, Math.min(side - 1, Math.floor(((x - minX) / width) * side)));
  const row = (y: number) => Math.max(0, Math.min(side - 1, Math.floor(((y - minY) / height) * side)));
  const cells: number[][] = Array.from({ length: side * side }, () => []);
  boxes.forEach((box, index) => {
    if (!box) return;
    for (let r = row(box.minY); r <= row(box.maxY); r += 1) {
      for (let c = column(box.minX); c <= column(box.maxX); c += 1) cells[r * side + c]!.push(index);
    }
  });
  return {
    visit(box, onFace) {
      if (box.maxX < minX || box.minX > maxX || box.maxY < minY || box.minY > maxY) return;
      for (let r = row(box.minY); r <= row(box.maxY); r += 1) {
        for (let c = column(box.minX); c <= column(box.maxX); c += 1) {
          for (const index of cells[r * side + c]!) onFace(index);
        }
      }
    },
  };
}
