import type { FoldArtifacts, FoldDocument } from '../engine/types';
import { remapEdgeExtensionArrays } from './foldEdgeArrays';
import type { Point } from './geometry';

/**
 * A single crease pattern isolated from a document's fold output: a maximal
 * region of faces bounded by a closed border chain. Segments are lightweight —
 * they reference faces by index in the source fold and carry only boundary
 * geometry, so they are cheap to compute (in the worker) and cheap to clone
 * across the worker boundary. The heavier per-segment `FoldDocument` is built
 * lazily and only for the segment being simulated (see `buildSegmentFold`).
 *
 * This module is pure (no DOM / React / store deps) so it can run inside the
 * treemaker Web Worker and be reused by both the simulator and export paths.
 */
export interface CpSegment {
  /** Stable index within the segment list (0-based, deterministic order). */
  id: number;
  /** Indices into the source fold's `faces_vertices`. */
  faceIndices: number[];
  /** Boundary rings (outer + any holes) in the fold's coordinate space. */
  boundary: Point[][];
  bounds: SegmentBounds;
}

export interface SegmentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const BORDER_ASSIGNMENT = 'B';

/**
 * The paper plane is not always X-Y: the simulator's fold uses `[x, 0, z]`
 * (paper in X-Z, Y is the flat normal), while base folds use `[x, y]`. Pick the
 * two coordinate axes with the largest extent so bounds/boundary/thumbnails read
 * the actual planar layout. Returned in ascending index order for determinism.
 */
export function flatPlaneAxes(fold: FoldDocument): [number, number] {
  const coords = fold.vertices_coords ?? [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const coord of coords) {
    for (let k = 0; k < 3; k += 1) {
      const value = coord[k] ?? 0;
      if (value < min[k]!) min[k] = value;
      if (value > max[k]!) max[k] = value;
    }
  }
  const range = [0, 1, 2].map((k) => (Number.isFinite(min[k]!) ? max[k]! - min[k]! : 0));
  const byExtent = [0, 1, 2].sort((a, b) => range[b]! - range[a]!);
  return [byExtent[0]!, byExtent[1]!].sort((a, b) => a - b) as [number, number];
}

function planePoint(coord: number[] | undefined, axes: [number, number]): Point {
  return { x: coord?.[axes[0]] ?? 0, y: coord?.[axes[1]] ?? 0 };
}

/** The fold document the simulator actually prepares for a document. */
export function simulationFoldOf(artifacts: FoldArtifacts): FoldDocument {
  return artifacts.simulation_model?.fold ?? artifacts.fold;
}

const resolvedSegmentCache = new WeakMap<FoldArtifacts, CpSegment[]>();

/**
 * Segments for a fold-artifacts object. Prefers the worker-attached
 * `segments` (computed off the main thread); otherwise computes them here and
 * memoizes by artifacts identity so it runs at most once per fold. This keeps
 * the simulator and sidebar correct regardless of which import path produced
 * the artifacts (some paths do not carry worker-attached segments).
 */
export function resolveCpSegments(artifacts: FoldArtifacts | null | undefined): CpSegment[] {
  if (!artifacts) return [];
  if (artifacts.segments) return artifacts.segments;
  const cached = resolvedSegmentCache.get(artifacts);
  if (cached) return cached;
  let segments: CpSegment[];
  try {
    segments = segmentFoldDocument(simulationFoldOf(artifacts));
  } catch {
    segments = [];
  }
  resolvedSegmentCache.set(artifacts, segments);
  return segments;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Partition a fold document into crease-pattern segments via face flood-fill
 * where border (`'B'`) edges act as walls. Robust to both ways multiple
 * patterns occur: disjoint patterns share no edges, and patterns sharing a
 * border edge are separated by the wall rule. A single connected pattern with
 * no interior borders yields exactly one segment.
 */
export function segmentFoldDocument(fold: FoldDocument): CpSegment[] {
  const faces = fold.faces_vertices ?? [];
  const faceCount = faces.length;
  if (faceCount === 0) return [];

  const assignmentByKey = buildAssignmentByKey(fold);

  // Map each undirected edge to the faces that use it.
  const facesByEdge = new Map<string, number[]>();
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const face = faces[faceIndex] ?? [];
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i] ?? 0;
      const b = face[(i + 1) % face.length] ?? 0;
      if (a === b) continue;
      const key = edgeKey(a, b);
      const list = facesByEdge.get(key);
      if (list) list.push(faceIndex);
      else facesByEdge.set(key, [faceIndex]);
    }
  }

  // Union faces that share a non-border edge.
  const parent = new Int32Array(faceCount);
  for (let i = 0; i < faceCount; i += 1) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (const [key, incident] of facesByEdge) {
    if (incident.length < 2) continue; // outer boundary edge, not a connector
    if (assignmentByKey.get(key) === BORDER_ASSIGNMENT) continue; // wall
    for (let i = 1; i < incident.length; i += 1) {
      union(incident[0]!, incident[i]!);
    }
  }

  // Group faces by component root.
  const groups = new Map<number, number[]>();
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const root = find(faceIndex);
    const list = groups.get(root);
    if (list) list.push(faceIndex);
    else groups.set(root, [faceIndex]);
  }

  const axes = flatPlaneAxes(fold);
  const segments: CpSegment[] = [];
  for (const faceIndices of groups.values()) {
    const boundary = traceBoundaryRings(fold, faceIndices, axes);
    const bounds = boundsOfFaces(fold, faceIndices, axes);
    segments.push({ id: 0, faceIndices, boundary, bounds });
  }

  // Deterministic reading order (top-left first) so the default selection is
  // stable across recomputes.
  segments.sort((a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX);
  segments.forEach((segment, index) => {
    segment.id = index;
  });
  return segments;
}

/**
 * Precedence for creases sharing the same endpoints. Authors commonly lay down
 * reference/auxiliary lines and then draw the real crease over them, so the same
 * span can carry several assignments; taking whichever happened to be stored
 * last is arbitrary. Border wins outright — it decides where a region ends, and
 * a border overdrawn by a valley must still act as a wall — then real creases
 * (M/V), then flat, then unassigned.
 */
const ASSIGNMENT_RANK: Record<string, number> = { B: 4, M: 3, V: 3, F: 2, U: 1 };

function strongerAssignment(current: string | undefined, candidate: string): string {
  if (!current) return candidate;
  const currentRank = ASSIGNMENT_RANK[current] ?? 0;
  const candidateRank = ASSIGNMENT_RANK[candidate] ?? 0;
  return candidateRank > currentRank ? candidate : current;
}

/**
 * Map each undirected edge to its effective assignment, resolving creases that
 * share endpoints by {@link ASSIGNMENT_RANK}.
 */
export function buildAssignmentByKey(fold: FoldDocument): Map<string, string> {
  const map = new Map<string, string>();
  const edges = fold.edges_vertices ?? [];
  const assignments = fold.edges_assignment ?? [];
  edges.forEach((edge, index) => {
    const assignment = assignments[index];
    if (!assignment) return;
    const key = edgeKey(edge[0], edge[1]);
    map.set(key, strongerAssignment(map.get(key), assignment));
  });
  return map;
}

function boundsOfFaces(
  fold: FoldDocument,
  faceIndices: number[],
  axes: [number, number]
): SegmentBounds {
  const coords = fold.vertices_coords ?? [];
  const faces = fold.faces_vertices ?? [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const faceIndex of faceIndices) {
    for (const vertex of faces[faceIndex] ?? []) {
      const coord = coords[vertex];
      if (!coord) continue;
      const x = coord[axes[0]] ?? 0;
      const y = coord[axes[1]] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Boundary edges of a segment are those used by exactly one of the segment's
 * faces. Stitch them into closed rings for clipping / point-in-polygon tests.
 */
function traceBoundaryRings(
  fold: FoldDocument,
  faceIndices: number[],
  axes: [number, number]
): Point[][] {
  const faces = fold.faces_vertices ?? [];
  const coords = fold.vertices_coords ?? [];

  const useCount = new Map<string, number>();
  const endpoints = new Map<string, [number, number]>();
  for (const faceIndex of faceIndices) {
    const face = faces[faceIndex] ?? [];
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i] ?? 0;
      const b = face[(i + 1) % face.length] ?? 0;
      if (a === b) continue;
      const key = edgeKey(a, b);
      useCount.set(key, (useCount.get(key) ?? 0) + 1);
      endpoints.set(key, [a, b]);
    }
  }

  // Adjacency among boundary vertices (each boundary edge used exactly once).
  const adjacency = new Map<number, number[]>();
  const addAdjacency = (from: number, to: number) => {
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  };
  for (const [key, count] of useCount) {
    if (count !== 1) continue;
    const [a, b] = endpoints.get(key)!;
    addAdjacency(a, b);
    addAdjacency(b, a);
  }

  const rings: Point[][] = [];
  const visitedEdges = new Set<string>();
  const toPoint = (vertex: number): Point => planePoint(coords[vertex], axes);

  for (const start of adjacency.keys()) {
    const neighbors = adjacency.get(start) ?? [];
    for (const first of neighbors) {
      if (visitedEdges.has(edgeKey(start, first))) continue;
      const ring: Point[] = [toPoint(start)];
      let previous = start;
      let current = first;
      visitedEdges.add(edgeKey(start, first));
      let guard = 0;
      while (current !== start && guard < adjacency.size * 2 + 4) {
        ring.push(toPoint(current));
        const options = adjacency.get(current) ?? [];
        let next = options.find(
          (candidate) => candidate !== previous && !visitedEdges.has(edgeKey(current, candidate))
        );
        if (next === undefined) {
          next = options.find((candidate) => !visitedEdges.has(edgeKey(current, candidate)));
        }
        if (next === undefined) break;
        visitedEdges.add(edgeKey(current, next));
        previous = current;
        current = next;
        guard += 1;
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

/**
 * Materialize the compact `FoldDocument` for a single segment, re-indexing
 * vertices/edges/faces. Preserves `edges_assignment` and `edges_foldAngle` so
 * folding behaves identically to the whole-sheet case. Called lazily and only
 * for the segment being simulated.
 */
export function buildSegmentFold(fold: FoldDocument, segment: CpSegment): FoldDocument {
  const coords = fold.vertices_coords ?? [];
  const faces = fold.faces_vertices ?? [];
  const edges = fold.edges_vertices ?? [];
  const assignments = fold.edges_assignment;
  const foldAngles = fold.edges_foldAngle;

  const vertexRemap = new Map<number, number>();
  const nextVertices: number[][] = [];
  const mapVertex = (vertex: number): number => {
    const existing = vertexRemap.get(vertex);
    if (existing !== undefined) return existing;
    const index = nextVertices.length;
    vertexRemap.set(vertex, index);
    nextVertices.push([...(coords[vertex] ?? [0, 0])]);
    return index;
  };

  const nextFaces: number[][] = [];
  const wantedEdgeKeys = new Set<string>();
  for (const faceIndex of segment.faceIndices) {
    const face = faces[faceIndex] ?? [];
    nextFaces.push(face.map(mapVertex));
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i] ?? 0;
      const b = face[(i + 1) % face.length] ?? 0;
      if (a !== b) wantedEdgeKeys.add(edgeKey(a, b));
    }
  }

  const nextEdges: [number, number][] = [];
  const nextAssignment: string[] = [];
  const nextFoldAngle: Array<number | null> = [];
  const keptEdges: number[] = [];
  edges.forEach((edge, index) => {
    const key = edgeKey(edge[0], edge[1]);
    if (!wantedEdgeKeys.has(key)) return;
    // Only keep edges whose endpoints belong to the segment's faces.
    if (!vertexRemap.has(edge[0]) || !vertexRemap.has(edge[1])) return;
    nextEdges.push([mapVertex(edge[0]), mapVertex(edge[1])]);
    if (assignments) nextAssignment.push(assignments[index] ?? 'U');
    if (foldAngles) nextFoldAngle.push(foldAngles[index] ?? null);
    keptEdges.push(index);
  });

  const next: FoldDocument = {
    ...fold,
    vertices_coords: nextVertices,
    edges_vertices: nextEdges,
    faces_vertices: nextFaces,
  };

  // The blanket spread above pairs each kept edge with a different edge's data;
  // `keptEdges` is the provenance that puts them back in step.
  remapEdgeExtensionArrays(next, fold, edges.length, keptEdges);
  // Circles and texts are whole-document entities; keep only those inside this
  // segment, or every exported region carries the entire sheet's annotations.
  scopeAnnotationExtrasToSegment(next, fold, segment);
  if (assignments) next.edges_assignment = nextAssignment as FoldDocument['edges_assignment'];
  else delete next.edges_assignment;
  if (foldAngles) next.edges_foldAngle = nextFoldAngle;
  else delete next.edges_foldAngle;
  // These are rebuilt by prepareFoldModel; drop any stale whole-sheet copies.
  delete next.faces_edges;
  delete next.edges_faces;
  delete next.face_orders;
  return next;
}

/** Parallel arrays describing one annotation kind, keyed by its coordinate array. */
const ANNOTATION_EXTRA_GROUPS: Array<{ coords: string; parallel: string[] }> = [
  {
    coords: 'oriedita:circles_coords',
    parallel: [
      'oriedita:circles_radii',
      'oriedita:circles_colors',
      'oriedita:circles_custom_colors',
    ],
  },
  { coords: 'oriedita:texts_coords', parallel: ['oriedita:texts_text'] },
];

function scopeAnnotationExtrasToSegment(
  next: FoldDocument,
  source: FoldDocument,
  segment: CpSegment
): void {
  for (const group of ANNOTATION_EXTRA_GROUPS) {
    const coords = source[group.coords];
    if (!Array.isArray(coords)) continue;
    const kept: number[] = [];
    coords.forEach((coord, index) => {
      const point = Array.isArray(coord)
        ? { x: Number(coord[0]) || 0, y: Number(coord[1]) || 0 }
        : null;
      if (point && pointInSegment(segment, point)) kept.push(index);
    });
    next[group.coords] = kept.map((index) => coords[index]);
    for (const key of group.parallel) {
      const value = source[key];
      if (Array.isArray(value) && value.length === coords.length) {
        next[key] = kept.map((index) => value[index]);
      }
    }
  }
}

export interface SegmentThumbnailOptions {
  size?: number;
  padding?: number;
  /**
   * Crease colours, keyed by assignment. Defaults to the app-theme CSS
   * variables used by the simulator sidebar; the export dialog passes its own
   * palette so thumbnails match the exported image.
   */
  strokes?: Record<string, string>;
  /** Thumbnail background. Transparent when omitted. */
  background?: string;
}

const THUMBNAIL_STROKES: Record<string, { color: string; width: number; dash?: string }> = {
  B: { color: 'var(--text-primary, #e8edf0)', width: 1.6 },
  M: { color: 'var(--status-danger, #e06c75)', width: 1 },
  V: { color: 'var(--accent-primary, #5fb3a5)', width: 1, dash: '3 2' },
  F: { color: 'var(--text-secondary, #aeb9bf)', width: 0.6 },
};

/**
 * Flat 2D SVG of one or more segments' creases, scaled into a square viewBox.
 * Static and cheap — rendered once per segment, no simulator involved. Passing
 * every segment gives the whole document ("all patterns") at a single scale.
 */
export function cpThumbnailSvg(
  fold: FoldDocument,
  segments: readonly CpSegment[],
  options: SegmentThumbnailOptions = {}
): string {
  const size = options.size ?? 96;
  const padding = options.padding ?? 6;
  const coords = fold.vertices_coords ?? [];
  const faces = fold.faces_vertices ?? [];
  const axes = flatPlaneAxes(fold);
  const assignmentByKey = buildAssignmentByKey(fold);
  const background = options.background
    ? `<rect width="${size}" height="${size}" fill="${options.background}"/>`
    : '';

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const segment of segments) {
    minX = Math.min(minX, segment.bounds.minX);
    minY = Math.min(minY, segment.bounds.minY);
    maxX = Math.max(maxX, segment.bounds.maxX);
    maxY = Math.max(maxY, segment.bounds.maxY);
  }
  if (!Number.isFinite(minX)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${background}</svg>`;
  }

  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scale = (size - padding * 2) / span;
  const offsetX = padding + ((size - padding * 2) - (maxX - minX) * scale) / 2;
  const offsetY = padding + ((size - padding * 2) - (maxY - minY) * scale) / 2;
  const project = (vertex: number): [number, number] => {
    const p = planePoint(coords[vertex], axes);
    const x = offsetX + (p.x - minX) * scale;
    // No y flip: FOLD coordinates are already y-down, matching SVG (see
    // `foldProjector`). Flipping here turned every thumbnail upside down
    // relative to the editor — and relative to the export preview beside it.
    const y = offsetY + (p.y - minY) * scale;
    return [x, y];
  };

  const drawn = new Set<string>();
  const lines: string[] = [];
  for (const segment of segments) {
    for (const faceIndex of segment.faceIndices) {
      const face = faces[faceIndex] ?? [];
      for (let i = 0; i < face.length; i += 1) {
        const a = face[i] ?? 0;
        const b = face[(i + 1) % face.length] ?? 0;
        if (a === b) continue;
        const key = edgeKey(a, b);
        if (drawn.has(key)) continue;
        drawn.add(key);
        const assignment = assignmentByKey.get(key) ?? 'F';
        const style = THUMBNAIL_STROKES[assignment] ?? THUMBNAIL_STROKES.F!;
        const color = options.strokes?.[assignment] ?? options.strokes?.F ?? style.color;
        const [x1, y1] = project(a);
        const [x2, y2] = project(b);
        const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : '';
        lines.push(
          `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="${style.width}"${dash} stroke-linecap="round"/>`
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${background}${lines.join('')}</svg>`;
}

/** Single-segment thumbnail. See {@link cpThumbnailSvg}. */
export function segmentThumbnailSvg(
  fold: FoldDocument,
  segment: CpSegment,
  options: SegmentThumbnailOptions = {}
): string {
  return cpThumbnailSvg(fold, [segment], options);
}

/**
 * Whether `point` lies on one of the segment's boundary edges, within `epsilon`.
 *
 * The even-odd test below is undefined exactly on the boundary, and a crease
 * that *is* the paper's edge has its midpoint precisely there — which is how a
 * square loses half its border to a plain inside test.
 */
export function pointOnSegmentBoundary(
  segment: CpSegment,
  point: Point,
  epsilon = 1e-6
): boolean {
  for (const ring of segment.boundary) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i]!;
      const b = ring[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared > 0
          ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
          : 0;
      const closestX = a.x + t * dx;
      const closestY = a.y + t * dy;
      if (Math.hypot(point.x - closestX, point.y - closestY) <= epsilon) return true;
    }
  }
  return false;
}

/** Even-odd point-in-segment test across all boundary rings (for export). */
export function pointInSegment(segment: CpSegment, point: Point): boolean {
  let inside = false;
  for (const ring of segment.boundary) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i]!;
      const b = ring[j]!;
      const intersects =
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
      if (intersects) inside = !inside;
    }
  }
  return inside;
}
