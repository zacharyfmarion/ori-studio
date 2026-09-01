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
 * ## The frame, and why it is verified rather than trusted
 *
 * The attached `ExactSolveInput` lives in the **unit square**: every candidate
 * generator in the detect pipeline hardcodes
 * `BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts` and
 * `corner_points` pins the literal unit square, so CP detection is square-only
 * end to end (`implementation-plans/crease-topology-repair.md`). The document
 * holds that same candidate wherever `import_add` placed it — a shift and a
 * uniform scale, no rotation and no flip, which is also why the modal can
 * register the rectified image over the paper with a plain scale about a shared
 * centre and call the registration exact.
 *
 * So there is exactly **one** hypothesis about the mapping, and
 * {@link solvedRegionSegments} states it, applies it, and then **checks it
 * against the actual endpoints**: every vertex the solver moved must be sitting
 * on a crease end where the hypothesis says it is. If the check fails — the
 * pattern was rotated, the paper boundary was broken, the attachment belongs to
 * some other pattern — it **refuses** and says which, rather than writing
 * coordinates derived from a frame it could not confirm.
 *
 * ## The seam this stands in for
 *
 * The right long-term shape is the compiler's own adapter:
 * `fold_exactize::fold_to_exact_solve_input` detects the paper polygon by turn
 * angle, derives the similarity onto the unit square, and maps the answer back
 * "into the *input's* coordinate frame". That is one function and it already
 * exists — but it is **private, with no wasm export**, so the browser cannot
 * rebuild an `ExactSolveInput` from current document geometry at all. Until it
 * is exposed, a solve runs on the *attachment* and this module places the
 * answer. When it lands, this module goes away and the refusals below become
 * cases the Rust already handles (rotation included).
 */
import type { CpExactSolveMovedVertex } from '../../engine/cpExactSolveTypes';
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
 * document, not about the solver — the solve itself succeeded in every case.
 */
export type CpRegionSolvePlacementRefusal =
  /** The region holds no creases, so there is nothing the solve could own. */
  | 'no_pattern'
  /**
   * The owned creases do not span a square. The candidate's paper is a square
   * by construction, so this says the pattern was rotated or its boundary is
   * gone — either way the unit-square hypothesis cannot be applied.
   */
  | 'paper_not_square'
  /**
   * The hypothesis did not check out: too few of the solver's vertices could be
   * found among these creases, at either end of the move. The document has
   * drifted too far from what the attachment describes to place an answer on it.
   */
  | 'frame_unrecognized';

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
 * How square the owned creases must span, as a fraction of the paper edge.
 *
 * Loose because the paper's corners have travelled through a FOLD export, a
 * FOLD import and `import_add`'s shift; tight enough that a rotated pattern
 * (whose axis-aligned bounds grow by up to √2 on one side) cannot pass.
 */
const PAPER_SQUARE_TOLERANCE = 1e-3;

/**
 * How close a mapped vertex must land to a crease end to count as that vertex,
 * as a fraction of the paper edge.
 *
 * The two should agree to float noise, not to a tolerance — this is a match, not
 * a snap. It is a thousandth of the paper rather than an epsilon only because
 * the coordinates crossed two file formats to get here.
 */
const VERTEX_MATCH_TOLERANCE = 1e-3;

/**
 * How many of the solver's moved vertices must be found before the frame counts
 * as confirmed.
 *
 * Not all of them: the whole point of the repair flow is that the user edits the
 * document between the attachment being made and the solve running, so a vertex
 * they moved or deleted is *expected* to be missing. A clear majority says the
 * two are the same pattern; anything less says they are not.
 *
 * "Found" means found at *either* end of the move — see the note at the call
 * site for why the `after` half is what makes a second Solve possible at all.
 */
const FRAME_CONFIRMATION_RATIO = 0.5;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
 */
export function solvedRegionSegments(
  owned: readonly OristudioCpLineSegment[],
  moved: readonly CpExactSolveMovedVertex[]
): CpRegionSolvePlacement {
  if (owned.length === 0) return { ok: false, refusal: 'no_pattern' };
  const paper = segmentBounds(owned);
  const width = paper.maxX - paper.minX;
  const height = paper.maxY - paper.minY;
  const edge = Math.max(width, height);
  if (edge <= 0 || Math.abs(width - height) > PAPER_SQUARE_TOLERANCE * edge) {
    return { ok: false, refusal: 'paper_not_square' };
  }
  // A solve that moved nothing is a success with nothing to place. Returning the
  // creases untouched keeps the caller's single code path rather than making it
  // special-case a result it would then write unchanged.
  if (moved.length === 0) return { ok: true, segments: [...owned], rewrittenEndpoints: 0 };

  const tolerance = edge * VERTEX_MATCH_TOLERANCE;
  const toDocument = (point: { x: number; y: number }) => ({
    x: paper.minX + point.x * edge,
    y: paper.minY + point.y * edge,
  });

  // Confirm the frame against the creases before trusting it with them.
  //
  // A vertex confirms the frame from **either end of its move**, and the second
  // half is not a nicety. Solving is idempotent — the same attachment gives the
  // same answer — so once an answer has been applied, every vertex it moved is
  // sitting at its `after` and there is nothing at its `before` any more.
  // Confirming on `before` alone therefore made a *second* Solve on the same
  // region fail every time, and fail with a sentence blaming the user's edits.
  // Measured on `solution_does_not_line_up.osf`: 8 of 10 moved vertices were at
  // distance 0.0000 from `after` and 0.5–0.9 from `before`, so 1 of 10 confirmed
  // against a threshold of 5. Finding a vertex where the solver *put* it is
  // evidence the frame is right, not evidence against it.
  //
  // Only `before` produces a rewrite target, though: a vertex already at its
  // solved position has nothing to move to, and re-solving an unchanged pattern
  // should write nothing.
  const ends = segmentEndpoints(owned);
  const targets: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  let confirmed = 0;
  for (const vertex of moved) {
    const from = toDocument(vertex.before);
    const to = toDocument(vertex.after);
    const atBefore = hasEndpointNear(ends, from, tolerance);
    if (atBefore || hasEndpointNear(ends, to, tolerance)) confirmed += 1;
    if (atBefore) targets.push({ from, to });
  }
  if (confirmed < Math.ceil(moved.length * FRAME_CONFIRMATION_RATIO)) {
    return { ok: false, refusal: 'frame_unrecognized' };
  }

  let rewrittenEndpoints = 0;
  const segments = owned.map((segment) => {
    const a = movedEndpoint(targets, segment.a, tolerance);
    const b = movedEndpoint(targets, segment.b, tolerance);
    if (!a && !b) return segment;
    rewrittenEndpoints += (a ? 1 : 0) + (b ? 1 : 0);
    return { ...segment, a: a ?? segment.a, b: b ?? segment.b };
  });
  return { ok: true, segments, rewrittenEndpoints };
}

/**
 * The vertex's new position, or null when this end is not one the solver moved.
 *
 * Nearest match rather than first: detected patterns carry genuinely close
 * vertex pairs, and taking the first within tolerance would let one of a pair
 * claim the other's displacement.
 */
function movedEndpoint(
  targets: readonly { from: { x: number; y: number }; to: { x: number; y: number } }[],
  point: { x: number; y: number },
  tolerance: number
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = tolerance;
  for (const target of targets) {
    const distance = Math.hypot(target.from.x - point.x, target.from.y - point.y);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = target.to;
  }
  return best;
}

function hasEndpointNear(
  ends: readonly { x: number; y: number }[],
  point: { x: number; y: number },
  tolerance: number
): boolean {
  return ends.some((end) => Math.hypot(end.x - point.x, end.y - point.y) <= tolerance);
}

function segmentEndpoints(
  segments: readonly OristudioCpLineSegment[]
): { x: number; y: number }[] {
  const ends: { x: number; y: number }[] = [];
  for (const segment of segments) ends.push(segment.a, segment.b);
  return ends;
}

function segmentBounds(segments: readonly OristudioCpLineSegment[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const segment of segments) {
    for (const point of [segment.a, segment.b]) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }
  return { minX, minY, maxX, maxY };
}
