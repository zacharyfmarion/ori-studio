import type { Point, Point3, Triangle, Visibility } from './types.js';
import {
  area, bounds, clean, clip, depthPlaneInto, difference, edges, keepsTriangle, overlap, partition, partitionBy, separated, triangleArea,
  type Box, type Plane,
} from './polygons.js';

/**
 * Which display layers lie above which, through any chain of known pairs.
 * Neither the pose nor the side the stack is seen from changes it, so a
 * source computes it once.
 */
export interface LayerChains {
  /** Each face's display layer; the pieces of one flat layer share it. */
  layerOf: Int32Array;
  layers: number;
  /** Row length of `above`, in 32-bit words. */
  words: number;
  /** Bit `h` of row `l`: layer `h` lies above layer `l`, seen from the front. */
  above: Uint32Array;
  /** Enough known pairs to imply every chain, as lower, upper layer ids, seen from the front. */
  edges: Int32Array;
}

/** A row per layer: 32 MiB holds about 16 000 layers. */
const MAX_CHAIN_BYTES = 32 << 20;

/** Null for a cyclic stack, which keeps its local masks, or one too large to tabulate. */
export function layerChains(faceCount: number, orders: readonly Point[], planeGroups?: readonly number[]): LayerChains | null {
  const layerOf = new Int32Array(faceCount);
  let layers = faceCount;
  if (planeGroups) {
    const ids = new Map<number, number>();
    planeGroups.forEach((group, face) => {
      let id = ids.get(group);
      if (id === undefined) ids.set(group, (id = ids.size));
      layerOf[face] = id;
    });
    layers = ids.size;
  } else layerOf.forEach((_, face) => (layerOf[face] = face));
  const words = (layers + 31) >>> 5;
  if (layers * words * 4 > MAX_CHAIN_BYTES) return null;
  const out: number[][] = Array.from({ length: layers }, () => []);
  const degree = new Int32Array(layers);
  for (const [lo, hi] of orders) {
    const a = layerOf[lo], b = layerOf[hi];
    if (a === b) continue;
    out[a].push(b);
    degree[b]++;
  }
  const order: number[] = [];
  degree.forEach((n, layer) => n === 0 && order.push(layer));
  for (let i = 0; i < order.length; i++) for (const next of out[order[i]]) if (--degree[next] === 0) order.push(next);
  if (order.length !== layers) return null;
  const position = new Int32Array(layers);
  order.forEach((layer, i) => (position[layer] = i));
  const above = new Uint32Array(layers * words);
  const edges: number[] = [];
  // Nearest layers first: once a layer is above, so is everything above it,
  // and the rest of the stack's pairs cost a bit test instead of a row.
  for (let i = order.length - 1; i >= 0; i--) {
    const layer = order[i], row = layer * words;
    for (const next of out[layer].sort((a, b) => position[a] - position[b])) {
      if (above[row + (next >>> 5)] & (1 << (next & 31))) continue;
      above[row + (next >>> 5)] |= 1 << (next & 31);
      for (let w = 0, other = next * words; w < words; w++) above[row + w] |= above[other + w];
      edges.push(layer, next);
    }
  }
  return { layerOf, layers, words, above, edges: Int32Array.from(edges) };
}

/** Where two unrelated layers overlap: lower-id layer nearer somewhere, higher-id layer nearer somewhere. */
const LOWER_NEARER = 1, HIGHER_NEARER = 2;

/** The drawn mesh, and each face's ring when the host has it: a convex face hides as one piece. */
export interface PoseMesh {
  positions: readonly Point3[];
  triangles: readonly Triangle[];
  triangleFaces: readonly number[];
  rings?: readonly (readonly number[])[];
}

/**
 * The drawn pose in flat rows. A triangle `clean` drops, or one without a
 * depth plane, is left out of its face; the rows of the others hold the
 * numbers `clean`, `depthPlane`, `bounds` and `area` give.
 */
interface Posed {
  /** Per triangle, six: its corners' x, y. */
  corners: Float64Array;
  /** Per triangle, four: x0, y0, x1, y1. */
  boxes: Float64Array;
  /** Per triangle, five: the depth plane's x and y slopes, depth, origin x, y. */
  plane: Float64Array;
  /** Per triangle: 1 where its corners wind with positive area, else -1. */
  winding: Int8Array;
  /** Face `f`'s drawable triangles are `triangles[triangleStart[f]..triangleStart[f + 1])`. */
  triangleStart: Int32Array;
  triangles: Int32Array;
  /** Per face, four: the box round its drawable triangles. */
  faceBoxes: Float64Array;
  /**
   * Of the faces whose boxes overlap face `f`, in the order the sweep finds
   * them: those above its layer through a chain, its blockers, and those of
   * layers no chain relates to its own.
   */
  blockers: Grouped;
  unrelated: Grouped;
}

/** Lists per face: face `f`'s is `items[start[f]..start[f + 1])`. */
interface Grouped {
  start: Int32Array;
  items: Int32Array;
}

/** `data`, with room for twice as much. */
function grown(data: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const more = new Int32Array(2 * data.length);
  more.set(data);
  return more;
}

/**
 * Each face's members from the first `length` of `data` (face, member, …), in
 * their order; `mirror` also lists each face under its member.
 */
function grouped(data: Int32Array, length: number, faceCount: number, mirror: boolean): Grouped {
  const start = new Int32Array(faceCount + 1);
  for (let i = 0; i < length; i += 2) {
    start[data[i] + 1]++;
    if (mirror) start[data[i + 1] + 1]++;
  }
  for (let f = 0; f < faceCount; f++) start[f + 1] += start[f];
  const items = new Int32Array(start[faceCount]);
  const cursor = start.slice(0, faceCount);
  for (let i = 0; i < length; i += 2) {
    const f = data[i], g = data[i + 1];
    items[cursor[f]++] = g;
    if (mirror) items[cursor[g]++] = f;
  }
  return { start, items };
}

/** Box `a` overlaps row `i` of `boxes`, edges included. */
const overlapAt = (a: Box, boxes: Float64Array, i: number) =>
  a[0] <= boxes[4 * i + 2] && boxes[4 * i] <= a[2] && a[1] <= boxes[4 * i + 3] && boxes[4 * i + 1] <= a[3];

/**
 * Drawable triangles, and every pair of faces whose boxes overlap, by an X
 * sweep, sorted as they are found into blockers and unrelated faces; null past
 * the budget.
 */
function posed(mesh: PoseMesh, chains: LayerChains, back: boolean, budget = 4_000_000): Posed | null {
  const { layerOf, words, above } = chains;
  const faceCount = layerOf.length;
  const { positions, triangleFaces } = mesh;
  const count = mesh.triangles.length;
  const corners = new Float64Array(6 * count), boxes = new Float64Array(4 * count), plane = new Float64Array(5 * count);
  const winding = new Int8Array(count), drawable = new Uint8Array(count);
  const triangleStart = new Int32Array(faceCount + 1);
  for (let t = 0; t < count; t++) {
    const ids = mesh.triangles[t];
    const u = ids[0], v = ids[1], w = ids[2];
    const a = positions[u], b = positions[v], c = positions[w];
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
    if (!keepsTriangle(ax, ay, bx, by, cx, cy) || !depthPlaneInto(a, b, c, plane, 5 * t)) continue;
    drawable[t] = 1;
    triangleStart[triangleFaces[t] + 1]++;
    corners[6 * t] = ax;
    corners[6 * t + 1] = ay;
    corners[6 * t + 2] = bx;
    corners[6 * t + 3] = by;
    corners[6 * t + 4] = cx;
    corners[6 * t + 5] = cy;
    boxes[4 * t] = Math.min(Math.min(Math.min(Infinity, ax), bx), cx);
    boxes[4 * t + 1] = Math.min(Math.min(Math.min(Infinity, ay), by), cy);
    boxes[4 * t + 2] = Math.max(Math.max(Math.max(-Infinity, ax), bx), cx);
    boxes[4 * t + 3] = Math.max(Math.max(Math.max(-Infinity, ay), by), cy);
    winding[t] = triangleArea(ax, ay, bx, by, cx, cy) > 0 ? 1 : -1;
  }
  for (let f = 0; f < faceCount; f++) triangleStart[f + 1] += triangleStart[f];
  const triangles = new Int32Array(triangleStart[faceCount]);
  const fill = triangleStart.slice(0, faceCount);
  for (let t = 0; t < count; t++) if (drawable[t]) triangles[fill[triangleFaces[t]]++] = t;
  const faceBoxes = new Float64Array(4 * faceCount);
  const sorted: number[] = [];
  for (let f = 0; f < faceCount; f++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = triangleStart[f]; i < triangleStart[f + 1]; i++) {
      const b = 4 * triangles[i];
      x0 = Math.min(x0, boxes[b]);
      y0 = Math.min(y0, boxes[b + 1]);
      x1 = Math.max(x1, boxes[b + 2]);
      y1 = Math.max(y1, boxes[b + 3]);
    }
    faceBoxes[4 * f] = x0;
    faceBoxes[4 * f + 1] = y0;
    faceBoxes[4 * f + 2] = x1;
    faceBoxes[4 * f + 3] = y1;
    if (triangleStart[f + 1] > triangleStart[f]) sorted.push(f);
  }
  sorted.sort((a, b) => faceBoxes[4 * a] - faceBoxes[4 * b]);
  // Each pair as it is found, so every face lists its blockers and unrelated
  // faces in one order: by where they sort.
  let blocking = new Int32Array(16 * sorted.length + 16), unrelated = new Int32Array(2 * sorted.length + 16);
  let blockingLength = 0, unrelatedLength = 0;
  const active = new Int32Array(sorted.length);
  let live = 0, work = 0;
  for (const g of sorted) {
    const gx0 = faceBoxes[4 * g], gy0 = faceBoxes[4 * g + 1], gx1 = faceBoxes[4 * g + 2], gy1 = faceBoxes[4 * g + 3];
    const lg = layerOf[g];
    let kept = 0;
    for (let i = 0; i < live; i++) {
      const f = active[i], b = 4 * f;
      if (faceBoxes[b + 2] < gx0) continue;
      active[kept++] = f;
      if (++work > budget) return null;
      if (!(faceBoxes[b] <= gx1 && gx0 <= faceBoxes[b + 2] && faceBoxes[b + 1] <= gy1 && gy0 <= faceBoxes[b + 3])) continue;
      const lf = layerOf[f];
      if (lf === lg) continue;
      // Layer `lg` above `lf` through a chain, seen from the front; and the other way.
      const up = (above[lf * words + (lg >>> 5)] >>> (lg & 31)) & 1, down = (above[lg * words + (lf >>> 5)] >>> (lf & 31)) & 1;
      if (!up && !down) {
        if (unrelatedLength + 2 > unrelated.length) unrelated = grown(unrelated);
        unrelated[unrelatedLength++] = f;
        unrelated[unrelatedLength++] = g;
        continue;
      }
      if (blockingLength + 4 > blocking.length) blocking = grown(blocking);
      // Seen from the back, the stack reads the other way up.
      if (back ? down : up) {
        blocking[blockingLength++] = f;
        blocking[blockingLength++] = g;
      }
      if (back ? up : down) {
        blocking[blockingLength++] = g;
        blocking[blockingLength++] = f;
      }
    }
    live = kept;
    active[live++] = g;
  }
  return {
    corners, boxes, plane, winding, triangleStart, triangles, faceBoxes,
    blockers: grouped(blocking, blockingLength, faceCount, false),
    unrelated: grouped(unrelated, unrelatedLength, faceCount, true),
  };
}

const scratch = [new Float64Array(64), new Float64Array(64)];
/** Where intersect left its last overlap. */
let clipped = scratch[0];
/**
 * Where triangle `s` overlaps triangle `t`, whose corners wind by `sign`, as
 * flat x, y in `clipped`; its length, 0 when they share no area.
 */
function intersect(corners: Float64Array, s: number, t: number, sign: number): number {
  let [polygon, next] = scratch;
  let length = 6;
  for (let i = 0; i < 6; i++) polygon[i] = corners[6 * s + i];
  for (let e = 0; e < 3 && length >= 6; e++) {
    const a = 6 * t + 2 * e, b = 6 * t + 2 * ((e + 1) % 3);
    const ax = corners[a], ay = corners[a + 1], bx = corners[b], by = corners[b + 1];
    let out = 0;
    for (let i = 0; i < length; i += 2) {
      const j = (i + 2) % length;
      const u = sign * ((bx - ax) * (polygon[i + 1] - ay) - (by - ay) * (polygon[i] - ax));
      const v = sign * ((bx - ax) * (polygon[j + 1] - ay) - (by - ay) * (polygon[j] - ax));
      if (u >= 0) (next[out++] = polygon[i]), (next[out++] = polygon[i + 1]);
      if (u >= 0 !== v >= 0) {
        const k = u / (u - v);
        next[out++] = polygon[i] + k * (polygon[j] - polygon[i]);
        next[out++] = polygon[i + 1] + k * (polygon[j + 1] - polygon[i + 1]);
      }
    }
    const done = next;
    next = polygon;
    polygon = done;
    length = out;
  }
  clipped = polygon;
  return length >= 6 ? length : 0;
}

/** Which of triangles `s`, `t` is nearer at `x`, `y`: bit 1 `s`, bit 2 `t`, 0 within the tolerance. */
function nearerAt(plane: Float64Array, s: number, t: number, x: number, y: number, tolerance: number): number {
  const a = 5 * s, b = 5 * t;
  const d = plane[a] * (x - plane[a + 3]) + plane[a + 1] * (y - plane[a + 4]) + plane[a + 2] - (plane[b] * (x - plane[b + 3]) + plane[b + 1] * (y - plane[b + 4]) + plane[b + 2]);
  return d > tolerance ? LOWER_NEARER : d < -tolerance ? HIGHER_NEARER : 0;
}

/** Which of triangles `s`, `t` is nearer at any of the first `length` of `points` (flat x, y): bit 1 `s`, bit 2 `t`. */
function nearer(plane: Float64Array, s: number, t: number, points: ArrayLike<number>, length: number, tolerance: number): number {
  let bits = 0;
  for (let i = 0; i < length; i += 2) bits |= nearerAt(plane, s, t, points[i], points[i + 1], tolerance);
  return bits;
}

/** A convex face's ring, with what `holds` needs of it: winding, and each edge's length. */
interface ConvexRing {
  points: Point[];
  sign: number;
  lengths: Float64Array;
}

/** A drawn face that is convex hides as one mask. Others, null, mask triangle by triangle. */
function convexRing(mesh: PoseMesh, face: number): ConvexRing | null {
  if (!mesh.rings || face >= mesh.rings.length) return null;
  const ring = clean(mesh.rings[face].map((v) => [mesh.positions[v][0], mesh.positions[v][1]] as Point));
  if (ring.length < 3) return null;
  // Every turn the same way and once round: a simple convex ring.
  let sign = 0, turning = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (cross === 0) continue;
    if (sign && Math.sign(cross) !== sign) return null;
    sign = Math.sign(cross);
    turning += Math.atan2(cross, dot);
  }
  if (!(Math.abs(Math.abs(turning) - 2 * Math.PI) < 1e-6)) return null;
  const lengths = new Float64Array(ring.length);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    lengths[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return { points: ring, sign: area(ring) > 0 ? 1 : -1, lengths };
}

/**
 * The visibility a pose draws with. A face hides another wherever it lies
 * above it through a chain of known pairs; where no chain relates two faces,
 * the nearer shows. Global ranks give the first part: they also rank layers
 * no chain relates, though, by how deep each sits in its own stack, and the
 * spread can slide a buried layer over a neighbouring stack's top while lying
 * physically under it.
 *
 * So wherever the pose shows two unrelated layers together — overlapping, and
 * neither hidden there by a layer above it — the nearer must not rank lower,
 * and two whose depths cross there must share a rank, where physical depth
 * decides each pixel. When the stack's ranks already meet that, they come back
 * unchanged. Else the ranks are re-solved with those pairs; when no ranks can
 * meet them (a chain the depths contradict), the pose draws with masks of the
 * faces above through a chain that each face overlaps. Cyclic stacks keep
 * their direct masks.
 */
export function poseVisibility(
  base: Visibility,
  chains: LayerChains | null,
  mesh: PoseMesh,
  back: boolean,
  options: { unseen: number } = { unseen: 1e-7 },
): Visibility {
  if (!base.ranks || !chains || base.planeOf) return base;
  const { layerOf, layers, words, above } = chains;
  const bit = (lower: number, upper: number) => (above[lower * words + (upper >>> 5)] >>> (upper & 31)) & 1;
  let xLo = Infinity, yLo = Infinity, zLo = Infinity, xHi = -Infinity, yHi = -Infinity, zHi = -Infinity;
  for (const p of mesh.positions) {
    const x = p[0], y = p[1], z = p[2];
    xLo = Math.min(xLo, x); xHi = Math.max(xHi, x);
    yLo = Math.min(yLo, y); yHi = Math.max(yHi, y);
    zLo = Math.min(zLo, z); zHi = Math.max(zHi, z);
  }
  if (!(zHi > zLo)) return base;
  // Overlaps smaller than this share of the picture's square are left to the
  // ranks — a tenth of a pixel in a 1000 px figure. Such slivers, strips that
  // touch flat crossing by a hair once spread, would otherwise force masks.
  const unseen = options.unseen * Math.max(xHi - xLo, yHi - yLo) ** 2, tolerance = 1e-9 * (zHi - zLo);
  const faceCount = layerOf.length;
  const geometry = posed(mesh, chains, back);
  // Past the budget the vector capture refuses the pose too; keep today's ranks.
  if (!geometry) return base;
  const { corners, boxes, plane, winding, triangleStart, triangles, faceBoxes, blockers, unrelated } = geometry;
  const triangleCount = winding.length;
  // What clipping a triangle against masks needs, built only for those that do.
  const polygons: (Point[] | undefined)[] = new Array(triangleCount), planes: (Plane | undefined)[] = new Array(triangleCount);
  const polygonOf = (t: number): Point[] =>
    (polygons[t] ??= [[corners[6 * t], corners[6 * t + 1]], [corners[6 * t + 2], corners[6 * t + 3]], [corners[6 * t + 4], corners[6 * t + 5]]]);
  const planeOf = (t: number): Plane =>
    (planes[t] ??= { x: plane[5 * t], y: plane[5 * t + 1], z: plane[5 * t + 2], origin: [plane[5 * t + 3], plane[5 * t + 4]] });
  const faces = mesh.triangleFaces;

  // Triangle pairs of faces no chain relates, lower layer id first. Their
  // depth bits over the common box hold the overlap's (depth is affine): most
  // pairs the ranks already order are settled without clipping. Five per
  // pair: its triangles, their layers, and those bits.
  let pairs = new Int32Array(5 * 256), pairCount = 0;
  for (let f = 0; f < faceCount; f++) {
    const lf = layerOf[f];
    for (let n = unrelated.start[f]; n < unrelated.start[f + 1]; n++) {
      const g = unrelated.items[n], lg = layerOf[g];
      if (lg <= lf) continue;
      for (let i = triangleStart[f]; i < triangleStart[f + 1]; i++) {
        const s = triangles[i], a = 4 * s;
        for (let j = triangleStart[g]; j < triangleStart[g + 1]; j++) {
          const t = triangles[j], b = 4 * t;
          if (!(boxes[a] <= boxes[b + 2] && boxes[b] <= boxes[a + 2] && boxes[a + 1] <= boxes[b + 3] && boxes[b + 1] <= boxes[a + 3])) continue;
          const x0 = Math.max(boxes[a], boxes[b]), y0 = Math.max(boxes[a + 1], boxes[b + 1]);
          const x1 = Math.min(boxes[a + 2], boxes[b + 2]), y1 = Math.min(boxes[a + 3], boxes[b + 3]);
          const boxed =
            nearerAt(plane, s, t, x0, y0, tolerance) | nearerAt(plane, s, t, x1, y0, tolerance) |
            nearerAt(plane, s, t, x1, y1, tolerance) | nearerAt(plane, s, t, x0, y1, tolerance);
          if (!boxed) continue;
          if (5 * pairCount === pairs.length) {
            const grown = new Int32Array(2 * pairs.length);
            grown.set(pairs);
            pairs = grown;
          }
          const at = 5 * pairCount++;
          pairs[at] = s;
          pairs[at + 1] = t;
          pairs[at + 2] = lf;
          pairs[at + 3] = lg;
          pairs[at + 4] = boxed;
        }
      }
    }
  }
  if (!pairCount) return base;
  /** Per pair, the depth bits over its overlap and where both are shown; -1 until asked. */
  const wholeBits = new Int8Array(pairCount).fill(-1), shownBits = new Int8Array(pairCount).fill(-1);
  /** Depth bits over the pair's overlap; 0 when they only touch. */
  const whole = (p: number) => {
    if (wholeBits[p] >= 0) return wholeBits[p];
    const s = pairs[5 * p], t = pairs[5 * p + 1];
    const length = intersect(corners, s, t, winding[t]);
    let twice = 0;
    for (let i = 0; i < length; i += 2) {
      const j = (i + 2) % length;
      twice += clipped[i] * clipped[j + 1] - clipped[j] * clipped[i + 1];
    }
    // Layers that only touch along an edge share no pixel.
    return (wholeBits[p] = Math.abs(twice) / 2 > unseen ? nearer(plane, s, t, clipped, length, tolerance) : 0);
  };
  const rankOf = new Int32Array(layers);
  for (let face = 0; face < faceCount; face++) rankOf[layerOf[face]] = base.ranks[face];
  const violates = (p: number, bits: number, rank: ArrayLike<number>) => {
    const lo = rank[pairs[5 * p + 2]], hi = rank[pairs[5 * p + 3]];
    return bits === LOWER_NEARER ? lo < hi : bits === HIGHER_NEARER ? hi < lo : bits !== 0 && lo !== hi;
  };
  const ringCache: (ConvexRing | null | undefined)[] = new Array(faceCount);
  const ringOf = (face: number) => (ringCache[face] === undefined ? (ringCache[face] = convexRing(mesh, face)) : ringCache[face]);
  /** A mask's edges, once per convex face or triangle that cuts. */
  const ringEdges: (Plane[] | undefined)[] = new Array(faceCount), triangleEdges: (Plane[] | undefined)[] = new Array(triangleCount);
  /** Faces over face `f`'s box that lie above its layer through a chain. */
  const blockersOf = (f: number) => blockers.items.subarray(blockers.start[f], blockers.start[f + 1]);
  const mark = new Int32Array(faceCount);
  let stamp = 0;
  const edge = 1e-9 * Math.max(xHi - xLo, yHi - yLo);
  /** Convex `ring` holds every point of `outline` (flat x, y), its boundary included. */
  const holds = (ring: ConvexRing, outline: Float64Array) => {
    const { points, sign, lengths } = ring;
    for (let i = 0; i < points.length; i++) {
      const ax = points[i][0], ay = points[i][1], next = points[(i + 1) % points.length], bx = next[0], by = next[1];
      const length = lengths[i];
      for (let k = 0; k < outline.length; k += 2) {
        const x = outline[k], y = outline[k + 1];
        if (sign * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < -edge * length) return false;
      }
    }
    return true;
  };
  /** Some convex face of `list`, its box round `box`, holds all of `outline`. */
  const heldBy = (list: Int32Array, box: Box, outline: Float64Array) => {
    for (let i = 0; i < list.length; i++) {
      const face = list[i], b = 4 * face;
      if (!(faceBoxes[b] <= box[0] && faceBoxes[b + 1] <= box[1] && box[2] <= faceBoxes[b + 2] && box[3] <= faceBoxes[b + 3])) continue;
      const ring = ringOf(face);
      if (ring && holds(ring, outline)) return true;
    }
    return false;
  };
  /** Depth bits where both are shown: their overlap less every face above either through a chain. */
  const shown = (p: number) => {
    if (shownBits[p] >= 0) return shownBits[p];
    const s = pairs[5 * p], t = pairs[5 * p + 1];
    // The overlap `whole` found, again.
    const length = intersect(corners, s, t, winding[t]);
    const overlapped = clipped.slice(0, length);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < overlapped.length; i += 2) {
      x0 = Math.min(x0, overlapped[i]);
      y0 = Math.min(y0, overlapped[i + 1]);
      x1 = Math.max(x1, overlapped[i]);
      y1 = Math.max(y1, overlapped[i + 1]);
    }
    const box: Box = [x0, y0, x1, y1];
    const lists = [blockersOf(faces[s]), blockersOf(faces[t])];
    shownBits[p] = 0;
    // Usually one convex face above hides the whole overlap.
    if (heldBy(lists[0], box, overlapped) || heldBy(lists[1], box, overlapped)) return 0;
    const outline: Point[] = [];
    for (let i = 0; i < overlapped.length; i += 2) outline.push([overlapped[i], overlapped[i + 1]]);
    // Each piece with its box, which every mask tests.
    let pieces = [outline], pieceBoxes = [box];
    /** Cut every piece by one mask, its edges and its box in row `at` of `rows`. */
    const cut = (halfplanes: readonly Plane[], rows: Float64Array, at: number) => {
      const kept: Point[][] = [], keptBoxes: Box[] = [];
      for (let k = 0; k < pieces.length; k++) {
        const piece = pieces[k], pieceBox = pieceBoxes[k];
        if (!overlapAt(pieceBox, rows, at) || separated(piece, halfplanes)) {
          kept.push(piece);
          keptBoxes.push(pieceBox);
          continue;
        }
        for (const part of partitionBy(piece, halfplanes).outside) {
          kept.push(part);
          keptBoxes.push(part === piece ? pieceBox : bounds(part));
        }
      }
      pieces = kept;
      pieceBoxes = keptBoxes;
    };
    stamp++;
    for (const list of lists)
      for (const face of list) {
        if (mark[face] === stamp || !overlapAt(box, faceBoxes, face)) continue;
        mark[face] = stamp;
        const ring = ringOf(face);
        if (ring) {
          cut((ringEdges[face] ??= edges(ring.points)), faceBoxes, face);
          if (!pieces.length) return 0;
          continue;
        }
        for (let i = triangleStart[face]; i < triangleStart[face + 1]; i++) {
          const v = triangles[i];
          cut((triangleEdges[v] ??= edges(polygonOf(v))), boxes, v);
          if (!pieces.length) return 0;
        }
      }
    const seen = (region: readonly Point[][]) => region.reduce((sum, piece) => sum + Math.abs(area(piece)), 0) > unseen;
    if (!seen(pieces)) return 0;
    const ls = layerOf[faces[s]], lt = layerOf[faces[t]];
    /** Triangle `a` nearer than triangle `b` by more than the tolerance: a half-plane. */
    const ahead = (a: number, b: number): Plane => {
      const delta = difference(planeOf(a), planeOf(b));
      return { ...delta, z: delta.z - tolerance };
    };
    /**
     * Whether triangle `front` shows over `far` somewhere both are shown: only
     * there can their ranks decide a pixel. A face nearer still, with nothing
     * above it through a chain anywhere here, shows instead wherever it reaches.
     */
    const wins = (front: number, far: number) => {
      const ln = layerOf[faces[front]];
      let region = pieces.flatMap((piece) => {
        const part = clip(piece, ahead(front, far));
        return part.length ? [part] : [];
      });
      if (!seen(region)) return false;
      const reach = bounds(region.flat());
      // Of the faces over front's box, only those no chain relates to it pass.
      const of = faces[front];
      for (let n = unrelated.start[of]; n < unrelated.start[of + 1]; n++) {
        const u = unrelated.items[n], lu = layerOf[u];
        if (lu === ls || lu === lt || bit(lu, ln) || bit(ln, lu) || !overlapAt(reach, faceBoxes, u)) continue;
        if (blockersOf(u).some((face) => overlapAt(reach, faceBoxes, face))) continue;
        for (let i = triangleStart[u]; i < triangleStart[u + 1]; i++) {
          const v = triangles[i];
          if (!overlapAt(reach, boxes, v)) continue;
          const mask = clip(polygonOf(v), ahead(v, front));
          if (!mask.length) continue;
          const masked = bounds(mask);
          region = region.flatMap((piece) => (overlap(bounds(piece), masked) ? partition(piece, mask).outside : [piece]));
          if (!region.length) return false;
        }
      }
      return seen(region);
    };
    if (wins(s, t)) shownBits[p] |= LOWER_NEARER;
    if (wins(t, s)) shownBits[p] |= HIGHER_NEARER;
    return shownBits[p];
  };
  /**
   * Chained layer pairs whose faces' boxes overlap, lower then upper as seen.
   * Only these need a step up: chained layers the pose keeps apart can rank
   * either way, and a chain the depths contradict elsewhere often has that room.
   */
  const overlappingChains = () => {
    const facesOfLayer: number[][] = Array.from({ length: layers }, () => []);
    layerOf.forEach((layer, face) => facesOfLayer[layer].push(face));
    const reached = new Int32Array(layers).fill(-1), out: number[] = [];
    facesOfLayer.forEach((members, lower) => {
      for (const f of members)
        for (const g of blockersOf(f)) {
          const upper = layerOf[g];
          if (reached[upper] === lower) continue;
          reached[upper] = lower;
          out.push(lower, upper);
        }
    });
    return out;
  };
  const stackChains = back ? chains.edges.map((_, i, e) => e[i ^ 1]) : chains.edges;
  let posedChains: number[] | undefined;
  // Constraints only grow, each round by bits the last ranks broke, so this ends.
  const constraints = new Map<number, number>();
  let rank: ArrayLike<number> = rankOf;
  for (;;) {
    let grew = false;
    for (let p = 0; p < pairCount; p++) {
      const key = pairs[5 * p + 2] * layers + pairs[5 * p + 3], boxed = pairs[5 * p + 4];
      const known = constraints.get(key) ?? 0;
      // A pair adds only bits its layers lack. Its shown bits are among its
      // whole ones, which are among its boxed ones, so each test can only drop it.
      if ((boxed & ~known) === 0 || !violates(p, boxed, rank)) continue;
      const overall = whole(p);
      if ((overall & ~known) === 0 || !violates(p, overall, rank)) continue;
      const bits = shown(p);
      if ((bits & ~known) === 0 || !violates(p, bits, rank)) continue;
      constraints.set(key, known | bits);
      grew = true;
    }
    if (!grew) break;
    // The stack's own chains first. Only chained layers the pose overlaps need
    // a step, though, which leaves room when a chain the depths contradict
    // runs through layers kept apart; finding those pairs costs a pass.
    let solved = depthRanks(layers, stackChains, constraints);
    if (!solved) solved = depthRanks(layers, (posedChains ??= overlappingChains()), constraints);
    // Masks of every face above through a chain that each face overlaps.
    if (!solved) return { ranks: null, cyclic: false, above: Array.from(layerOf, (_, f) => [...blockersOf(f)].sort((a, b) => a - b)) };
    rank = solved;
  }
  if (rank === rankOf) return base;
  return { ...base, ranks: Array.from(layerOf, (layer) => rank[layer]), cyclic: false };
}

/**
 * Longest-path ranks over `strict` lower, upper layer pairs (each a step up)
 * and the pose's depth pairs (the nearer at least as high). A cycle of depth
 * pairs alone shares one rank; null when a cycle takes a step, which no ranks
 * can meet.
 */
function depthRanks(layers: number, strict: ArrayLike<number>, pairs: ReadonlyMap<number, number>): Int32Array | null {
  // Edges as flat arrays by source: target and step.
  const from: number[] = [], to: number[] = [], steps: number[] = [];
  for (let i = 0; i < strict.length; i += 2) from.push(strict[i]), to.push(strict[i + 1]), steps.push(1);
  for (const [key, bits] of pairs) {
    const a = Math.floor(key / layers), b = key % layers;
    if (bits & LOWER_NEARER) from.push(b), to.push(a), steps.push(0);
    if (bits & HIGHER_NEARER) from.push(a), to.push(b), steps.push(0);
  }
  const first = new Int32Array(layers + 1);
  for (const v of from) first[v + 1]++;
  for (let v = 0; v < layers; v++) first[v + 1] += first[v];
  const fill = first.slice(0, layers), target = new Int32Array(to.length), step = new Uint8Array(to.length);
  from.forEach((v, i) => {
    target[fill[v]] = to[i];
    step[fill[v]++] = steps[i];
  });
  // Tarjan, iteratively: components come out in reverse topological order.
  const index = new Int32Array(layers).fill(-1), low = new Int32Array(layers), component = new Int32Array(layers);
  const stack = new Int32Array(layers), onStack = new Uint8Array(layers), frames = new Int32Array(layers), cursor = new Int32Array(layers);
  let next = 0, top = 0, components = 0;
  for (let root = 0; root < layers; root++) {
    if (index[root] >= 0) continue;
    let depth = 0;
    frames[0] = root;
    cursor[root] = first[root];
    index[root] = low[root] = next++;
    stack[top++] = root;
    onStack[root] = 1;
    while (depth >= 0) {
      const v = frames[depth];
      if (cursor[v] < first[v + 1]) {
        const w = target[cursor[v]++];
        if (index[w] < 0) {
          index[w] = low[w] = next++;
          stack[top++] = w;
          onStack[w] = 1;
          cursor[w] = first[w];
          frames[++depth] = w;
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      if (--depth >= 0) low[frames[depth]] = Math.min(low[frames[depth]], low[v]);
      if (low[v] !== index[v]) continue;
      let w: number;
      do {
        w = stack[--top];
        onStack[w] = 0;
        component[w] = components;
      } while (w !== v);
      components++;
    }
  }
  // Highest component first is topological order: sources before what they reach.
  const byComponent: number[][] = Array.from({ length: components }, () => []);
  component.forEach((c, v) => byComponent[c].push(v));
  const rank = new Int32Array(components);
  for (let c = components - 1; c >= 0; c--)
    for (const v of byComponent[c])
      for (let e = first[v]; e < first[v + 1]; e++) {
        const d = component[target[e]];
        if (d === c) {
          if (step[e]) return null;
          continue;
        }
        rank[d] = Math.max(rank[d], rank[c] + step[e]);
      }
  return Int32Array.from(component, (c) => rank[c]);
}
