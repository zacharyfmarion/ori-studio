import {
  AUX_LINES_KEY,
  prepareFoldModel,
  type AuxLine,
  type FoldDocument as SimulatorFoldDocument,
} from '@treemaker/origami-simulator';
import type { FoldAssignment, FoldArtifacts, FoldDocument } from '../engine/types';
import { remapEdgeExtensionArrays } from './foldEdgeArrays';
import { foldAuxLinesAreFacets } from './simulationAuxLines';
import type { CreaseLine, FacetShape, TreeProject } from './sampleProject';

import type { ImportedCreasePatternFormat } from './fileFormats';

export { importedCreasePatternFormat, type ImportedCreasePatternFormat } from './fileFormats';

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
  /**
   * Index of the edge this segment came from in the source fold, so per-edge
   * extension arrays can be re-indexed onto the rebuilt edge list. Absent when
   * the segments have no source fold (parsing a `.cp` file).
   */
  source?: number;
}

interface NormalizedSegment {
  a: RawPoint;
  b: RawPoint;
  assignment: FoldAssignment;
  source?: number;
}

const EPSILON = 1e-8;

/**
 * Bucket edge for the vertex index in {@link splitSegments}, four times the
 * merge radius so scanning the 3x3 neighbourhood always covers it.
 *
 * Mirrors the kernel's `VERTEX_BUCKET = Epsilon::POINT * 4.0`
 * (`crates/oristudio-cp/src/fold_graph.rs`).
 */
const VERTEX_BUCKET = EPSILON * 4;

export function isCreasePatternFilename(filename: string): boolean {
  return /\.(fold|cp|ori|orh)$/i.test(filename);
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
  // No kernel holds a read-only import, so its aux lines come out of the
  // simulated paper here, by the rule a live document's do.
  const foldArtifacts = foldArtifactsSimulating(
    withTopology,
    foldAuxLinesAreFacets(parsed.sourceFold ?? parsed.fold)
      ? withTopology
      : foldWithAuxLinesDrawn(withTopology, diagnostics)
  );
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

/**
 * Fold artifacts whose simulation mesh is built from `simulationSource`: the
 * pattern's fold lines alone, with its aux lines carried beside them
 * (`AUX_LINES_KEY`) to be drawn on the paper. The base fold is the pattern as
 * drawn, so segmentation and every export read it unchanged. With the fold
 * itself as the source this is {@link foldArtifactsFromFold}.
 */
export function foldArtifactsSimulating(
  fold: FoldDocument,
  simulationSource: FoldDocument,
  diagnostics: ImportedCreasePatternDiagnostics = { warnings: [], errors: [] }
): FoldArtifacts {
  if (simulationSource === fold) return foldArtifactsFromFold(fold, diagnostics);
  const simulation = foldArtifactsFromFold(simulationSource, diagnostics);
  return {
    ...segmentationFoldArtifactsFromFold(fold, diagnostics),
    simulation_model: simulation.simulation_model,
    simulation_model_error: simulation.simulation_model_error,
  };
}

/**
 * A fold with its `F` edges taken out of the paper and carried beside it
 * (`AUX_LINES_KEY`), its faces inferred from what is left — for a fold no
 * kernel can export the fold lines of. The fold itself when it has none.
 */
function foldWithAuxLinesDrawn(
  fold: FoldDocument,
  diagnostics: ImportedCreasePatternDiagnostics
): FoldDocument {
  const kept: number[] = [];
  const aux: AuxLine[] = [];
  fold.edges_vertices.forEach((edge, index) => {
    if ((fold.edges_assignment?.[index] ?? 'U') !== 'F') {
      kept.push(index);
      return;
    }
    const a = fold.vertices_coords[edge[0]];
    const b = fold.vertices_coords[edge[1]];
    if (a && b) aux.push([a, b]);
  });
  if (aux.length === 0) return fold;
  const paper: FoldDocument = {
    ...fold,
    edges_vertices: kept.map((index) => fold.edges_vertices[index]!),
    edges_assignment: kept.map((index) => fold.edges_assignment?.[index] ?? 'U'),
    edges_foldAngle: kept.map((index) => fold.edges_foldAngle?.[index] ?? null),
    faces_vertices: [],
    faces_edges: [],
    [AUX_LINES_KEY]: aux,
  };
  remapEdgeExtensionArrays(paper, fold, fold.edges_vertices.length, kept);
  delete paper.edges_faces;
  return inferTopology(paper, diagnostics);
}

/**
 * Report a live kernel document whose faces had to be inferred here.
 *
 * On the file-import path an absent `faces_vertices` is ordinary: `.cp` carries
 * no faces and a `.fold` may be line-only, so inferring them is the whole job.
 * On a document the kernel just exported it is a verdict — the kernel ran
 * Oriedita's Euler check, once per connected component, and judged the
 * arrangement numerically untrustworthy. Inferring faces anyway is the useful
 * behaviour; doing it silently is not, because the geometry may be damaged in
 * ways the simulation will not obviously show.
 *
 * Comparing before against after is what keeps this quiet in the normal cases:
 * a document that simply has nothing enclosing a face — empty, or a few
 * dangling creases — infers none either, and says nothing.
 */
export function warnIfFacesWereInferred(
  exported: FoldDocument,
  resolved: FoldArtifacts['fold'],
  surface: string
): void {
  if (exported.faces_vertices?.length) return;
  if (!resolved.faces_vertices?.length) return;
  console.warn(
    `[${surface}] the crease-pattern kernel supplied no faces, so they were inferred here. ` +
      "Its arrangement failed Oriedita's Euler check, which upstream reads as rounding " +
      'damage — the geometry may not fold as drawn.'
  );
}

/**
 * Fold artifacts carrying only what crease-pattern *segmentation* needs — the
 * base fold with faces — and deliberately **not** the simulation model.
 *
 * Building the simulation model (`prepareSimulationFold`: triangulation +
 * adjacency + crease params) costs seconds on large documents, but segmentation
 * only reads faces (which the kernel already computes on export). Segment ids are
 * identical to the full artifacts' (same coordinates ⇒ same regions and
 * top-left ordering), so callers can scope export/simulate by the resulting
 * `segmentId` interchangeably. Use this anywhere a live selection needs segments
 * without paying for the simulation mesh; the simulator still builds the full
 * artifacts when it is actually entered.
 */
export function segmentationFoldArtifactsFromFold(
  fold: FoldDocument,
  diagnostics: ImportedCreasePatternDiagnostics = { warnings: [], errors: [] }
): FoldArtifacts {
  return {
    fold: fold.faces_vertices?.length ? fold : inferTopology(fold, diagnostics),
    folded_base: null,
    folded_base_error: null,
    simulation_model: null,
    simulation_model_error: null,
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
  const { frame, ...resolved } = resolveFoldSource(parsed, filename);
  return { ...resolved, fold: normalizeFoldObject(frame, resolved.title, diagnostics) };
}

/** A FOLD object's frames, title, and the frame an import reads — nothing normalized yet. */
function resolveFoldSource(
  parsed: unknown,
  filename: string
): Omit<ParsedFoldSource, 'fold'> & { frame: Record<string, unknown> } {
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

  return {
    title,
    selectedFrame: foldFrameInfo(chosen),
    foldFrames: frameInfos,
    foldedFormFrames: frameInfos.filter((frame) => frame.foldedForm),
    sourceFold: parsed as FoldDocument,
    frame: chosen.frame,
  };
}

/**
 * The import record for a crease pattern restored from an Ori Studio project:
 * what the file says, with nothing inferred.
 *
 * A project open puts the editable document straight into the kernel, so
 * nothing on that path reads what {@link parseImportedCreasePatternFromFold}
 * spends its time on — inferred faces, a simulation mesh and a `TreeProject` of
 * every crease, 26 s on the main thread for a 489k-crease canvas. The record is
 * read for its title, source, `sourceFold` and frame list. Its `fold` is the
 * chosen frame as stored, which only Export FOLD reads, and only when no kernel
 * document exists.
 */
export function storedImportedCreasePattern(
  fold: unknown,
  source: ImportedCreasePatternSource
): ImportedCreasePatternDocument {
  const { frame, ...resolved } = resolveFoldSource(fold, source.filename);
  const stored: FoldDocument = {
    ...frame,
    frame_title: resolved.title,
    vertices_coords: arrayField(frame.vertices_coords) as number[][],
    edges_vertices: arrayField(frame.edges_vertices) as [number, number][],
    faces_vertices: arrayField(frame.faces_vertices) as number[][],
  };
  return {
    source,
    ...resolved,
    fold: stored,
    lineOnly: stored.faces_vertices.length === 0,
    simulationModelError: null,
    diagnostics: { warnings: [], errors: [] },
    stats: statsFromFold(stored),
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
  // Frames whose resolution is in progress. `frame_parent` is an arbitrary index
  // out of the file, so it can point back into the chain being resolved — and
  // the cache is only written *after* the recursive call, so nothing stopped a
  // cycle recursing until the stack overflowed. A frame that would inherit from
  // one still being built simply does not inherit; the file is malformed, and
  // dropping the inheritance is the recoverable reading of it.
  const visiting = new Set<number>();

  const build = (index: number): ResolvedFoldFrame => {
    const cached = cache.get(index);
    if (cached) return cached;
    visiting.add(index);
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
      parent < rawFrames.length &&
      !visiting.has(parent)
    ) {
      const parentFrame = build(parent);
      frame = { ...parentFrame.frame, ...frame };
      inherited = true;
    }
    const result = { frame, index, inherited, parentIndex: parent };
    visiting.delete(index);
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

/**
 * Which frame of a multi-frame FOLD file to open as the crease pattern.
 *
 * `foldedForm` used to score as a crease frame, tied with `creasePattern` at
 * 100. A file carrying both — which is the shape the FOLD spec suggests for a
 * design and its folded state — could therefore hand the folded frame to an
 * importer that keeps x and y and drops z, and the crease pattern would arrive
 * as the folded model's flat shadow. It now scores *below* an unclassified
 * frame, so it is chosen only when it is the only usable frame in the file, and
 * then the kernel refuses it by name (`fold_folded_form`) rather than flattening
 * it.
 */
function frameScore(frame: Record<string, unknown>): number {
  const classes = stringArrayField(frame.frame_classes);
  const hasFaces = arrayField(frame.faces_vertices).length > 0;
  if (classes.includes('creasePattern')) return 100 + (hasFaces ? 10 : 0);
  if (classes.includes('foldedForm')) return -100;
  return hasFaces ? 10 : 0;
}

function hasUsableFoldGeometry(frame: Record<string, unknown>): boolean {
  return arrayField(frame.vertices_coords).length > 0 && arrayField(frame.edges_vertices).length > 0;
}

function normalizeFoldObject(
  frame: Record<string, unknown>,
  title: string,
  diagnostics: ImportedCreasePatternDiagnostics
): FoldDocument {
  // Dropping an entry from either list renumbers everything after it, and every
  // other array here points *into* those lists — by vertex index (edges, faces)
  // or by edge position (assignments, fold angles). Filtering without carrying
  // that provenance is how one malformed vertex used to delete a corner of the
  // sheet, and one out-of-range edge used to turn later valleys into mountains.
  //
  // Same defect class as `foldEdgeArrays.ts`, which owns it for the *rebuild*
  // sites; this is the import filter, and it also has to remap vertex indices,
  // which nothing else does.
  const rawVertices = arrayField(frame.vertices_coords);
  /** Original vertex index -> index in the filtered list. Absent = dropped. */
  const vertexRemap = new Map<number, number>();
  const rawCoords: number[][] = [];
  rawVertices.forEach((entry, sourceIndex) => {
    if (!Array.isArray(entry)) return;
    const coord = entry.map((value) => Number(value));
    if (coord.length < 2 || !coord.every(Number.isFinite)) return;
    vertexRemap.set(sourceIndex, rawCoords.length);
    rawCoords.push(coord);
  });
  const coords = normalizePoints(rawCoords.map(coordToPoint));

  const rawEdges = arrayField(frame.edges_vertices);
  /** Which source edge each surviving edge came from, for the per-edge arrays. */
  const sourceEdgeIndices: number[] = [];
  const edges: Array<[number, number]> = [];
  rawEdges.forEach((entry, sourceIndex) => {
    if (!Array.isArray(entry)) return;
    // A lookup miss covers every rejection at once: out of range, negative,
    // non-integer, or pointing at a vertex this import dropped.
    const a = vertexRemap.get(Number(entry[0]));
    const b = vertexRemap.get(Number(entry[1]));
    if (a === undefined || b === undefined) return;
    sourceEdgeIndices.push(sourceIndex);
    edges.push([a, b]);
  });
  const assignments = normalizeAssignments(arrayField(frame.edges_assignment), sourceEdgeIndices);
  const faces = arrayField(frame.faces_vertices)
    .filter(Array.isArray)
    .map((face) => face.map((vertex) => vertexRemap.get(Number(vertex))))
    .filter(
      (face): face is number[] =>
        face.length >= 3 && face.every((vertex) => vertex !== undefined)
    );

  if (rawCoords.length !== rawVertices.length) {
    diagnostics.warnings.push('Some FOLD vertices were ignored because they were invalid');
  }
  if (edges.length !== rawEdges.length) {
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
    edges_foldAngle: normalizeFoldAngles(
      arrayField(frame.edges_foldAngle),
      assignments,
      sourceEdgeIndices
    ),
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
        source: index,
      },
    ];
  });
  const { vertices, edges, assignments, sources } = splitSegments(segments);
  const faces = buildPlanarFaces(vertices, edges);
  if (faces.length === 0) {
    diagnostics.warnings.push('No bounded faces could be inferred; simulation is unavailable');
  }
  // Carry each split edge's fold angle over from the segment it came from.
  // Deriving it from the assignment instead would flatten every non-180 crease
  // back to +/-180 -- `.fold` is the only format that can express one, so that
  // would silently destroy the angle on the way into the simulator.
  const sourceFoldAngles = fold.edges_foldAngle;
  const inheritedFoldAngle = (index: number): number | null => {
    const source = sources[index];
    const inherited = source === undefined ? undefined : sourceFoldAngles?.[source];
    return typeof inherited === 'number' && Number.isFinite(inherited)
      ? inherited
      : defaultFoldAngle(assignments[index]!);
  };
  const next = completeFold({
    ...fold,
    vertices_coords: vertices.map((point) => [point.x, point.y]),
    edges_vertices: edges,
    edges_assignment: assignments,
    edges_foldAngle: assignments.map((_, index) => inheritedFoldAngle(index)),
    faces_vertices: faces,
    faces_edges: [],
    edges_faces: [],
  });
  // The spread above carries the source fold's per-edge extension arrays, which
  // describe the edge list this function just replaced: segments are split at
  // intersections, coincident ones merge, and the survivors come out in a new
  // order. `sources` is the provenance that puts them back in step.
  remapEdgeExtensionArrays(next, fold, fold.edges_vertices.length, sources);
  return next;
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
  /** Source segment index behind each output edge, parallel to `edges`. */
  sources: number[];
} {
  const cuts = segments.map(() => [0, 1]);
  collectIntersectionCuts(segments, cuts);

  const vertices: RawPoint[] = [];
  const vertexBuckets = new Map<number, number[]>();
  // Keyed by the edge's two vertex ids as one number (`edgeKey`), not a string:
  // building and hashing ~600k `low:high` strings was a fifth of inference on a
  // canvas of 489k creases.
  const edgeMap = new Map<number, FoldAssignment>();
  // The source segment whose assignment survived the merge for each output
  // edge, so per-edge extension data (line colours) follows the crease type it
  // belongs to rather than an arbitrary coincident segment.
  const edgeSources = new Map<number, number>();

  // Coincident endpoints merge by distance, not by a quantized key.
  //
  // The key this replaces was `toFixed(9)` per coordinate, and `toFixed` keeps
  // the sign of a negative that rounds to zero: a centre vertex reached at t=1
  // came out as exactly `0` (the arithmetic cancels), while the same centre
  // reached at t=0 kept its raw `-9.09e-15`, giving `"0.000000000"` and
  // `"-0.000000000"`. One vertex became two, 1.3e-14 apart, and the sheet tore
  // between them. Any quantization has the same failure at every cell edge;
  // zero is only where coordinates most often land.
  //
  // EPSILON rather than the kernel's much wider `Epsilon::POINT`: the emit loop
  // below already drops a sub-edge shorter than EPSILON, so this file has
  // always held that two points that close are one point. The index just
  // disagreed with its own emitter.
  const vertexId = (point: RawPoint) => {
    const bx = Math.floor(point.x / VERTEX_BUCKET);
    const by = Math.floor(point.y / VERTEX_BUCKET);
    // Lowest match wins, so the result cannot depend on bucket iteration order.
    // A non-finite coordinate matches nothing (every comparison against NaN is
    // false) and is pushed as its own vertex, as it was before.
    let found: number | undefined;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = vertexBuckets.get(bucketKey(bx + dx, by + dy));
        if (!bucket) continue;
        for (const candidate of bucket) {
          if (!(distance(vertices[candidate]!, point) <= EPSILON)) continue;
          found = found === undefined ? candidate : Math.min(found, candidate);
        }
      }
    }
    if (found !== undefined) return found;

    const id = vertices.length;
    vertices.push(point);
    const key = bucketKey(bx, by);
    const bucket = vertexBuckets.get(key);
    if (bucket) bucket.push(id);
    else vertexBuckets.set(key, [id]);
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
      const key = va < vb ? edgeKey(va, vb) : edgeKey(vb, va);
      const previous = edgeMap.get(key);
      const merged = mergeAssignment(previous, segment.assignment);
      edgeMap.set(key, merged);
      // Claim the edge on first sight, and again whenever this segment changes
      // the merged assignment — that is precisely when it out-ranks the segment
      // holding the slot, so the two stay consistent.
      if (previous === undefined || merged !== previous) {
        edgeSources.set(key, segment.source ?? index);
      }
    }
  });

  // Edges in vertex order: by the lower vertex id, then the higher — which is
  // the order of their keys, since a key is `low * EDGE_KEY_RADIX + high`.
  const keys = Float64Array.from(edgeMap.keys()).sort();
  const edges: [number, number][] = [];
  const assignments: FoldAssignment[] = [];
  const sources: number[] = [];
  for (const key of keys) {
    const low = Math.floor(key / EDGE_KEY_RADIX);
    edges.push([low, key - low * EDGE_KEY_RADIX]);
    assignments.push(edgeMap.get(key)!);
    sources.push(edgeSources.get(key) ?? 0);
  }

  return { vertices, edges, assignments, sources };
}

/**
 * One number for an edge's two vertex ids, `low < high`, ordered as the pair
 * is: exact while both are below the radix, the square root of the largest
 * safe integer — some 95 million vertices, far past any pattern that fits in
 * memory.
 */
const EDGE_KEY_RADIX = 94_906_265;

function edgeKey(low: number, high: number): number {
  return low * EDGE_KEY_RADIX + high;
}

/**
 * One number for a vertex bucket's cell. Cells are 4e-8 wide in the pattern's
 * own units, so on a canvas thousands of units across their indices outgrow
 * the radix and two cells can share a key — harmless: a bucket then holds a
 * few more candidates, and the distance test turns away every one that is not
 * within `EPSILON`, so the vertex found is the same.
 */
function bucketKey(bx: number, by: number): number {
  return bx * EDGE_KEY_RADIX + by;
}

/**
 * Accumulate the parameters at which segments cut one another.
 *
 * Testing every pair is O(n²) — ~20M intersection tests on a 6.3k-crease pattern,
 * around a second — even though nearly every pair lies far apart. So only pairs
 * whose padded boxes overlap are tested. They are found through a grid of cells
 * about a typical segment long: each segment is listed in every cell its box
 * covers, and a pair is tested in the first cell the two share, so once. A
 * sweep along x found the same pairs, but kept every segment whose x-extent
 * still overlapped in its active list, and on a canvas of 204 sheets in rows a
 * long border overlaps a whole column of sheets: three seconds of 489k creases'
 * inference was that list being scanned.
 *
 * Two details make this produce *identical* output rather than merely similar:
 *
 * - **Padding.** A skipped pair must be one the predicate would have rejected
 *   anyway. Two slacks let it accept segments whose raw boxes are disjoint:
 *   {@link inUnit} tolerates parameters slightly outside `[0, 1]`, worth up to
 *   `EPSILON * length`; and the collinear branch compares `EPSILON` against a
 *   cross product that scales with length, so it treats segments as collinear out
 *   to a perpendicular distance of `EPSILON / length` — which *grows* as segments
 *   shrink, and dominates for short ones.
 * - **Argument order.** {@link segmentIntersectionParams} is asymmetric: its
 *   collinear test uses the *first* argument's direction vector. Visiting pairs
 *   in grid order rather than index order therefore changes results, so pairs
 *   are passed lower-index-first exactly as the original loop did.
 *
 * Cut order does not matter — `uniqueSorted` sorts and dedupes downstream.
 *
 * Zero-length creases are excluded. They contribute no edge of their own (the
 * emit loop drops sub-edges shorter than `EPSILON`), but they corrupt every
 * *other* segment: with a zero direction vector both `rxs` and `qmpxr` are
 * exactly 0, so the collinear branch matches unconditionally — against segments
 * anywhere on the sheet — and then projects onto a degenerate segment, injecting
 * spurious cuts and phantom vertices. Skipping them is what lets this agree with
 * the all-pairs result exactly.
 */
function collectIntersectionCuts(segments: NormalizedSegment[], cuts: number[][]): void {
  const count = segments.length;
  const minX = new Float64Array(count);
  const maxX = new Float64Array(count);
  const minY = new Float64Array(count);
  const maxY = new Float64Array(count);
  const candidates: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const segment = segments[i]!;
    const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    if (length < EPSILON) continue;
    const pad = EPSILON * length + EPSILON / length;
    minX[i] = Math.min(segment.a.x, segment.b.x) - pad;
    maxX[i] = Math.max(segment.a.x, segment.b.x) + pad;
    minY[i] = Math.min(segment.a.y, segment.b.y) - pad;
    maxY[i] = Math.max(segment.a.y, segment.b.y) + pad;
    candidates.push(i);
  }

  if (candidates.length < 2) return;

  const testPair = (one: number, other: number) => {
    if (maxX[one]! < minX[other]! || maxX[other]! < minX[one]!) return;
    if (maxY[one]! < minY[other]! || maxY[other]! < minY[one]!) return;
    const lower = one < other ? one : other;
    const higher = one < other ? other : one;
    const intersection = segmentIntersectionParams(segments[lower], segments[higher]);
    intersection.a.forEach((value) => cuts[lower]?.push(value));
    intersection.b.forEach((value) => cuts[higher]?.push(value));
  };

  // A box no grid can hold — a coordinate that is infinite or not a number — is
  // tested against every other segment, as the sweep tested it. No pattern the
  // app reads has one (import drops such vertices); a raw FOLD handed straight
  // in can, and one such segment must not turn the grid off for all the rest.
  const boxed: number[] = [];
  const unbounded: number[] = [];
  for (const i of candidates) {
    const finite =
      Number.isFinite(minX[i]) &&
      Number.isFinite(maxX[i]) &&
      Number.isFinite(minY[i]) &&
      Number.isFinite(maxY[i]);
    (finite ? boxed : unbounded).push(i);
  }
  unbounded.forEach((one, k) => {
    for (const other of boxed) testPair(one, other);
    for (const other of unbounded.slice(k + 1)) testPair(one, other);
  });
  if (boxed.length < 2) return;

  // Cells about as wide as a typical segment's box, and at most GRID_SIDE to a
  // side, so a cell's two coordinates make one exact key.
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let extent = 0;
  for (const i of boxed) {
    left = Math.min(left, minX[i]!);
    top = Math.min(top, minY[i]!);
    right = Math.max(right, maxX[i]!);
    bottom = Math.max(bottom, maxY[i]!);
    extent += Math.max(maxX[i]! - minX[i]!, maxY[i]! - minY[i]!);
  }
  const span = Math.max(right - left, bottom - top);
  let cell = Math.max(extent / boxed.length, span / GRID_SIDE, Number.MIN_VALUE);
  const column = (x: number) => Math.min(GRID_SIDE, Math.floor((x - left) / cell));
  const row = (y: number) => Math.min(GRID_SIDE, Math.floor((y - top) / cell));
  // Widened until the grid lists no more than GRID_COVERAGE cells a segment on
  // average: a long diagonal's box covers a square of cells, and one across the
  // whole canvas would otherwise be listed in millions of them.
  for (;;) {
    let listed = 0;
    for (const i of boxed) {
      listed +=
        (column(maxX[i]!) - column(minX[i]!) + 1) * (row(maxY[i]!) - row(minY[i]!) + 1);
    }
    if (listed <= GRID_COVERAGE * boxed.length || cell >= span) break;
    cell *= 2;
  }

  const firstColumn = new Int32Array(count);
  const firstRow = new Int32Array(count);
  const cells = new Map<number, number[]>();
  for (const i of boxed) {
    firstColumn[i] = column(minX[i]!);
    firstRow[i] = row(minY[i]!);
    const lastColumn = column(maxX[i]!);
    const lastRow = row(maxY[i]!);
    for (let cx = firstColumn[i]!; cx <= lastColumn; cx += 1) {
      for (let cy = firstRow[i]!; cy <= lastRow; cy += 1) {
        const key = cx * (GRID_SIDE + 1) + cy;
        const listed = cells.get(key);
        if (listed) listed.push(i);
        else cells.set(key, [i]);
      }
    }
  }

  for (const [key, listed] of cells) {
    const cx = Math.floor(key / (GRID_SIDE + 1));
    const cy = key - cx * (GRID_SIDE + 1);
    for (let p = 0; p < listed.length; p += 1) {
      const one = listed[p]!;
      for (let q = p + 1; q < listed.length; q += 1) {
        const other = listed[q]!;
        // Tested in the first cell the two share, and only there.
        if (Math.max(firstColumn[one]!, firstColumn[other]!) !== cx) continue;
        if (Math.max(firstRow[one]!, firstRow[other]!) !== cy) continue;
        testPair(one, other);
      }
    }
  }
}

/** The most cells to a side of {@link collectIntersectionCuts}'s grid. */
const GRID_SIDE = 4096;

/** The most cells {@link collectIntersectionCuts}'s grid lists a segment in, on average. */
const GRID_COVERAGE = 16;

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

  // Collinearity is `sin(theta)` against EPSILON, not the raw cross product.
  //
  // `rxs` is `|r||s|sin(theta)`, so comparing it directly makes the threshold
  // depend on how long the two segments happen to be — far too tight for long
  // ones, and far too loose for short ones (the `EPSILON / length` the sweep
  // above has to pad for). Measured on a real crease pattern: two creases
  // meeting end to end at a *bit-identical* endpoint, collinear to 2e-9 of a
  // degree, scored `rxs = 1.15e-8` on `|r||s| = 360` and so missed a 1e-8 bar.
  // The general branch below then divided two equal-magnitude near-zero numbers
  // (-1.149641e-08 / -1.149644e-08), reported the crossing at t = 0.999997528
  // instead of 1, and cut the crease 4.6e-5 short of the vertex it ends on. That
  // tail is shorter than the kernel's vertex-weld radius, so on the way back in
  // it collapsed to a self-loop and cost the whole pattern its faces.
  //
  // `qmpxr` below keeps its raw comparison. It has the same shape and the same
  // scale hazard, but it decides something else — whether two *parallel*
  // segments share a line — and nothing measured here says what its tolerance
  // should be, so it is left alone rather than changed on the strength of an
  // analogy.
  const angleScale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);

  if (angleScale === 0 || Math.abs(rxs) / angleScale < EPSILON) {
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

/**
 * The faces of a plane graph: from every half-edge not yet walked, turn to the
 * next edge clockwise at each vertex until the walk closes.
 *
 * Edge `e` is two half-edges, `2e` (a → b) and `2e + 1` (b → a), and walks
 * start from them in that order. Around each vertex its outgoing half-edges are
 * held in angle order, each knowing its place there, so a turn is two array
 * reads: the twin of the half-edge arrived on (`h ^ 1`) is where the walk came
 * in, and the one before it is where it leaves.
 */
function buildPlanarFaces(vertices: RawPoint[], edges: [number, number][]): number[][] {
  const halfEdges = edges.length * 2;
  const tail = new Int32Array(halfEdges);
  const head = new Int32Array(halfEdges);
  const start = new Int32Array(vertices.length + 1);
  edges.forEach(([a, b], e) => {
    tail[2 * e] = a;
    head[2 * e] = b;
    tail[2 * e + 1] = b;
    head[2 * e + 1] = a;
    start[a + 1]! += 1;
    start[b + 1]! += 1;
  });
  for (let vertex = 0; vertex < vertices.length; vertex += 1) start[vertex + 1]! += start[vertex]!;

  // Each vertex's outgoing half-edges in edge order, then sorted by angle — a
  // stable sort, so ties keep that order.
  const around = new Int32Array(halfEdges);
  const filled = start.slice(0, vertices.length);
  for (let h = 0; h < halfEdges; h += 1) around[filled[tail[h]!]!++] = h;
  const angles = new Float64Array(halfEdges);
  for (let h = 0; h < halfEdges; h += 1) angles[h] = angle(vertices[tail[h]!]!, vertices[head[h]!]);
  const place = new Int32Array(halfEdges);
  for (let vertex = 0; vertex < vertices.length; vertex += 1) {
    const from = start[vertex]!;
    const to = start[vertex + 1]!;
    if (to - from > 1) {
      const sorted = Array.from(around.subarray(from, to)).sort((x, y) => angles[x]! - angles[y]!);
      around.set(sorted, from);
    }
    for (let at = from; at < to; at += 1) place[around[at]!] = at - from;
  }

  const visited = new Uint8Array(halfEdges);
  const faces: number[][] = [];
  for (let first = 0; first < halfEdges; first += 1) {
    if (visited[first]) continue;
    const face: number[] = [];
    let h = first;
    for (let guard = 0; guard < edges.length * 4; guard += 1) {
      if (visited[h]) break;
      visited[h] = 1;
      face.push(tail[h]!);
      const v = head[h]!;
      const from = start[v]!;
      const count = start[v + 1]! - from;
      h = around[from + ((place[h ^ 1]! - 1 + count) % count)]!;
      if (h === first) break;
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
    source: segment.source,
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
  // This fold's arrays are already aligned with its edge list, so provenance is
  // the identity — unlike `normalizeFoldObject`, which is where entries get
  // dropped and the mapping stops being 1:1.
  const assignments = normalizeAssignments(
    fold.edges_assignment ?? [],
    fold.edges_vertices.map((_, index) => index)
  );
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

/**
 * Per-edge assignments for the *surviving* edges.
 *
 * Indexed through `sourceEdgeIndices` rather than positionally: these arrays are
 * aligned with the edge list as the file wrote it, so once any edge is dropped a
 * positional read hands every later edge its predecessor's crease type.
 */
function normalizeAssignments(values: unknown[], sourceEdgeIndices: number[]): FoldAssignment[] {
  return sourceEdgeIndices.map((sourceIndex) => {
    const value = values[sourceIndex];
    return value === 'B' || value === 'M' || value === 'V' || value === 'F' || value === 'U' || value === 'C' || value === 'J'
      ? value
      : 'U';
  });
}

/** Fold angles for the surviving edges; same provenance rule as assignments. */
function normalizeFoldAngles(
  values: unknown[],
  assignments: FoldAssignment[],
  sourceEdgeIndices: number[]
): Array<number | null> {
  return assignments.map((assignment, index) => {
    const value = values[sourceEdgeIndices[index] ?? index];
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

/**
 * Not affected by the signed-zero split that `vertexId` had, despite also going
 * through `toFixed`: these land in a `Set`, which compares with SameValueZero,
 * so `+0` and `-0` already collapse to one entry.
 */
function uniqueSorted(values: number[]): number[] {
  const kept = new Set<number>();
  for (const value of values) {
    if (!inUnit(value)) continue;
    const clamped = clamp01(value);
    // `toFixed` is the slow part, and a segment's own ends, 0 and 1, are already
    // what it would give back.
    kept.add(clamped === 0 || clamped === 1 ? clamped : Number(clamped.toFixed(10)));
  }
  return [...kept].sort((a, b) => a - b);
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

function inUnit(value: number): boolean {
  return value >= -EPSILON && value <= 1 + EPSILON;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
