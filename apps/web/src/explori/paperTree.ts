import { exploriCpVertices } from './foldExport';
import { reportError } from '../monitoring';
import { matchExploriTrees } from './treeLayout';
import type { ExploriCp, ExploriGraph, ExploriSymmetry } from './types';

/**
 * Where a result's tree sits on its paper, recovered from the packing — and
 * how to turn our drawing of the tree to agree with the crease pattern.
 *
 * The API carries no positions for a tree's nodes, but the packing figure is
 * the sliced folded form unfolded: every hinge crease of the base is drawn on
 * the paper, and hinges *are* the tree. Reflecting each facet of the packing
 * across its creases refolds it, which gives every vertex an axial coordinate
 * along the base's axis. A strip of facets joined across mountain and valley
 * creases is one tree edge, its length the difference of its two extreme axial
 * values; hinges at one axial value joined through strips are one node. This is
 * upstream's `Fold225.get_tree_and_packing` in floating point, and it comes out
 * the same metric tree to about 1e-12 on the local archive.
 *
 * Two things keep it honest. The recovered tree is matched against the served
 * one and used only when they are the same metric tree, so a misread packing
 * falls back to the plain drawing rather than to a wrong mapping. And the
 * positions are used only to *orient* the drawing: a middle flap's tip and its
 * hub can be the same point of the paper (2b.7's short flap ends exactly at the
 * centre, on top of its hub), so drawing the tree at its paper positions would
 * lose flaps — roughly one result in six on the local archive. The drawing
 * keeps its lengths; the paper decides which way it faces, and which of several
 * self-mirrored branches at a node keeps the line: the one that reaches farthest
 * along the pattern's mirror (`treeLayout.ts`, the `paper` option).
 *
 * The mirror itself is read off the crease pattern (`exploriPatternMirror`),
 * because the database a tiling came from does not guarantee one.
 */

type Point = [number, number];

/**
 * Axial coordinates closer than this are one hinge position. Far below any
 * strip length in the archive (the shortest is near 1e-3) and far above the
 * noise a chain of reflections leaves (near 1e-13). Merged by sorting rather
 * than by rounding to a grid, which a value can straddle.
 */
const AXIAL_MERGE = 1e-8;
/** A packing hinge whose midpoint lies this close to a crease-pattern hinge is a real fold, not a flat slice. */
const ON_SEGMENT = 1e-7;

interface Recovered {
  graph: ExploriGraph;
  positions: Map<string, Point>;
}

/**
 * Paper position for every node of `tree`, or `null` when the packing does not
 * recover the same metric tree.
 */
export function exploriPaperPositions(
  tree: ExploriGraph,
  cp: ExploriCp,
  packing: ExploriCp
): Map<string, Point> | null {
  const recovered = recoverTree(cp, packing);
  if (!recovered) return null;
  const mapping = matchExploriTrees(recovered.graph, tree);
  if (!mapping) return null;
  const positions = new Map<string, Point>();
  for (const [recoveredId, servedId] of mapping) {
    const point = recovered.positions.get(recoveredId);
    if (point) positions.set(servedId, point);
  }
  return positions.size === tree.nodes.length ? positions : null;
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > ON_SEGMENT) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  return dot >= -ON_SEGMENT && dot <= (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + ON_SEGMENT;
}

type EdgeKind = 'border' | 'fold' | 'hinge' | 'slice';

interface Rigid {
  a: [number, number, number, number];
  t: Point;
}

function apply(map: Rigid, p: Point): Point {
  return [map.a[0] * p[0] + map.a[1] * p[1] + map.t[0], map.a[2] * p[0] + map.a[3] * p[1] + map.t[1]];
}

/** `map` followed by the reflection across the line through `p` and `q`. */
function reflectAfter(map: Rigid, p: Point, q: Point): Rigid {
  let dx = q[0] - p[0];
  let dy = q[1] - p[1];
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  const nx = -dy;
  const ny = dx;
  // R = I − 2nnᵀ
  const r: [number, number, number, number] = [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny];
  const a: [number, number, number, number] = [
    r[0] * map.a[0] + r[1] * map.a[2],
    r[0] * map.a[1] + r[1] * map.a[3],
    r[2] * map.a[0] + r[3] * map.a[2],
    r[2] * map.a[1] + r[3] * map.a[3],
  ];
  const bx = map.t[0] - p[0];
  const by = map.t[1] - p[1];
  return { a, t: [r[0] * bx + r[1] * by + p[0], r[2] * bx + r[3] * by + p[1]] };
}

const IDENTITY: Rigid = { a: [1, 0, 0, 1], t: [0, 0] };

/** The tree the packing describes, with a paper position per node. */
function recoverTree(cp: ExploriCp, packing: ExploriCp): Recovered | null {
  const pts = exploriCpVertices(packing);
  const cpPts = exploriCpVertices(cp);
  const cpHinges: [Point, Point][] = [];
  for (const [a, b, type] of cp.edges) {
    if (String(type).toLowerCase() === 'h' && cpPts[a] && cpPts[b]) cpHinges.push([cpPts[a], cpPts[b]]);
  }

  // The packing as a planar graph: one undirected edge per pair, classified.
  const kinds = new Map<string, EdgeKind>();
  const neighbours = new Map<number, Set<number>>();
  const key = (u: number, v: number) => `${u},${v}`;
  for (const [a, b, rawType] of packing.edges) {
    if (a === b || !pts[a] || !pts[b]) continue;
    if (kinds.has(key(a, b))) continue;
    const type = String(rawType ?? '').toLowerCase();
    let kind: EdgeKind = 'fold';
    if (type === 'b') kind = 'border';
    else if (type === 'h') {
      const mid: Point = [(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2];
      kind = cpHinges.some(([p, q]) => onSegment(mid, p, q)) ? 'hinge' : 'slice';
    }
    kinds.set(key(a, b), kind);
    kinds.set(key(b, a), kind);
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)?.add(b);
    neighbours.get(b)?.add(a);
  }
  if (neighbours.size === 0) return null;

  // Facets: walk each half-edge, turning clockwise at every vertex, and keep
  // the counter-clockwise cycles; the one clockwise cycle is the outside.
  const rings = new Map<number, number[]>();
  const ringIndex = new Map<string, number>();
  for (const [v, ns] of neighbours) {
    const ring = [...ns].sort(
      (p, q) => Math.atan2(pts[p][1] - pts[v][1], pts[p][0] - pts[v][0]) - Math.atan2(pts[q][1] - pts[v][1], pts[q][0] - pts[v][0])
    );
    rings.set(v, ring);
    ring.forEach((n, i) => ringIndex.set(key(v, n), i));
  }
  const faces: [number, number][][] = [];
  const faceOf = new Map<string, number>();
  const visited = new Set<string>();
  for (const [u, ring] of rings) {
    for (const v of ring) {
      if (visited.has(key(u, v))) continue;
      const face: [number, number][] = [];
      let a = u;
      let b = v;
      while (!visited.has(key(a, b))) {
        visited.add(key(a, b));
        face.push([a, b]);
        const next = rings.get(b) as number[];
        const i = ringIndex.get(key(b, a)) as number;
        const c = next[(i - 1 + next.length) % next.length];
        a = b;
        b = c;
      }
      let area = 0;
      for (const [x, y] of face) area += pts[x][0] * pts[y][1] - pts[y][0] * pts[x][1];
      if (area > 1e-12) {
        for (const he of face) faceOf.set(key(he[0], he[1]), faces.length);
        faces.push(face);
      }
    }
  }
  if (faces.length === 0) return null;

  // Refold: a rigid map per facet, reflecting across every folded crease.
  const maps = new Map<number, Rigid>([[0, IDENTITY]]);
  const queue = [0];
  for (let i = 0; i < queue.length; i += 1) {
    const f = queue[i];
    const map = maps.get(f) as Rigid;
    for (const [u, v] of faces[f]) {
      const g = faceOf.get(key(v, u));
      if (g === undefined || maps.has(g)) continue;
      const kind = kinds.get(key(u, v));
      if (kind === 'border') continue;
      maps.set(g, kind === 'slice' ? map : reflectAfter(map, apply(map, pts[u]), apply(map, pts[v])));
      queue.push(g);
    }
  }
  if (maps.size !== faces.length) return null;
  const folded = (face: number, vertex: number): Point => apply(maps.get(face) as Rigid, pts[vertex]);

  // The axis is perpendicular to every hinge's folded image; take the longest.
  let axis: Point | null = null;
  let longest = 0;
  for (const [he, kind] of kinds) {
    if (kind !== 'hinge' && kind !== 'slice') continue;
    const f = faceOf.get(he);
    if (f === undefined) continue;
    const [u, v] = he.split(',').map(Number);
    const p = folded(f, u);
    const q = folded(f, v);
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (length > longest) {
      longest = length;
      axis = [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
    }
  }
  if (!axis) return null;
  const raw = new Map<number, number>();
  for (let f = 0; f < faces.length; f += 1) {
    for (const [u] of faces[f]) {
      if (raw.has(u)) continue;
      const p = folded(f, u);
      raw.set(u, p[0] * axis[0] + p[1] * axis[1]);
    }
  }
  // Every vertex's coordinate, with values within AXIAL_MERGE of each other
  // made one value, so refold noise cannot split a hinge position in two.
  const sorted = [...new Set(raw.values())].sort((a, b) => a - b);
  const canonical = new Map<number, number>();
  let representative = sorted[0];
  for (const value of sorted) {
    if (value - representative > AXIAL_MERGE) representative = value;
    canonical.set(value, representative);
  }
  const axial = new Map<number, number>();
  for (const [vertex, value] of raw) axial.set(vertex, canonical.get(value) as number);

  // Strips: facets joined across folds that are not hinges.
  const stripParent = faces.map((_, i) => i);
  const findStrip = (x: number): number => {
    while (stripParent[x] !== x) {
      stripParent[x] = stripParent[stripParent[x]];
      x = stripParent[x];
    }
    return x;
  };
  for (const [he, f] of faceOf) {
    const [u, v] = he.split(',').map(Number);
    const g = faceOf.get(key(v, u));
    if (g !== undefined && kinds.get(he) === 'fold') stripParent[findStrip(f)] = findStrip(g);
  }
  interface Strip {
    lo: number;
    hi: number;
    vertices: Set<number>;
  }
  const strips = new Map<number, Strip>();
  for (let f = 0; f < faces.length; f += 1) {
    const s = findStrip(f);
    let strip = strips.get(s);
    if (!strip) {
      strip = { lo: Infinity, hi: -Infinity, vertices: new Set() };
      strips.set(s, strip);
    }
    for (const [u] of faces[f]) {
      const h = axial.get(u) as number;
      strip.lo = Math.min(strip.lo, h);
      strip.hi = Math.max(strip.hi, h);
      strip.vertices.add(u);
    }
  }

  // Nodes: an end of a strip, joined with the ends of neighbouring strips it
  // shares a hinge with at that axial value.
  const nodeParent = new Map<string, string>();
  const endKey = (s: number, h: number) => `${s}@${h}`;
  const findNode = (x: string): string => {
    let root = x;
    while ((nodeParent.get(root) ?? root) !== root) root = nodeParent.get(root) as string;
    while (x !== root) {
      const next = nodeParent.get(x) ?? x;
      nodeParent.set(x, root);
      x = next;
    }
    return root;
  };
  for (const [he, f] of faceOf) {
    const kind = kinds.get(he);
    if (kind !== 'hinge' && kind !== 'slice') continue;
    const [u, v] = he.split(',').map(Number);
    const g = faceOf.get(key(v, u));
    if (g === undefined) continue;
    const s1 = findStrip(f);
    const s2 = findStrip(g);
    if (s1 === s2) continue;
    const h = axial.get(u) as number;
    if (axial.get(v) !== h) continue;
    const a = strips.get(s1) as Strip;
    const b = strips.get(s2) as Strip;
    if ((h !== a.lo && h !== a.hi) || (h !== b.lo && h !== b.hi)) continue;
    nodeParent.set(findNode(endKey(s1, h)), findNode(endKey(s2, h)));
  }

  // The tree, with a degree-2 merge as upstream does, and a position per node:
  // the centroid of the packing vertices at that end of its strips.
  const adjacency = new Map<string, Map<string, number>>();
  const nodePoints = new Map<string, Point[]>();
  const link = (a: string, b: string, length: number) => {
    if (!adjacency.has(a)) adjacency.set(a, new Map());
    if (!adjacency.has(b)) adjacency.set(b, new Map());
    adjacency.get(a)?.set(b, length);
    adjacency.get(b)?.set(a, length);
  };
  for (const [s, strip] of strips) {
    if (strip.hi - strip.lo <= 0) continue;
    const lo = findNode(endKey(s, strip.lo));
    const hi = findNode(endKey(s, strip.hi));
    if (lo === hi) continue;
    link(lo, hi, strip.hi - strip.lo);
    for (const vertex of strip.vertices) {
      const h = axial.get(vertex) as number;
      if (h !== strip.lo && h !== strip.hi) continue;
      const node = findNode(endKey(s, h));
      const list = nodePoints.get(node) ?? [];
      list.push(pts[vertex]);
      nodePoints.set(node, list);
    }
  }
  for (const [node, links] of [...adjacency]) {
    if (links.size !== 2) continue;
    const [[a, la], [b, lb]] = [...links];
    adjacency.get(a)?.delete(node);
    adjacency.get(b)?.delete(node);
    adjacency.delete(node);
    link(a, b, la + lb);
  }
  const ids = [...adjacency.keys()];
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges: ExploriGraph['edges'] = [];
  const positions = new Map<string, Point>();
  for (const [node, links] of adjacency) {
    const points = nodePoints.get(node) ?? [];
    if (points.length === 0) return null;
    positions.set(
      String(index.get(node)),
      [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
    );
    for (const [other, length] of links) {
      if ((index.get(node) as number) < (index.get(other) as number)) {
        edges.push({ u: index.get(node) as number, v: index.get(other) as number, length });
      }
    }
  }
  return { graph: { nodes: ids.map((_, i) => ({ id: i })), edges }, positions };
}

const EIGHTH_TURN = Math.PI / 4;
/** How close a reflected sample must land to a crease to count as on it. */
const ON_CREASE = 1e-6;
/** Grid cell for the crease hash, in paper units; samples are taken at most this far apart. */
const CELL = 0.01;

type Matrix = [number, number, number, number];

function rotation(angle: number): Matrix {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, s, c];
}

function compose(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3]];
}

function transform(m: Matrix, p: Point): Point {
  return [m[0] * p[0] + m[1] * p[1], m[2] * p[0] + m[3] * p[1]];
}

function centroid(points: Point[]): Point {
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

/**
 * The line the crease pattern mirrors across, as a direction through its
 * centre, or `null`.
 *
 * Read off the pattern itself, not off the database it came from: a `book`
 * database holds the odd pattern with no mirror at all, and the archive's
 * hinge creases are added asymmetrically, so only mountain, valley and border
 * creases are consulted. A 22.5° tiling mirrors across an edge line or a
 * diagonal and nothing else, so those four are tried; each crease is sampled
 * at three points, and a direction is a mirror when every sample's reflection
 * lies on some crease. Several may — a highly symmetric pattern — and then the
 * database's own kind of line is preferred.
 */
export function exploriPatternMirror(cp: ExploriCp, symmetry: ExploriSymmetry): Point | null {
  const points = exploriCpVertices(cp);
  const segments: [Point, Point][] = [];
  for (const [a, b, type] of cp.edges) {
    const kind = String(type ?? '').toLowerCase();
    if (kind === 'h' || kind === 'aux' || !points[a] || !points[b]) continue;
    segments.push([points[a], points[b]]);
  }
  if (segments.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [a, b] of segments) {
    for (const [x, y] of [a, b]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const centre: Point = [(minX + maxX) / 2, (minY + maxY) / 2];

  // Every crease, hashed by the cells its samples fall in.
  const grid = new Map<string, number[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  segments.forEach(([a, b], index) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CELL) + 1);
    for (let k = 0; k <= steps; k += 1) {
      const key = cell(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps);
      const list = grid.get(key);
      if (list) {
        if (list[list.length - 1] !== index) list.push(index);
      } else grid.set(key, [index]);
    }
  });
  const onSomeCrease = (p: Point): boolean => {
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const index of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const [a, b] = segments[index];
          const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
          if (Math.abs(cross) > ON_CREASE) continue;
          const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
          if (dot >= -ON_CREASE && dot <= (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + ON_CREASE) return true;
        }
      }
    }
    return false;
  };
  const mirrors = (d: Point): boolean =>
    segments.every(([a, b]) =>
      [0.25, 0.5, 0.75].every((t) => {
        const x = a[0] + (b[0] - a[0]) * t - centre[0];
        const y = a[1] + (b[1] - a[1]) * t - centre[1];
        const along = x * d[0] + y * d[1];
        return onSomeCrease([centre[0] + 2 * along * d[0] - x, centre[1] + 2 * along * d[1] - y]);
      })
    );
  const preferred = symmetry === 'book' ? [0, 2, 1, 3] : symmetry === 'diag' ? [1, 3, 0, 2] : [0, 1, 2, 3];
  for (const k of preferred) {
    const d: Point = [Math.cos(k * EIGHTH_TURN), Math.sin(k * EIGHTH_TURN)];
    if (mirrors(d)) return d;
  }
  return null;
}

/** What the paper says about a result's tree: where its nodes sit, and which way the pattern mirrors. */
export interface ExploriPaperFrame {
  /** A position per node of the served tree, or `null` when the packing did not yield the same tree. */
  positions: Map<string, Point> | null;
  /** The pattern's mirror, or `null` when it has none. */
  mirror: Point | null;
}

export function exploriPaperFrame(
  tree: ExploriGraph,
  cp: ExploriCp,
  packing: ExploriCp,
  symmetry: ExploriSymmetry
): ExploriPaperFrame {
  // Geometry over a payload we did not make. Anything it cannot read costs
  // that result its orientation, never the results pane — and is reported,
  // because a packing this cannot refold is worth knowing about.
  const guarded = <T>(read: () => T | null): T | null => {
    try {
      return read();
    } catch (error) {
      reportError(error, { surface: 'explori:paper' });
      return null;
    }
  };
  return {
    positions: guarded(() => exploriPaperPositions(tree, cp, packing)),
    mirror: guarded(() => exploriPatternMirror(cp, symmetry)),
  };
}

/**
 * Turn a drawing to face the way its tree lies on the paper, when the pattern
 * has no mirror to lay it along. Every eighth-turn, with or without a
 * left-right swap, is tried; the one whose node directions agree best with
 * the paper positions wins.
 */
export function orientExploriTree(positions: Map<string, Point>, paper: Map<string, Point>): Map<string, Point> {
  const shared = [...positions.keys()].filter((id) => paper.has(id));
  if (shared.length < 2) return positions;

  const flip: Matrix = [-1, 0, 0, 1];
  const candidates: Matrix[] = [];
  for (let k = 0; k < 8; k += 1) candidates.push(rotation(k * EIGHTH_TURN), compose(rotation(k * EIGHTH_TURN), flip));

  const drawnCentre = centroid(shared.map((id) => positions.get(id) as Point));
  const paperCentre = centroid(shared.map((id) => paper.get(id) as Point));
  let bestScore = -Infinity;
  let best = candidates[0];
  for (const candidate of candidates) {
    let score = 0;
    for (const id of shared) {
      const p = positions.get(id) as Point;
      const q = paper.get(id) as Point;
      const turned = transform(candidate, [p[0] - drawnCentre[0], p[1] - drawnCentre[1]]);
      score += turned[0] * (q[0] - paperCentre[0]) + turned[1] * (q[1] - paperCentre[1]);
    }
    if (score > bestScore + 1e-12) {
      bestScore = score;
      best = candidate;
    }
  }
  const turned = new Map<string, Point>();
  for (const [id, p] of positions) turned.set(id, transform(best, p));
  return turned;
}

/** `positions` turned so that the vertical line through the origin lies along `mirror`, its top toward `mirror`. */
export function turnExploriTree(positions: Map<string, Point>, mirror: Point): Map<string, Point> {
  const m = rotation(Math.atan2(mirror[1], mirror[0]) - Math.PI / 2);
  const turned = new Map<string, Point>();
  for (const [id, p] of positions) turned.set(id, transform(m, p));
  return turned;
}
