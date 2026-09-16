/**
 * Turns one ReferenceFinder solution into the folds it describes.
 *
 * The core's JSON gives the construction as a sequence of `steps` (labels only —
 * no geometry) and a list of `diagrams` (geometry only — no labels). The new
 * crease of each line step exists only as a drawn element in its diagram, so
 * recovering it means walking both lists in step, with these rules, each checked
 * against the C++ (`class/refBase.cpp` `BuildDiagrams` / `DrawDiagram`,
 * `class/refLine/refLine.cpp` `DrawSelf`) and against captured output in
 * `__fixtures__/`:
 *
 * - `diagrams[]` has one entry per **line** step (`axiom > 0`, an "action line"),
 *   in step order. Marks (`axiom 0`) get no diagram of their own, so the diagram
 *   index advances only on line steps.
 * - Extra trailing diagrams are ignored: a **mark** query ends with one standalone
 *   diagram for the final mark; a mark made only of originals (the centre) has
 *   two (the `(0, 0)` placeholder and the final-mark diagram); an original line
 *   (an edge or a diagonal) has one action-free diagram.
 * - `steps.length === 0` with `err` 0 means the target **is** an original: an
 *   edge or corner is free, a diagonal is a rank-1 reference the folder still has
 *   to make, so it is reported in `freeDiagonals` and charged one fold.
 * - A solution whose only steps are marks names originals in `l0` / `l1` — the
 *   centre is `sw_ne ∩ nw_se` and costs both diagonals.
 * - **Every** mark step is kept. Consecutive marks are ordinary (two intersections
 *   feeding one O1/O2 fold); upstream's `bridge.ts` drops one and its diagrams
 *   go out of step.
 * - The new crease of a line step is the diagram's single `type 1` element with
 *   style `valley` (3), or `pinch` (7) when `step.pinch` is set. The pinch
 *   element is drawn deliberately short (a tenth of the sheet around the mark it
 *   makes), so it is extended to the full chord of the sheet. Exactly one such
 *   element per line diagram is asserted.
 * - The last line's chord must reproduce the `solution` line within
 *   {@link EXTRACT_TOLERANCE}, and an exact solution's must also reproduce the
 *   query target. Either failing is a typed error, not a nearby answer.
 */
import { EXACT_ERROR } from './protocol';
import {
  LINE_STYLE,
  isRawLineSolution,
  type Diagram,
  type DiagramLineElement,
  type FreeDiagonal,
  type RawSolution,
  type RawStep,
  type RfLine,
  type RfPoint,
} from './solution';

/** One epsilon for positions in sheet units; the planner's `tol` (plan "Tolerance policy"). */
export const EXTRACT_TOLERANCE = 1e-6;

/** The rectangle the database was built for; ReferenceFinder coordinates live in it. */
export interface Sheet {
  width: number;
  height: number;
}

export const UNIT_SHEET: Sheet = { width: 1, height: 1 };

export type ReferenceFinderQuery =
  | { kind: 'point'; point: RfPoint }
  | { kind: 'line'; a: RfPoint; b: RfPoint };

/** A crease as the full chord of the sheet it crosses. */
export interface SheetSegment {
  a: RfPoint;
  b: RfPoint;
}

export interface ExtractedStep {
  /** 0 for a mark (intersection of two lines), 1–7 for the fold that makes a line. */
  axiom: number;
  /** Labels of the references the step uses, in the core's `p0, p1, l0, l1` order. */
  inputs: string[];
  /** The new reference's own label. */
  label: string;
  /** The line is only used to make one mark; ReferenceFinder draws it as a pinch. */
  pinch: boolean;
  /** Line steps: the new crease extended to the sheet. */
  line?: SheetSegment;
  /** Mark steps: where the two input lines cross. */
  point?: RfPoint;
  /** Line steps: which `diagrams[]` entry draws this step. Marks have none. */
  diagramIndex: number | null;
  /** O3 only: where the chosen bisector meets the sheet edge (tells the two bisectors apart). */
  bisectorHint?: RfPoint;
  /** O5–O7: the core's folding-order hint, e.g. `p0,l0,l1,p1`. */
  order?: string;
}

export type ExtractedTarget =
  | { kind: 'line'; line: SheetSegment }
  | { kind: 'point'; point: RfPoint };

export interface ExtractedSolution {
  /** `err <= 1e-9`: the construction lands on the target, not near it. */
  exact: boolean;
  err: number;
  rank: number;
  /** Line steps plus one per free diagonal the construction uses. */
  foldCount: number;
  steps: ExtractedStep[];
  /** The rank-1 diagonals the construction relies on; never listed as steps by the core. */
  freeDiagonals: FreeDiagonal[];
  /** What the construction actually produces (the `solution` field, as sheet geometry). */
  target: ExtractedTarget;
}

export type ReferenceFinderExtractErrorReason =
  | 'malformed_solution'
  | 'missing_diagram'
  | 'action_element_count'
  | 'pinch_style_mismatch'
  | 'unknown_reference'
  | 'degenerate_geometry'
  | 'unexpected_original'
  | 'target_mismatch';

/** A solution the extractor refuses rather than guesses at. */
export class ReferenceFinderExtractError extends Error {
  readonly code = 'reference_finder_extract';

  constructor(
    readonly reason: ReferenceFinderExtractErrorReason,
    message: string
  ) {
    super(message);
    this.name = 'ReferenceFinderExtractError';
  }
}

const FREE_DIAGONALS: readonly FreeDiagonal[] = ['sw_ne', 'nw_se'];

function isFreeDiagonal(name: string): name is FreeDiagonal {
  return (FREE_DIAGONALS as readonly string[]).includes(name);
}

/** The sheet's own lines, by ReferenceFinder's names (`ReferenceFinder.cpp` MakeAllMarksAndLines). */
function originalLines(sheet: Sheet): Map<string, SheetSegment> {
  const { width: w, height: h } = sheet;
  return new Map<string, SheetSegment>([
    ['s', { a: [0, 0], b: [w, 0] }],
    ['n', { a: [0, h], b: [w, h] }],
    ['w', { a: [0, 0], b: [0, h] }],
    ['e', { a: [w, 0], b: [w, h] }],
    ['sw_ne', { a: [0, 0], b: [w, h] }],
    ['nw_se', { a: [0, h], b: [w, 0] }],
  ]);
}

function originalMarks(sheet: Sheet): Map<string, RfPoint> {
  const { width: w, height: h } = sheet;
  return new Map<string, RfPoint>([
    ['sw', [0, 0]],
    ['se', [w, 0]],
    ['nw', [0, h]],
    ['ne', [w, h]],
  ]);
}

/**
 * Extract the folds of `solution`, an answer to `query` on `sheet`.
 *
 * Throws {@link ReferenceFinderExtractError} when the wire shape does not match
 * the rules above; never returns a partially decoded construction.
 */
export function extractSolution(
  solution: RawSolution,
  query: ReferenceFinderQuery,
  sheet: Sheet = UNIT_SHEET
): ExtractedSolution {
  const isLine = isRawLineSolution(solution);
  if (isLine !== (query.kind === 'line')) {
    throw new ReferenceFinderExtractError(
      'malformed_solution',
      `a ${query.kind} query received a ${isLine ? 'line' : 'point'} solution`
    );
  }
  if (!Array.isArray(solution.steps) || !Array.isArray(solution.diagrams)) {
    throw new ReferenceFinderExtractError('malformed_solution', 'steps and diagrams must be arrays');
  }

  const lines = originalLines(sheet);
  const marks = originalMarks(sheet);
  const freeDiagonals = new Set<FreeDiagonal>();
  const steps: ExtractedStep[] = [];
  let diagramIndex = 0;

  const lookupLine = (label: unknown, stepIndex: number): SheetSegment => {
    if (typeof label !== 'string') {
      throw new ReferenceFinderExtractError(
        'malformed_solution',
        `step ${stepIndex} names a line input that is not a label`
      );
    }
    const line = lines.get(label);
    if (!line) {
      throw new ReferenceFinderExtractError(
        'unknown_reference',
        `step ${stepIndex} uses line "${label}" before any step made it`
      );
    }
    if (isFreeDiagonal(label)) freeDiagonals.add(label);
    return line;
  };

  solution.steps.forEach((step, stepIndex) => {
    const label = typeof step.x === 'string' ? step.x : '';
    if (step.axiom === 0) {
      const l0 = lookupLine(step.l0, stepIndex);
      const l1 = lookupLine(step.l1, stepIndex);
      const point = intersectSegments(l0, l1);
      if (!point) {
        throw new ReferenceFinderExtractError(
          'degenerate_geometry',
          `step ${stepIndex}: mark "${label}" is the intersection of parallel lines`
        );
      }
      if (label) marks.set(label, point);
      steps.push({
        axiom: 0,
        inputs: labelInputs(step),
        label,
        pinch: false,
        point,
        diagramIndex: null,
      });
      return;
    }
    if (!Number.isInteger(step.axiom) || step.axiom < 1 || step.axiom > 7) {
      throw new ReferenceFinderExtractError(
        'malformed_solution',
        `step ${stepIndex} has axiom ${String(step.axiom)}`
      );
    }
    // Inputs are only recorded, not resolved, but a line input must exist:
    // a name the sequence never introduced means the diagrams cannot be trusted.
    for (const key of ['l0', 'l1'] as const) {
      if (step[key] !== undefined) lookupLine(step[key], stepIndex);
    }
    const diagram = solution.diagrams[diagramIndex];
    if (!diagram) {
      throw new ReferenceFinderExtractError(
        'missing_diagram',
        `step ${stepIndex} (line "${label}") has no diagram: ${solution.diagrams.length} diagrams for ${diagramIndex + 1} line steps`
      );
    }
    const pinch = step.pinch !== undefined && step.pinch !== 0;
    const element = actionElement(diagram, diagramIndex, pinch);
    const line = extendToSheet(element.from, element.to, sheet);
    if (!line) {
      throw new ReferenceFinderExtractError(
        'degenerate_geometry',
        `diagram ${diagramIndex}: the new crease is a point or misses the sheet`
      );
    }
    if (label) lines.set(label, line);
    const extracted: ExtractedStep = {
      axiom: step.axiom,
      inputs: labelInputs(step),
      label,
      pinch,
      line,
      diagramIndex,
    };
    if (Array.isArray(step.p0)) extracted.bisectorHint = step.p0;
    if (typeof step.order === 'string') extracted.order = step.order;
    steps.push(extracted);
    diagramIndex += 1;
  });

  const lineStepCount = diagramIndex;
  const target = isLine
    ? resolveLineTarget(solution.solution, steps, sheet, freeDiagonals)
    : resolvePointTarget(solution.solution, steps, sheet);

  const exact = solution.err <= EXACT_ERROR;
  if (exact) assertMatchesQuery(target, query);

  return {
    exact,
    err: solution.err,
    rank: solution.rank,
    foldCount: lineStepCount + freeDiagonals.size,
    steps,
    freeDiagonals: FREE_DIAGONALS.filter((name) => freeDiagonals.has(name)),
    target,
  };
}

function labelInputs(step: RawStep): string[] {
  const inputs: string[] = [];
  for (const key of ['p0', 'p1', 'l0', 'l1'] as const) {
    const value = step[key];
    if (typeof value === 'string') inputs.push(value);
  }
  return inputs;
}

/** The one valley or pinch line element of a line step's diagram. */
function actionElement(diagram: Diagram, index: number, pinch: boolean): DiagramLineElement {
  const candidates = diagram.filter(
    (element): element is DiagramLineElement =>
      element.type === 1 &&
      (element.style === LINE_STYLE.valley || element.style === LINE_STYLE.pinch)
  );
  if (candidates.length !== 1) {
    throw new ReferenceFinderExtractError(
      'action_element_count',
      `diagram ${index} has ${candidates.length} valley/pinch elements, expected exactly 1`
    );
  }
  const [element] = candidates;
  if ((element.style === LINE_STYLE.pinch) !== pinch) {
    throw new ReferenceFinderExtractError(
      'pinch_style_mismatch',
      `diagram ${index} draws style ${element.style} but the step ${pinch ? 'is' : 'is not'} a pinch`
    );
  }
  return element;
}

function resolveLineTarget(
  solutionLine: RfLine,
  steps: ExtractedStep[],
  sheet: Sheet,
  freeDiagonals: Set<FreeDiagonal>
): ExtractedTarget {
  const last = steps[steps.length - 1];
  if (!last) {
    // The target is one of the sheet's own lines.
    for (const [name, segment] of originalLines(sheet)) {
      if (segmentOnLine(segment, solutionLine)) {
        if (isFreeDiagonal(name)) freeDiagonals.add(name);
        return { kind: 'line', line: segment };
      }
    }
    throw new ReferenceFinderExtractError(
      'unexpected_original',
      `a line solution with no steps is not an edge or diagonal of the sheet: ${JSON.stringify(solutionLine)}`
    );
  }
  if (last.axiom === 0 || !last.line) {
    throw new ReferenceFinderExtractError(
      'malformed_solution',
      'a line solution must end with a line step'
    );
  }
  if (!segmentOnLine(last.line, solutionLine)) {
    throw new ReferenceFinderExtractError(
      'target_mismatch',
      `the final crease ${JSON.stringify(last.line)} is not the solution line ${JSON.stringify(solutionLine)}`
    );
  }
  return { kind: 'line', line: last.line };
}

function resolvePointTarget(
  solutionPoint: RfPoint,
  steps: ExtractedStep[],
  sheet: Sheet
): ExtractedTarget {
  const last = steps[steps.length - 1];
  if (!last) {
    for (const corner of originalMarks(sheet).values()) {
      if (distance(corner, solutionPoint) <= EXTRACT_TOLERANCE) {
        return { kind: 'point', point: corner };
      }
    }
    throw new ReferenceFinderExtractError(
      'unexpected_original',
      `a point solution with no steps is not a corner of the sheet: ${JSON.stringify(solutionPoint)}`
    );
  }
  if (last.axiom !== 0 || !last.point) {
    throw new ReferenceFinderExtractError(
      'malformed_solution',
      'a point solution must end with a mark step'
    );
  }
  if (distance(last.point, solutionPoint) > EXTRACT_TOLERANCE) {
    throw new ReferenceFinderExtractError(
      'target_mismatch',
      `the final mark ${JSON.stringify(last.point)} is not the solution point ${JSON.stringify(solutionPoint)}`
    );
  }
  return { kind: 'point', point: last.point };
}

function assertMatchesQuery(target: ExtractedTarget, query: ReferenceFinderQuery): void {
  if (target.kind === 'line' && query.kind === 'line') {
    const off = Math.max(
      pointToLineDistance(query.a, target.line),
      pointToLineDistance(query.b, target.line)
    );
    if (off > EXTRACT_TOLERANCE) {
      throw new ReferenceFinderExtractError(
        'target_mismatch',
        `an exact solution's crease misses the queried line by ${off}`
      );
    }
    return;
  }
  if (target.kind === 'point' && query.kind === 'point') {
    const off = distance(query.point, target.point);
    if (off > EXTRACT_TOLERANCE) {
      throw new ReferenceFinderExtractError(
        'target_mismatch',
        `an exact solution's mark misses the queried point by ${off}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry. Small enough to live here; the planner's Rust does the real work.

function distance(p: RfPoint, q: RfPoint): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

/** Both endpoints of `segment` satisfy `p · u = d` within tolerance. */
function segmentOnLine(segment: SheetSegment, [d, u]: RfLine): boolean {
  const residual = (p: RfPoint) => Math.abs(p[0] * u[0] + p[1] * u[1] - d);
  return residual(segment.a) <= EXTRACT_TOLERANCE && residual(segment.b) <= EXTRACT_TOLERANCE;
}

function pointToLineDistance(p: RfPoint, line: SheetSegment): number {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return distance(p, line.a);
  return Math.abs(dx * (p[1] - line.a[1]) - dy * (p[0] - line.a[0])) / length;
}

/** Where the infinite lines through two segments cross, or null when parallel. */
export function intersectSegments(l0: SheetSegment, l1: SheetSegment): RfPoint | null {
  const d0x = l0.b[0] - l0.a[0];
  const d0y = l0.b[1] - l0.a[1];
  const d1x = l1.b[0] - l1.a[0];
  const d1y = l1.b[1] - l1.a[1];
  const denominator = d0x * d1y - d0y * d1x;
  const scale = Math.hypot(d0x, d0y) * Math.hypot(d1x, d1y);
  if (scale === 0 || Math.abs(denominator) <= 1e-12 * scale) return null;
  const t = ((l1.a[0] - l0.a[0]) * d1y - (l1.a[1] - l0.a[1]) * d1x) / denominator;
  return [l0.a[0] + t * d0x, l0.a[1] + t * d0y];
}

/**
 * The chord of `sheet` on the infinite line through `from` and `to`, or null
 * when the two points coincide or the line misses the sheet. Endpoints are
 * clamped onto the sheet so the core's `-2.8e-17` overshoots do not leak out.
 */
export function extendToSheet(from: RfPoint, to: RfPoint, sheet: Sheet): SheetSegment | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return null;
  let tMin = -Infinity;
  let tMax = Infinity;
  const slab = (origin: number, direction: number, extent: number): boolean => {
    if (Math.abs(direction) <= 1e-12 * length) {
      return origin >= -EXTRACT_TOLERANCE && origin <= extent + EXTRACT_TOLERANCE;
    }
    const t0 = (0 - origin) / direction;
    const t1 = (extent - origin) / direction;
    tMin = Math.max(tMin, Math.min(t0, t1));
    tMax = Math.min(tMax, Math.max(t0, t1));
    return true;
  };
  if (!slab(from[0], dx, sheet.width) || !slab(from[1], dy, sheet.height)) return null;
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return null;
  if (tMax - tMin < -EXTRACT_TOLERANCE / length) return null;
  const at = (t: number): RfPoint => [
    clamp(from[0] + t * dx, 0, sheet.width),
    clamp(from[1] + t * dy, 0, sheet.height),
  ];
  const a = at(tMin);
  const b = at(tMax);
  if (distance(a, b) <= EXTRACT_TOLERANCE) return null;
  return { a, b };
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
