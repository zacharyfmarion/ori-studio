import { prepareFoldModel, type FoldDocument as SimulatorFoldDocument } from '@treemaker/origami-simulator';
import type { FoldAssignment, FoldArtifacts, FoldDocument } from '../engine/types';
import type { CreaseLine, FacetShape, TreeProject } from './sampleProject';

export type ImportedCreasePatternFormat = 'fold' | 'cp' | 'ori' | 'orh';

export interface ImportedCreasePatternSource {
  format: ImportedCreasePatternFormat;
  filename: string;
  path: string | null;
}

export interface ImportedFoldFrameInfo {
  index: number;
  title: string | null;
  classes: string[];
  inherited: boolean;
  parentIndex: number | null;
  foldedForm: boolean;
  vertices: number;
  edges: number;
  faces: number;
}

export interface ImportedCreasePatternDiagnostics {
  warnings: string[];
  errors: string[];
}

export interface ImportedCreasePatternStats {
  vertices: number;
  edges: number;
  faces: number;
  mountains: number;
  valleys: number;
  boundaries: number;
  flats: number;
  unassigned: number;
}

export interface ImportedCreasePatternDocument {
  source: ImportedCreasePatternSource;
  title: string;
  selectedFrame: ImportedFoldFrameInfo | null;
  foldFrames: ImportedFoldFrameInfo[];
  foldedFormFrames: ImportedFoldFrameInfo[];
  sourceFold: FoldDocument | null;
  fold: FoldDocument;
  lineOnly: boolean;
  simulationModelError: string | null;
  diagnostics: ImportedCreasePatternDiagnostics;
  stats: ImportedCreasePatternStats;
}

export interface ImportedCreasePatternResult {
  document: ImportedCreasePatternDocument;
  project: TreeProject;
  foldArtifacts: FoldArtifacts;
}

interface RawPoint {
  x: number;
  y: number;
}

interface RawSegment {
  a: RawPoint;
  b: RawPoint;
  assignment: FoldAssignment;
}

interface NormalizedSegment {
  a: RawPoint;
  b: RawPoint;
  assignment: FoldAssignment;
}

const EPSILON = 1e-8;

export function isCreasePatternFilename(filename: string): boolean {
  return /\.(fold|cp|ori|orh)$/i.test(filename);
}

export function importedCreasePatternFormat(filename: string): ImportedCreasePatternFormat {
  if (/\.cp$/i.test(filename)) return 'cp';
  if (/\.ori$/i.test(filename)) return 'ori';
  if (/\.orh$/i.test(filename)) return 'orh';
  return 'fold';
}

export function parseImportedCreasePattern(
  text: string,
  source: ImportedCreasePatternSource
): ImportedCreasePatternResult {
  if (source.format === 'ori' || source.format === 'orh') {
    throw new Error('Oriedita native files must be imported through the native Oriedita runtime');
  }
  const diagnostics: ImportedCreasePatternDiagnostics = { warnings: [], errors: [] };
  const parsed =
    source.format === 'cp'
      ? parseCpText(text, source.filename, diagnostics)
      : parseFoldText(text, source.filename, diagnostics);
  return buildImportedCreasePatternResult(parsed, source, diagnostics);
}

// Parse a crease pattern from an already-parsed FOLD object (the native `.osf`
// load path). Equivalent to `parseImportedCreasePattern(JSON.stringify(fold), …)`
// but without the stringify + re-parse of a potentially very large projection.
export function parseImportedCreasePatternFromFold(
  fold: unknown,
  source: ImportedCreasePatternSource
): ImportedCreasePatternResult {
  const diagnostics: ImportedCreasePatternDiagnostics = { warnings: [], errors: [] };
  const parsed = parseFoldValue(fold, source.filename, diagnostics);
  return buildImportedCreasePatternResult(parsed, source, diagnostics);
}

function buildImportedCreasePatternResult(
  parsed: ParsedFoldSource,
  source: ImportedCreasePatternSource,
  diagnostics: ImportedCreasePatternDiagnostics
): ImportedCreasePatternResult {
  const withTopology =
    parsed.fold.faces_vertices.length > 0
      ? parsed.fold
      : inferTopology(parsed.fold, diagnostics);
  const lineOnly = withTopology.faces_vertices.length === 0;
  const project = projectFromFold(withTopology, parsed.title);
  const foldArtifacts = foldArtifactsFromFold(withTopology);
  if (foldArtifacts.simulation_model_error) {
    diagnostics.warnings.push(foldArtifacts.simulation_model_error);
  }

  const document: ImportedCreasePatternDocument = {
    source,
    title: parsed.title,
    selectedFrame: parsed.selectedFrame,
    foldFrames: parsed.foldFrames,
    foldedFormFrames: parsed.foldedFormFrames,
    sourceFold: parsed.sourceFold,
    fold: withTopology,
    lineOnly,
    simulationModelError: foldArtifacts.simulation_model_error ?? null,
    diagnostics,
    stats: statsFromFold(withTopology),
  };

  return { document, project, foldArtifacts };
}

/**
 * Build simulator-ready fold artifacts from a crease-pattern fold, entirely in
 * JS: infer planar faces when the fold has none, then prepare the simulation
 * model. No flat-folding — the interactive simulator folds the flat pattern
 * itself, so it only needs faces + M/V assignments. Because face inference is
 * per-region, this naturally supports documents containing several disconnected
 * crease patterns (which the Rust flat-folder cannot).
 */
export function foldArtifactsFromFold(
  fold: FoldDocument,
  diagnostics: ImportedCreasePatternDiagnostics = { warnings: [], errors: [] }
): FoldArtifacts {
  const withTopology = fold.faces_vertices?.length ? fold : inferTopology(fold, diagnostics);
  const simulation = prepareSimulationFold(withTopology);
  return {
    fold: withTopology,
    folded_base: null,
    folded_base_error: null,
    simulation_model: simulation.fold ? { fold: simulation.fold, crease_params: [] } : null,
    simulation_model_error: simulation.error,
  };
}

function parseCpText(
  text: string,
  filename: string,
  diagnostics: ImportedCreasePatternDiagnostics
): {
  title: string;
  selectedFrame: null;
  foldFrames: ImportedFoldFrameInfo[];
  foldedFormFrames: ImportedFoldFrameInfo[];
  sourceFold: null;
  fold: FoldDocument;
} {
  const segments: RawSegment[] = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;
    const parts = trimmed.split(/\s+/u);
    if (parts.length !== 5) {
      diagnostics.warnings.push(`line ${index + 1} ignored: expected 5 fields`);
      return;
    }
    const [kind, ax, ay, bx, by] = parts;
    const assignment = cpAssignment(kind);
    const values = [ax, ay, bx, by].map((part) => Number.parseFloat(part ?? ''));
    if (!assignment || values.some((value) => !Number.isFinite(value))) {
      diagnostics.warnings.push(`line ${index + 1} ignored: invalid CP segment`);
      return;
    }
    segments.push({
      a: { x: values[0] ?? 0, y: values[1] ?? 0 },
      b: { x: values[2] ?? 0, y: values[3] ?? 0 },
      assignment,
    });
  });

  if (segments.length === 0) {
    throw new Error('CP file did not contain any valid crease segments');
  }

  return {
    title: basenameWithoutExtension(filename),
    selectedFrame: null,
    foldFrames: [],
    foldedFormFrames: [],
    sourceFold: null,
    fold: foldFromSegments(segments, basenameWithoutExtension(filename)),
  };
}

interface ParsedFoldSource {
  title: string;
  selectedFrame: ImportedFoldFrameInfo | null;
  foldFrames: ImportedFoldFrameInfo[];
  foldedFormFrames: ImportedFoldFrameInfo[];
  sourceFold: FoldDocument | null;
  fold: FoldDocument;
}

function parseFoldText(
  text: string,
  filename: string,
  diagnostics: ImportedCreasePatternDiagnostics
): ParsedFoldSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid FOLD JSON', {
      cause: error,
    });
  }
  return parseFoldValue(parsed, filename, diagnostics);
}

// Same as parseFoldText but for an already-parsed FOLD object. The native `.osf`
// load path holds the FOLD projection as a live object, so parsing straight from
// it avoids re-serializing it to a string and parsing that string back — a large
// transient allocation for dense crease patterns.
function parseFoldValue(
  parsed: unknown,
  filename: string,
  diagnostics: ImportedCreasePatternDiagnostics
): ParsedFoldSource {
  if (!isRecord(parsed)) throw new Error('FOLD file must contain a JSON object');

  const frames = resolveFoldFrames(parsed);
  const frameInfos = frames.map(foldFrameInfo);
  const chosen = chooseFoldFrame(frames);
  if (!chosen) throw new Error('FOLD file does not contain a usable frame with vertices and edges');
  const title =
    stringField(chosen.frame.frame_title) ??
    stringField(parsed.file_title) ??
    stringField(chosen.frame.file_title) ??
    basenameWithoutExtension(filename);

  const fold = normalizeFoldObject(chosen.frame, title, diagnostics);
  return {
    title,
    selectedFrame: foldFrameInfo(chosen),
    foldFrames: frameInfos,
    foldedFormFrames: frameInfos.filter((frame) => frame.foldedForm),
    sourceFold: parsed as FoldDocument,
    fold,
  };
}

interface ResolvedFoldFrame {
  frame: Record<string, unknown>;
  index: number;
  inherited: boolean;
  parentIndex: number | null;
}

function resolveFoldFrames(root: Record<string, unknown>): ResolvedFoldFrame[] {
  const fileFrames = Array.isArray(root.file_frames) ? root.file_frames.filter(isRecord) : [];
  const rawFrames = [root, ...fileFrames];
  const cache = new Map<number, ResolvedFoldFrame>();

  const build = (index: number): ResolvedFoldFrame => {
    const cached = cache.get(index);
    if (cached) return cached;
    const raw = rawFrames[index] ?? {};
    let frame = withoutFileFrames(raw);
    let inherited = false;
    const rawParent = numberField(raw.frame_parent);
    const parent =
      rawParent !== null && Number.isInteger(rawParent) ? rawParent : null;
    if (
      index > 0 &&
      raw.frame_inherit === true &&
      parent !== null &&
      parent >= 0 &&
      parent < rawFrames.length
    ) {
      const parentFrame = build(parent);
      frame = { ...parentFrame.frame, ...frame };
      inherited = true;
    }
    const result = { frame, index, inherited, parentIndex: parent };
    cache.set(index, result);
    return result;
  };

  return rawFrames.map((_, index) => build(index));
}

function chooseFoldFrame(frames: ResolvedFoldFrame[]): ResolvedFoldFrame | null {
  return frames
    .filter(({ frame }) => hasUsableFoldGeometry(frame))
    .sort((a, b) => frameScore(b.frame) - frameScore(a.frame) || a.index - b.index)[0] ?? null;
}

function foldFrameInfo(frame: ResolvedFoldFrame): ImportedFoldFrameInfo {
  const classes = stringArrayField(frame.frame.frame_classes);
  return {
    index: frame.index,
    title: stringField(frame.frame.frame_title),
    classes,
    inherited: frame.inherited,
    parentIndex: frame.parentIndex,
    foldedForm: classes.includes('foldedForm'),
    vertices: arrayField(frame.frame.vertices_coords).length,
    edges: arrayField(frame.frame.edges_vertices).length,
    faces: arrayField(frame.frame.faces_vertices).length,
  };
}

function frameScore(frame: Record<string, unknown>): number {
  const classes = stringArrayField(frame.frame_classes);
  const isCreaseFrame = classes.includes('creasePattern') || classes.includes('foldedForm');
  const hasFaces = arrayField(frame.faces_vertices).length > 0;
  return (isCreaseFrame ? 100 : 0) + (hasFaces ? 10 : 0);
}

function hasUsableFoldGeometry(frame: Record<string, unknown>): boolean {
  return arrayField(frame.vertices_coords).length > 0 && arrayField(frame.edges_vertices).length > 0;
}

function normalizeFoldObject(
  frame: Record<string, unknown>,
  title: string,
  diagnostics: ImportedCreasePatternDiagnostics
): FoldDocument {
  const rawCoords = arrayField(frame.vertices_coords)
    .filter(Array.isArray)
    .map((coord) => coord.map((value) => Number(value)))
    .filter((coord) => coord.length >= 2 && coord.every(Number.isFinite));
  const coords = normalizePoints(rawCoords.map(coordToPoint));
  const edges = arrayField(frame.edges_vertices)
    .filter(Array.isArray)
    .map((edge) => [Number(edge[0]), Number(edge[1])] as [number, number])
    .filter((edge) => edge.every((vertex) => Number.isInteger(vertex) && vertex >= 0 && vertex < coords.length));
  const assignments = normalizeAssignments(arrayField(frame.edges_assignment), edges.length);
  const faces = arrayField(frame.faces_vertices)
    .filter(Array.isArray)
    .map((face) => face.map((vertex) => Number(vertex)))
    .filter((face) => face.length >= 3 && face.every((vertex) => Number.isInteger(vertex) && vertex >= 0 && vertex < coords.length));

  if (rawCoords.length !== arrayField(frame.vertices_coords).length) {
    diagnostics.warnings.push('Some FOLD vertices were ignored because they were invalid');
  }
  if (edges.length !== arrayField(frame.edges_vertices).length) {
    diagnostics.warnings.push('Some FOLD edges were ignored because they referenced invalid vertices');
  }

  return completeFold({
    file_spec: numberField(frame.file_spec) ?? 1.2,
    file_creator: stringField(frame.file_creator) ?? undefined,
    file_author: stringField(frame.file_author) ?? undefined,
    file_title: stringField(frame.file_title) ?? undefined,
    frame_title: title,
    frame_parent: numberField(frame.frame_parent) ?? undefined,
    frame_inherit: typeof frame.frame_inherit === 'boolean' ? frame.frame_inherit : undefined,
    frame_classes: stringArrayField(frame.frame_classes),
    vertices_coords: coords.map((point) => [point.x, point.y]),
    edges_vertices: edges,
    edges_assignment: assignments,
    edges_foldAngle: normalizeFoldAngles(arrayField(frame.edges_foldAngle), assignments),
    edges_faces: [],
    faces_vertices: faces,
    faces_edges: [],
    face_orders: [],
  });
}

function foldFromSegments(segments: RawSegment[], title: string): FoldDocument {
  const normalizedSegments = normalizeSegments(segments);
  const { vertices, edges, assignments } = splitSegments(normalizedSegments);
  return completeFold({
    file_spec: 1.2,
    file_creator: 'treemaker-rs',
    frame_title: title,
    frame_classes: ['creasePattern'],
    vertices_coords: vertices.map((point) => [point.x, point.y]),
    edges_vertices: edges,
    edges_assignment: assignments,
    edges_foldAngle: assignments.map(defaultFoldAngle),
    edges_faces: [],
    faces_vertices: [],
    faces_edges: [],
    face_orders: [],
  });
}

function inferTopology(
  fold: FoldDocument,
  diagnostics: ImportedCreasePatternDiagnostics
): FoldDocument {
  const segments = fold.edges_vertices.flatMap((edge, index): RawSegment[] => {
    const a = fold.vertices_coords[edge[0]];
    const b = fold.vertices_coords[edge[1]];
    if (!a || !b) return [];
    return [
      {
        a: { x: a[0] ?? 0, y: a[1] ?? 0 },
        b: { x: b[0] ?? 0, y: b[1] ?? 0 },
        assignment: fold.edges_assignment?.[index] ?? 'U',
      },
    ];
  });
  const { vertices, edges, assignments } = splitSegments(segments);
  const faces = buildPlanarFaces(vertices, edges);
  if (faces.length === 0) {
    diagnostics.warnings.push('No bounded faces could be inferred; simulation is unavailable');
  }
  return completeFold({
    ...fold,
    vertices_coords: vertices.map((point) => [point.x, point.y]),
    edges_vertices: edges,
    edges_assignment: assignments,
    edges_foldAngle: assignments.map(defaultFoldAngle),
    faces_vertices: faces,
    faces_edges: [],
    edges_faces: [],
  });
}

// The simulator derives each face's normal from its winding, and the triangulation
// step (earcut for polygons, diagonal split for quads) can emit inconsistently
// wound triangles. Force every triangle to the same winding in the flat paper
// plane so all normals agree and fold directions are consistent.
function orientFacesConsistently(fold: FoldDocument): FoldDocument {
  const coords = fold.vertices_coords ?? [];
  const faces = (fold.faces_vertices ?? []).map((face) => {
    let area = 0;
    for (let i = 0; i < face.length; i += 1) {
      const a = coords[face[i]!] ?? [];
      const b = coords[face[(i + 1) % face.length]!] ?? [];
      // Flat simulator coords are [x, 0, z]; measure winding in the x-z plane.
      area += (a[0] ?? 0) * (b[2] ?? 0) - (b[0] ?? 0) * (a[2] ?? 0);
    }
    return area < 0 ? [...face].reverse() : face;
  });
  const next: FoldDocument = { ...fold, faces_vertices: faces };
  delete next.faces_edges;
  delete next.edges_faces;
  return next;
}

// Global sign relating M/V fold angles to the (now-consistent) face normals.
// With every face wound the same way there is a single correct value: -1, so
// mountains fold as mountains and valleys as valleys against our winding.
const SIMULATION_FOLD_ANGLE_SIGN = -1;

function prepareSimulationFold(fold: FoldDocument): { fold: FoldDocument | null; error: string | null } {
  if (fold.faces_vertices.length === 0) {
    return { fold: null, error: 'Simulation requires inferred or imported faces' };
  }
  try {
    // Triangulate, normalize all face windings, then rebuild the crease params
    // from the consistently-oriented triangles.
    const triangulated = prepareFoldModel(fold as SimulatorFoldDocument, {
      triangulate: true,
    }).fold as FoldDocument;
    const oriented = orientFacesConsistently(triangulated);
    oriented.edges_foldAngle = (oriented.edges_foldAngle ?? []).map((angle) =>
      typeof angle === 'number' ? angle * SIMULATION_FOLD_ANGLE_SIGN : angle
    );
    const model = prepareFoldModel(oriented as SimulatorFoldDocument, { triangulate: false });
    return { fold: model.fold as FoldDocument, error: null };
  } catch (error) {
    return {
      fold: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function projectFromFold(fold: FoldDocument, title: string): TreeProject {
  const points = fold.vertices_coords.map((coord) => ({ x: coord[0] ?? 0, y: coord[1] ?? 0 }));
  return {
    title,
    paper: { width: 1, height: 1, symLoc: { x: 0.5, y: 0.5 }, symAngle: 90 },
    scale: 0.1,
    hasSymmetry: false,
    nodes: [],
    edges: [],
    paths: [],
    creases: fold.edges_vertices.flatMap((edge, index): CreaseLine[] => {
      const a = points[edge[0]];
      const b = points[edge[1]];
      if (!a || !b) return [];
      const assignment = fold.edges_assignment?.[index] ?? 'U';
      return [
        {
          id: index + 1,
          vertices: [a, b],
          fold: foldName(assignment),
          kind: kindName(assignment),
        },
      ];
    }),
    facets: fold.faces_vertices.flatMap((face, index): FacetShape[] => {
      const vertices = face.flatMap((vertex) => {
        const point = points[vertex];
        return point ? [point] : [];
      });
      if (vertices.length < 3) return [];
      return [{ id: index + 1, vertices, color: index % 2 === 0 ? 'white' : 'color' }];
    }),
    conditions: [],
  };
}

function splitSegments(segments: NormalizedSegment[]): {
  vertices: RawPoint[];
  edges: [number, number][];
  assignments: FoldAssignment[];
} {
  const cuts = segments.map(() => [0, 1]);
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const intersection = segmentIntersectionParams(segments[i], segments[j]);
      intersection.a.forEach((value) => cuts[i]?.push(value));
      intersection.b.forEach((value) => cuts[j]?.push(value));
    }
  }

  const vertices: RawPoint[] = [];
  const vertexKeys = new Map<string, number>();
  const edgeMap = new Map<string, FoldAssignment>();

  const vertexId = (point: RawPoint) => {
    const key = `${roundKey(point.x)}:${roundKey(point.y)}`;
    const existing = vertexKeys.get(key);
    if (existing !== undefined) return existing;
    const id = vertices.length;
    vertices.push(point);
    vertexKeys.set(key, id);
    return id;
  };

  segments.forEach((segment, index) => {
    const ts = uniqueSorted(cuts[index] ?? [0, 1]);
    for (let i = 0; i < ts.length - 1; i += 1) {
      const t0 = ts[i] ?? 0;
      const t1 = ts[i + 1] ?? 1;
      if (Math.abs(t1 - t0) < EPSILON) continue;
      const a = interpolate(segment, t0);
      const b = interpolate(segment, t1);
      if (distance(a, b) < EPSILON) continue;
      const va = vertexId(a);
      const vb = vertexId(b);
      if (va === vb) continue;
      const key = va < vb ? `${va}:${vb}` : `${vb}:${va}`;
      edgeMap.set(key, mergeAssignment(edgeMap.get(key), segment.assignment));
    }
  });

  const edges: [number, number][] = [];
  const assignments: FoldAssignment[] = [];
  [...edgeMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach(([key, assignment]) => {
      const [a, b] = key.split(':').map(Number);
      if (a === undefined || b === undefined || !Number.isInteger(a) || !Number.isInteger(b)) return;
      edges.push([a, b]);
      assignments.push(assignment);
    });

  return { vertices, edges, assignments };
}

function segmentIntersectionParams(
  a: NormalizedSegment | undefined,
  b: NormalizedSegment | undefined
): { a: number[]; b: number[] } {
  if (!a || !b) return { a: [], b: [] };
  const p = a.a;
  const r = { x: a.b.x - a.a.x, y: a.b.y - a.a.y };
  const q = b.a;
  const s = { x: b.b.x - b.a.x, y: b.b.y - b.a.y };
  const rxs = cross(r, s);
  const qmp = { x: q.x - p.x, y: q.y - p.y };
  const qmpxr = cross(qmp, r);

  if (Math.abs(rxs) < EPSILON) {
    if (Math.abs(qmpxr) >= EPSILON) return { a: [], b: [] };
    return {
      a: [projectParam(a, b.a), projectParam(a, b.b)].filter(inUnit),
      b: [projectParam(b, a.a), projectParam(b, a.b)].filter(inUnit),
    };
  }

  const t = cross(qmp, s) / rxs;
  const u = cross(qmp, r) / rxs;
  if (!inUnit(t) || !inUnit(u)) return { a: [], b: [] };
  return { a: [clamp01(t)], b: [clamp01(u)] };
}

function buildPlanarFaces(vertices: RawPoint[], edges: [number, number][]): number[][] {
  const neighbors = new Map<number, number[]>();
  edges.forEach(([a, b]) => {
    neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
    neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
  });
  for (const [vertex, list] of neighbors) {
    const center = vertices[vertex];
    if (!center) continue;
    list.sort((a, b) => angle(center, vertices[a]) - angle(center, vertices[b]));
  }

  const visited = new Set<string>();
  const faces: number[][] = [];
  for (const [a, b] of directedEdges(edges)) {
    const start = `${a}:${b}`;
    if (visited.has(start)) continue;
    const face: number[] = [];
    let u = a;
    let v = b;
    for (let guard = 0; guard < edges.length * 4; guard += 1) {
      const key = `${u}:${v}`;
      if (visited.has(key)) break;
      visited.add(key);
      face.push(u);
      const outgoing = neighbors.get(v) ?? [];
      const incomingIndex = outgoing.indexOf(u);
      if (incomingIndex < 0 || outgoing.length === 0) break;
      const w = outgoing[(incomingIndex - 1 + outgoing.length) % outgoing.length];
      if (w === undefined) break;
      u = v;
      v = w;
      if (u === a && v === b) break;
    }
    if (face.length >= 3 && polygonArea(face, vertices) > EPSILON) {
      faces.push(face);
    }
  }
  return faces;
}

function normalizeSegments(segments: RawSegment[]): NormalizedSegment[] {
  const points = normalizePoints(segments.flatMap((segment) => [segment.a, segment.b]));
  return segments.map((segment, index) => ({
    a: points[index * 2] ?? segment.a,
    b: points[index * 2 + 1] ?? segment.b,
    assignment: segment.assignment,
  }));
}

function normalizePoints(points: RawPoint[]): RawPoint[] {
  if (points.length === 0) return [];
  const bounds = points.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      maxX: Math.max(acc.maxX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxY: Math.max(acc.maxY, point.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const spanX = Math.max(EPSILON, bounds.maxX - bounds.minX);
  const spanY = Math.max(EPSILON, bounds.maxY - bounds.minY);
  const scale = Math.max(spanX, spanY);
  const offsetX = (1 - spanX / scale) / 2;
  const offsetY = (1 - spanY / scale) / 2;
  return points.map((point) => ({
    x: offsetX + (point.x - bounds.minX) / scale,
    y: offsetY + (point.y - bounds.minY) / scale,
  }));
}

function statsFromFold(fold: FoldDocument): ImportedCreasePatternStats {
  return (fold.edges_assignment ?? []).reduce(
    (stats, assignment) => {
      if (assignment === 'M') stats.mountains += 1;
      else if (assignment === 'V') stats.valleys += 1;
      else if (assignment === 'B') stats.boundaries += 1;
      else if (assignment === 'F') stats.flats += 1;
      else stats.unassigned += 1;
      return stats;
    },
    {
      vertices: fold.vertices_coords.length,
      edges: fold.edges_vertices.length,
      faces: fold.faces_vertices.length,
      mountains: 0,
      valleys: 0,
      boundaries: 0,
      flats: 0,
      unassigned: 0,
    }
  );
}

function completeFold(fold: FoldDocument): FoldDocument {
  const assignments = normalizeAssignments(fold.edges_assignment ?? [], fold.edges_vertices.length);
  return {
    ...fold,
    frame_classes: fold.frame_classes?.length ? fold.frame_classes : ['creasePattern'],
    edges_assignment: assignments,
    edges_foldAngle:
      fold.edges_foldAngle?.length === fold.edges_vertices.length
        ? fold.edges_foldAngle
        : assignments.map(defaultFoldAngle),
    edges_faces: fold.edges_faces ?? [],
    faces_edges: fold.faces_edges ?? [],
    face_orders: fold.face_orders ?? [],
  };
}

function normalizeAssignments(values: unknown[], count: number): FoldAssignment[] {
  return Array.from({ length: count }, (_, index) => {
    const value = values[index];
    return value === 'B' || value === 'M' || value === 'V' || value === 'F' || value === 'U' || value === 'C' || value === 'J'
      ? value
      : 'U';
  });
}

function normalizeFoldAngles(values: unknown[], assignments: FoldAssignment[]): Array<number | null> {
  return assignments.map((assignment, index) => {
    const value = values[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : defaultFoldAngle(assignment);
  });
}

function defaultFoldAngle(assignment: FoldAssignment): number | null {
  if (assignment === 'M') return -180;
  if (assignment === 'V') return 180;
  if (assignment === 'F') return 0;
  return null;
}

function cpAssignment(kind: string | undefined): FoldAssignment | null {
  if (kind === '1') return 'B';
  if (kind === '2') return 'M';
  if (kind === '3') return 'V';
  return null;
}

function foldName(assignment: FoldAssignment): CreaseLine['fold'] {
  if (assignment === 'M') return 'mountain';
  if (assignment === 'V') return 'valley';
  if (assignment === 'B') return 'border';
  if (assignment === 'U' || assignment === 'C' || assignment === 'J') return 'unassigned';
  return 'flat';
}

function kindName(assignment: FoldAssignment): CreaseLine['kind'] {
  if (assignment === 'B') return 'axial';
  if (assignment === 'M' || assignment === 'V') return 'ridge';
  if (assignment === 'F') return 'hinge';
  return 'pseudohinge';
}

function mergeAssignment(current: FoldAssignment | undefined, next: FoldAssignment): FoldAssignment {
  if (!current || current === next) return next;
  if (current === 'U') return next;
  if (next === 'U') return current;
  if (current === 'B' || next === 'B') return 'B';
  if (current === 'F') return next;
  if (next === 'F') return current;
  return current;
}

function withoutFileFrames(record: Record<string, unknown>): Record<string, unknown> {
  const { file_frames: _fileFrames, ...frame } = record;
  return frame;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coordToPoint(coord: number[]): RawPoint {
  return { x: coord[0] ?? 0, y: coord.length === 2 ? (coord[1] ?? 0) : (coord[2] ?? coord[1] ?? 0) };
}

function basenameWithoutExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/u, '') || 'Untitled crease pattern';
}

function interpolate(segment: NormalizedSegment, t: number): RawPoint {
  return {
    x: segment.a.x + (segment.b.x - segment.a.x) * t,
    y: segment.a.y + (segment.b.y - segment.a.y) * t,
  };
}

function projectParam(segment: NormalizedSegment, point: RawPoint): number {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < EPSILON) return 0;
  return ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSq;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.filter(inUnit).map(clamp01).map((value) => Number(value.toFixed(10))))]
    .sort((a, b) => a - b);
}

function directedEdges(edges: [number, number][]): Array<[number, number]> {
  return edges.flatMap(([a, b]) => [[a, b], [b, a]] as Array<[number, number]>);
}

function polygonArea(face: number[], vertices: RawPoint[]): number {
  let area = 0;
  for (let i = 0; i < face.length; i += 1) {
    const a = vertices[face[i] ?? 0];
    const b = vertices[face[(i + 1) % face.length] ?? 0];
    if (!a || !b) continue;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function angle(center: RawPoint, point: RawPoint | undefined): number {
  if (!point) return 0;
  return Math.atan2(point.y - center.y, point.x - center.x);
}

function cross(a: RawPoint, b: RawPoint): number {
  return a.x * b.y - a.y * b.x;
}

function distance(a: RawPoint, b: RawPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function roundKey(value: number): string {
  return value.toFixed(9);
}

function inUnit(value: number): boolean {
  return value >= -EPSILON && value <= 1 + EPSILON;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
