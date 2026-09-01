/**
 * Which creases a region's solve owns, and where the solver's answer lands in
 * the document.
 *
 * Two pure functions, kept out of the binding hook because both are geometry
 * with edge cases worth naming in tests rather than behaviour worth mocking.
 *
 * **Nothing here is keyed by identity and nothing stores a transform.** Kernel
 * line ids are *indices*, so an undo or a parallel edit leaves a saved id
 * pointing at whatever now occupies that slot; and a stored offset breaks under
 * the move / rotate / scale the editor offers. So the owned set and the frame
 * are both re-derived from the region's current contents on every solve, which
 * is what makes those transforms non-events.
 *
 * ## The frame is known, not guessed
 *
 * The solver works in the unit square and the document does not, so an answer
 * has to be carried back. This module used to *hypothesise* that mapping — a
 * shift and a uniform scale, read off the owned creases' bounding box — apply
 * it, and then check it by looking for the solver's vertices among the crease
 * ends. It could not describe a rotated pattern at all, and when the check
 * failed it said so in terms of the user's edits.
 *
 * It no longer guesses. `exact_solve_input_from_fold` rebuilds the input from
 * the document's own creases and hands back the similarity it used, so
 * {@link solvedRegionSegments} inverts a known transform. Rotation included.
 *
 * ## Placement is by index, not by proximity
 *
 * The FOLD those vertices are numbered in came from these very creases, and the
 * kernel's exporter does not split them: `FoldGraph::from_segments` interns
 * endpoints into a vertex table and emits **one edge per segment, in order**.
 * So owned segment `i` is FOLD edge `i`, its two ends are that edge's two vertex
 * ids, and a moved vertex is placed by *id*.
 *
 * That is worth more than it sounds. The old matching had to find each vertex
 * within a tolerance of a crease end, which meant a tolerance to tune, close
 * vertex pairs that could claim each other's displacement, and a majority vote
 * to decide whether the whole thing was trustworthy. None of those exist here —
 * an id either has a solved position or it does not.
 *
 * ## What counts as the answer
 *
 * `vertices_exact`, not the movement report. The report is filtered by comparing
 * the solver's own start and end points, and the solver finishes some vertices
 * *after* that comparison is taken: a collinear degree-2 vertex is dissolved for
 * the solve and placed back on the straightened crease afterwards. Placing from
 * the report left every one of those at its old, off-line coordinate while both
 * neighbours moved — and a degree-2 vertex is Kawasaki-clean only when it is
 * exactly collinear, so each came back as an angle violation on a pattern that
 * had just been called foldable. Measured: 4 such vertices on `mid-solve_5`, 21
 * on `mid-solve`, and on both files *every* silently-unplaced vertex was one.
 *
 * So the caller passes positions **by vertex id** and this module does not care
 * which report they came from. A solve supplies all of them; a timed-out solve's
 * partial answer supplies only what it managed.
 */
import {
  cpSolveFramePoint,
  type CpExactSolveMovedVertex,
  type CpSolveFrameTransform,
} from '../../engine/cpExactSolveTypes';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { boxContainsModelPoint } from '../annotations/annotationTransform';
import type { CpSuppressionRegion } from '../annotations/suppressionRegion';

/** The creases inside a region, with the 1-based ids the kernel replaces by. */
export interface CpRegionPatternLines {
  /** Kernel line ids — **1-based indices**, ascending. */
  lineIds: number[];
  /** The same creases, in the same order, verbatim. */
  segments: OristudioCpLineSegment[];
}

const NO_LINES: CpRegionPatternLines = { lineIds: [], segments: [] };

/**
 * The creases a region's solve owns: those lying **wholly** inside its box.
 *
 * Wholly, not partly, for the same reason suppression is positional: the region
 * is placed around one pattern's paper with a margin, so a crease with one end
 * outside it belongs to something else — the user's own work, which detection
 * adds beside and must never edit.
 *
 * Auxiliary lines are deliberately not consulted. They are not creases, the
 * solver has no model for them, and `replaceLineSegments` addresses the crease
 * array alone.
 */
export function cpRegionPatternLines(
  segments: readonly OristudioCpLineSegment[] | null | undefined,
  region: CpSuppressionRegion
): CpRegionPatternLines {
  if (!segments || segments.length === 0) return NO_LINES;
  const lineIds: number[] = [];
  const owned: OristudioCpLineSegment[] = [];
  segments.forEach((segment, index) => {
    if (!boxContainsModelPoint(region, segment.a)) return;
    if (!boxContainsModelPoint(region, segment.b)) return;
    // Kernel line ids are 1-based indices into this array — the same convention
    // `line_ids` payloads and `toolReplacedLineIds` use.
    lineIds.push(index + 1);
    owned.push(segment);
  });
  return { lineIds, segments: owned };
}

/**
 * Why a solved answer could not be placed. Each one is a statement about the
 * document, not about the solver — the solve itself succeeded in either case.
 *
 * Two, where there used to be four. `paper_not_square` and `frame_unrecognized`
 * were both consequences of guessing the frame from a bounding box; the
 * transform now comes from the compiler along with the input, and the paper
 * shapes it cannot handle are refused earlier, in the rebuild, with the
 * compiler's own words about the geometry.
 */
export type CpRegionSolvePlacementRefusal =
  /** The region holds no creases, so there is nothing the solve could own. */
  | 'no_pattern'
  /**
   * The solved graph does not describe these creases: it has a different number
   * of edges than the region has segments.
   *
   * Not reachable through the UI as things stand — the FOLD was built from these
   * segments and the kernel emits one edge per segment — so this is the
   * assertion that says so out loud rather than placing coordinates on creases
   * they were not computed for. It would start firing the day the exporter
   * learns to split crossings.
   */
  | 'graph_mismatch';

export type CpRegionSolvePlacement =
  | {
      ok: true;
      /** The owned creases with their moved ends rewritten; everything else verbatim. */
      segments: OristudioCpLineSegment[];
      /** How many crease *ends* were rewritten — a placement statistic, not the solver's. */
      rewrittenEndpoints: number;
    }
  | { ok: false; refusal: CpRegionSolvePlacementRefusal };

/**
 * Solved positions by vertex id, in the solver's unit square.
 *
 * A map rather than an array because the two things that produce one are not the
 * same shape: an accepted solve gives a complete `vertices_exact` indexed by id,
 * and a timed-out solve gives only the vertices it managed to place. An id that
 * is absent keeps its document coordinate.
 */
export type CpSolvedVertexPositions = ReadonlyMap<number, { x: number; y: number }>;

/** Every vertex of an accepted solve, which is the whole answer. */
export function solvedVertexPositions(
  verticesExact: readonly { x: number; y: number }[]
): CpSolvedVertexPositions {
  return new Map(verticesExact.map((point, id) => [id, point]));
}

/** What a timed-out solve managed to place — the only channel it has. */
export function partialVertexPositions(
  moved: readonly CpExactSolveMovedVertex[]
): CpSolvedVertexPositions {
  return new Map(moved.map((vertex) => [vertex.vertex_id, vertex.after]));
}

/**
 * Place a solved answer onto the region's creases.
 *
 * Endpoints move; nothing else does. The solver changes coordinates only — the
 * topology it was given is the topology it returns — so each owned crease keeps
 * its id, its colour, its mountain/valley, its fold angle and its selection
 * state, and only the two points change. Rebuilding the creases from the solved
 * FOLD instead would round-trip all of that through a format that does not carry
 * most of it.
 *
 * `edgesVertices` is the FOLD the input was rebuilt from, which is what makes a
 * moved vertex addressable: `edgesVertices[i]` names the two vertex ids at the
 * ends of owned segment `i`.
 */
export function solvedRegionSegments(
  owned: readonly OristudioCpLineSegment[],
  positions: CpSolvedVertexPositions,
  edgesVertices: readonly (readonly [number, number])[],
  transform: CpSolveFrameTransform
): CpRegionSolvePlacement {
  if (owned.length === 0) return { ok: false, refusal: 'no_pattern' };
  if (edgesVertices.length !== owned.length) return { ok: false, refusal: 'graph_mismatch' };
  // A solve that placed nothing is a success with nothing to write. Returning
  // the creases untouched keeps the caller's single code path rather than making
  // it special-case a result it would then write unchanged.
  if (positions.size === 0) return { ok: true, segments: [...owned], rewrittenEndpoints: 0 };

  // A vertex that did not move still resolves to the coordinate it already has,
  // so `rewrittenEndpoints` counts *ends given a solved position*, not ends whose
  // value changed. It is a placement statistic; the movement figures the UI
  // reports come from the solver.
  let rewrittenEndpoints = 0;
  const segments = owned.map((segment, index) => {
    const [from, to] = edgesVertices[index];
    const solvedA = positions.get(from);
    const solvedB = positions.get(to);
    if (!solvedA && !solvedB) return segment;
    rewrittenEndpoints += (solvedA ? 1 : 0) + (solvedB ? 1 : 0);
    return {
      ...segment,
      a: solvedA ? cpSolveFramePoint(transform, solvedA) : segment.a,
      b: solvedB ? cpSolveFramePoint(transform, solvedB) : segment.b,
    };
  });
  return { ok: true, segments, rewrittenEndpoints };
}

/**
 * The `edges_vertices` of a FOLD produced by `exportOristudioCpCreasesAsFold`.
 *
 * Read defensively — it crossed a JSON boundary — and returns null rather than
 * throwing, so a caller can refuse with a sentence instead of an exception.
 */
export function foldEdgesVertices(foldJson: string): (readonly [number, number])[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(foldJson);
  } catch {
    return null;
  }
  const edges = (parsed as { edges_vertices?: unknown } | null)?.edges_vertices;
  if (!Array.isArray(edges)) return null;
  const out: (readonly [number, number])[] = [];
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length < 2) return null;
    const [a, b] = edge;
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    out.push([a as number, b as number]);
  }
  return out;
}


