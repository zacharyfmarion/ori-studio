import type { Point, Point3, Triangle, Visibility } from './types.js';
import { area, bounds, clean, clip, depthPlane, difference, overlap, partition, type Box, type Plane } from './polygons.js';

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

interface Posed {
  polygons: Point[][];
  planes: (Plane | null)[];
  boxes: Box[];
  /** Per face, its drawable triangles, the box round them, and the faces whose boxes overlap it. */
  trianglesOf: number[][];
  faceBoxes: Box[];
  near: number[][];
}

/** Drawable triangles, and every pair of faces whose boxes overlap, by an X sweep; null past the budget. */
function posed(mesh: PoseMesh, faceCount: number, budget = 4_000_000): Posed | null {
  const polygons = mesh.triangles.map((ids) => clean(ids.map((v) => [mesh.positions[v][0], mesh.positions[v][1]] as Point)));
  const planes = mesh.triangles.map((ids) => depthPlane(ids.map((v) => mesh.positions[v])));
  const boxes = polygons.map(bounds);
  const trianglesOf: number[][] = Array.from({ length: faceCount }, () => []);
  mesh.triangleFaces.forEach((face, t) => polygons[t].length && planes[t] && trianglesOf[face].push(t));
  const faceBoxes = trianglesOf.map((ids) => {
    const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const t of ids) {
      box[0] = Math.min(box[0], boxes[t][0]);
      box[1] = Math.min(box[1], boxes[t][1]);
      box[2] = Math.max(box[2], boxes[t][2]);
      box[3] = Math.max(box[3], boxes[t][3]);
    }
    return box;
  });
  const near = trianglesOf.map((): number[] => []);
  const sorted = trianglesOf.flatMap((ids, f) => (ids.length ? [f] : [])).sort((a, b) => faceBoxes[a][0] - faceBoxes[b][0]);
  const active: number[] = [];
  let work = 0;
  for (const g of sorted) {
    let kept = 0;
    for (let i = 0; i < active.length; i++) {
      const f = active[i];
      if (faceBoxes[f][2] < faceBoxes[g][0]) continue;
      active[kept++] = f;
      if (++work > budget) return null;
      if (!overlap(faceBoxes[f], faceBoxes[g])) continue;
      near[f].push(g);
      near[g].push(f);
    }
    active.length = kept;
    active.push(g);
  }
  return { polygons, planes, boxes, trianglesOf, faceBoxes, near };
}

const scratch = [new Float64Array(64), new Float64Array(64)];
/** Where convex polygons `a` (at most 16 corners) and `b` overlap, as flat x, y. */
function intersect(a: readonly Point[], b: readonly Point[]): number[] {
  let [polygon, next] = scratch;
  let length = 0;
  for (const [x, y] of a) (polygon[length++] = x), (polygon[length++] = y);
  const sign = area(b) > 0 ? 1 : -1;
  for (let e = 0; e < b.length && length >= 6; e++) {
    const [ax, ay] = b[e], [bx, by] = b[(e + 1) % b.length];
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
    [polygon, next] = [next, polygon];
    length = out;
  }
  return length >= 6 ? Array.from(polygon.subarray(0, length)) : [];
}

/** Which of triangles `s`, `t` is nearer at any of `points` (flat x, y): bit 1 `s`, bit 2 `t`. */
function nearer(planes: Posed['planes'], s: number, t: number, points: readonly number[], tolerance: number): number {
  const a = planes[s]!, b = planes[t]!;
  let bits = 0;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1];
    const d = a.x * (x - a.origin[0]) + a.y * (y - a.origin[1]) + a.z - (b.x * (x - b.origin[0]) + b.y * (y - b.origin[1]) + b.z);
    if (d > tolerance) bits |= LOWER_NEARER;
    else if (d < -tolerance) bits |= HIGHER_NEARER;
  }
  return bits;
}

/** Drawn faces that are convex: one mask each. Others mask triangle by triangle. */
function convexRings(mesh: PoseMesh): (Point[] | null)[] {
  const count = mesh.rings?.length ?? 0;
  return Array.from({ length: count }, (_, face) => {
    const ring = clean(mesh.rings![face].map((v) => [mesh.positions[v][0], mesh.positions[v][1]] as Point));
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
    return Math.abs(Math.abs(turning) - 2 * Math.PI) < 1e-6 ? ring : null;
  });
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
  /** Layer `upper` lies above layer `lower` through a chain, seen from this side. */
  const rises = back ? (lower: number, upper: number) => bit(upper, lower) : bit;
  let xLo = Infinity, yLo = Infinity, zLo = Infinity, xHi = -Infinity, yHi = -Infinity, zHi = -Infinity;
  for (const [x, y, z] of mesh.positions) {
    xLo = Math.min(xLo, x); xHi = Math.max(xHi, x);
    yLo = Math.min(yLo, y); yHi = Math.max(yHi, y);
    zLo = Math.min(zLo, z); zHi = Math.max(zHi, z);
  }
  if (!(zHi > zLo)) return base;
  // Overlaps smaller than this share of the picture's square are left to the
  // ranks — a tenth of a pixel in a 1000 px figure. Such slivers, strips that
  // touch flat crossing by a hair once spread, would otherwise force masks.
  const unseen = options.unseen * Math.max(xHi - xLo, yHi - yLo) ** 2, tolerance = 1e-9 * (zHi - zLo);
  const geometry = posed(mesh, layerOf.length);
  // Past the budget the vector capture refuses the pose too; keep today's ranks.
  if (!geometry) return base;
  const { polygons, planes, boxes, trianglesOf, faceBoxes, near } = geometry;
  const faces = mesh.triangleFaces;

  // Triangle pairs of faces no chain relates, lower layer id first. Their
  // depth bits over the common box hold the overlap's (depth is affine): most
  // pairs the ranks already order are settled without clipping.
  interface Pair { s: number; t: number; key: number; boxed: number; whole: number; overlap: number[]; shown: number | null }
  const pairs: Pair[] = [];
  const corners: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  near.forEach((list, f) => {
    const lf = layerOf[f];
    for (const g of list) {
      const lg = layerOf[g];
      if (lg <= lf || bit(lf, lg) || bit(lg, lf)) continue;
      for (const s of trianglesOf[f])
        for (const t of trianglesOf[g]) {
          const a = boxes[s], b = boxes[t];
          if (!overlap(a, b)) continue;
          const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]);
          corners[0] = corners[6] = x0;
          corners[2] = corners[4] = x1;
          corners[1] = corners[3] = y0;
          corners[5] = corners[7] = y1;
          const boxed = nearer(planes, s, t, corners, tolerance);
          if (boxed) pairs.push({ s, t, key: lf * layers + lg, boxed, whole: -1, overlap: [], shown: null });
        }
    }
  });
  if (!pairs.length) return base;
  /** Depth bits over the pair's overlap; 0 when they only touch. */
  const whole = (pair: Pair) => {
    if (pair.whole >= 0) return pair.whole;
    const overlap = intersect(polygons[pair.s], polygons[pair.t]);
    let twice = 0;
    for (let i = 0; i < overlap.length; i += 2) {
      const j = (i + 2) % overlap.length;
      twice += overlap[i] * overlap[j + 1] - overlap[j] * overlap[i + 1];
    }
    // Layers that only touch along an edge share no pixel.
    pair.overlap = overlap;
    return (pair.whole = Math.abs(twice) / 2 > unseen ? nearer(planes, pair.s, pair.t, overlap, tolerance) : 0);
  };
  const rankOf = new Int32Array(layers);
  for (let face = 0; face < layerOf.length; face++) rankOf[layerOf[face]] = base.ranks[face];
  const violates = (key: number, bits: number, rank: ArrayLike<number>) => {
    const lo = rank[Math.floor(key / layers)], hi = rank[key % layers];
    return bits === LOWER_NEARER ? lo < hi : bits === HIGHER_NEARER ? hi < lo : bits !== 0 && lo !== hi;
  };
  const rings = convexRings(mesh);
  const blockerCache = new Map<number, number[]>();
  /** Faces over face `f`'s box that lie above its layer through a chain. */
  const blockersOf = (f: number) => {
    let list = blockerCache.get(f);
    if (!list) blockerCache.set(f, (list = near[f].filter((g) => rises(layerOf[f], layerOf[g]))));
    return list;
  };
  const mark = new Int32Array(layerOf.length);
  let stamp = 0;
  const edge = 1e-9 * Math.max(xHi - xLo, yHi - yLo);
  /** Convex `ring` holds every point of `outline`, its boundary included. */
  const holds = (ring: readonly Point[], outline: readonly Point[]) => {
    const sign = area(ring) > 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
      const length = Math.hypot(bx - ax, by - ay);
      for (const [x, y] of outline) if (sign * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < -edge * length) return false;
    }
    return true;
  };
  const contains = (outer: Box, inner: Box) => outer[0] <= inner[0] && outer[1] <= inner[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
  /** Depth bits where both are shown: their overlap less every face above either through a chain. */
  const shown = (pair: Pair) => {
    if (pair.shown !== null) return pair.shown;
    const outline: Point[] = [];
    for (let i = 0; i < pair.overlap.length; i += 2) outline.push([pair.overlap[i], pair.overlap[i + 1]]);
    const box = bounds(outline);
    const blockers = [...blockersOf(faces[pair.s]), ...blockersOf(faces[pair.t])];
    // Usually one convex face above hides the whole overlap.
    pair.shown = 0;
    for (const face of blockers) if (rings[face] && contains(faceBoxes[face], box) && holds(rings[face]!, outline)) return 0;
    let pieces = [outline];
    stamp++;
    for (const face of blockers) {
      if (mark[face] === stamp || !overlap(box, faceBoxes[face])) continue;
      mark[face] = stamp;
      const masks = rings[face] ? [rings[face]!] : trianglesOf[face].map((t) => polygons[t]);
      for (const mask of masks) {
        const masked = rings[face] ? faceBoxes[face] : bounds(mask);
        pieces = pieces.flatMap((piece) => (overlap(bounds(piece), masked) ? partition(piece, mask).outside : [piece]));
        if (!pieces.length) return 0;
      }
    }
    const seen = (region: readonly Point[][]) => region.reduce((sum, piece) => sum + Math.abs(area(piece)), 0) > unseen;
    if (!seen(pieces)) return 0;
    const ls = layerOf[faces[pair.s]], lt = layerOf[faces[pair.t]];
    /** Triangle `a` nearer than triangle `b` by more than the tolerance: a half-plane. */
    const ahead = (a: number, b: number): Plane => {
      const delta = difference(planes[a]!, planes[b]!);
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
      for (const u of near[faces[front]]) {
        const lu = layerOf[u];
        if (lu === ls || lu === lt || bit(lu, ln) || bit(ln, lu) || !overlap(reach, faceBoxes[u])) continue;
        if (blockersOf(u).some((face) => overlap(reach, faceBoxes[face]))) continue;
        for (const v of trianglesOf[u]) {
          if (!overlap(reach, boxes[v])) continue;
          const mask = clip(polygons[v], ahead(v, front));
          if (!mask.length) continue;
          const masked = bounds(mask);
          region = region.flatMap((piece) => (overlap(bounds(piece), masked) ? partition(piece, mask).outside : [piece]));
          if (!region.length) return false;
        }
      }
      return seen(region);
    };
    if (wins(pair.s, pair.t)) pair.shown |= LOWER_NEARER;
    if (wins(pair.t, pair.s)) pair.shown |= HIGHER_NEARER;
    return pair.shown;
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
    for (const pair of pairs) {
      const known = constraints.get(pair.key) ?? 0;
      // A pair adds only bits its layers lack. Its shown bits are among its
      // whole ones, which are among its boxed ones, so each test can only drop it.
      if ((pair.boxed & ~known) === 0 || !violates(pair.key, pair.boxed, rank)) continue;
      const overall = whole(pair);
      if ((overall & ~known) === 0 || !violates(pair.key, overall, rank)) continue;
      const bits = shown(pair);
      if ((bits & ~known) === 0 || !violates(pair.key, bits, rank)) continue;
      constraints.set(pair.key, known | bits);
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
