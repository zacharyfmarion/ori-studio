/**
 * ReferenceFinder's wire types: what the core prints, one JSON line per solution.
 *
 * Mirrors the C++ serialisers in `third_party/reference-finder/src/core/class/` —
 * `PutDistanceAndRank` (solution / err / rank), each `Serialize()` (one step per
 * reference in the construction sequence) and `JsonStreamDgmr` (the diagram
 * primitives). Nothing here is interpreted; `extractor.ts` turns a `RawSolution`
 * into the shape the app uses.
 */

/** A point as ReferenceFinder prints it: `[x, y]`, bottom-left origin, y up. */
export type RfPoint = [number, number];

/**
 * A line as ReferenceFinder prints it: `[d, [ux, uy]]` for the line
 * `{ p : p · u = d }`, with `u` a unit normal (`XYLine::operator<<`).
 */
export type RfLine = [number, RfPoint];

/**
 * Line styles from `RefDgmr::LineStyle`. `mountain` is declared upstream but
 * never emitted. A line step's new crease is the `valley` element, or the
 * `pinch` element when the step is a pinch.
 */
export const LINE_STYLE = {
  crease: 0,
  edge: 1,
  highlight: 2,
  valley: 3,
  mountain: 4,
  arrow: 5,
  dotted: 6,
  pinch: 7,
} as const;
export type LineStyle = (typeof LINE_STYLE)[keyof typeof LINE_STYLE];

/** Point styles from `RefDgmr::PointStyle`. */
export const POINT_STYLE = { normal: 0, highlight: 1, action: 2 } as const;
export type PointStyle = (typeof POINT_STYLE)[keyof typeof POINT_STYLE];

/** Label styles from `RefDgmr::LabelStyle`; the same three values as points. */
export const LABEL_STYLE = { normal: 0, highlight: 1, action: 2 } as const;
export type LabelStyle = (typeof LABEL_STYLE)[keyof typeof LABEL_STYLE];

export interface DiagramPointElement {
  type: 0;
  pt: RfPoint;
  style: PointStyle;
}

export interface DiagramLineElement {
  type: 1;
  from: RfPoint;
  to: RfPoint;
  style: LineStyle;
}

export interface DiagramArcElement {
  type: 2;
  center: RfPoint;
  radius: number;
  /** Angles in radians. */
  from: number;
  to: number;
  ccw: boolean;
  style: LineStyle;
}

/** The sheet outline. Always the first element of every diagram. */
export interface DiagramSheetElement {
  type: 3;
  width: number;
  height: number;
}

export interface DiagramLabelElement {
  type: 4;
  pt: RfPoint;
  text: string;
  style: LabelStyle;
}

export type DiagramElement =
  | DiagramPointElement
  | DiagramLineElement
  | DiagramArcElement
  | DiagramSheetElement
  | DiagramLabelElement;

/** One diagram: the elements drawn for one action line, in drawing order. */
export type Diagram = DiagramElement[];

/**
 * The names ReferenceFinder gives the sheet's own references. Edges and corners
 * are rank 0 and free; the two diagonals are rank-1 originals that never appear
 * as steps although a folder has to make them.
 */
export type OriginalLineName = 's' | 'w' | 'e' | 'n' | FreeDiagonal;
export type OriginalMarkName = 'sw' | 'se' | 'nw' | 'ne';
export type FreeDiagonal = 'sw_ne' | 'nw_se';

/**
 * One reference in the construction sequence. `axiom` 0 is a mark (the
 * intersection of `l0` and `l1`); 1–7 are the Huzita–Justin folds making a line.
 * Inputs are labels: an original's name, or a letter (`A`–`J` for lines, `P`–`Z`
 * for marks) assigned in sequence order. `x` is the new reference's own label.
 *
 * Two fields are not labels: O3 emits `p0` as a *point* (`[x, y]` where the
 * chosen bisector meets the sheet edge, to tell the two bisectors apart), and
 * O5/O6/O7 emit `order`, the folding-order hint for the sentence.
 */
export interface RawStep {
  axiom: number;
  p0?: string | RfPoint;
  p1?: string;
  l0?: string;
  l1?: string;
  x?: string;
  /** Present (as `1`) when the line is only used to make one mark. */
  pinch?: number;
  order?: string;
}

export interface RawSolutionBase {
  err: number;
  rank: number;
  steps: RawStep[];
  /** One diagram per line step (axiom > 0), plus the trailing extras `extractor.ts` describes. */
  diagrams: Diagram[];
}

export interface RawPointSolution extends RawSolutionBase {
  solution: RfPoint;
}

export interface RawLineSolution extends RawSolutionBase {
  solution: RfLine;
}

export type RawSolution = RawPointSolution | RawLineSolution;

export function isRawLineSolution(solution: RawSolution): solution is RawLineSolution {
  return Array.isArray(solution.solution[1]);
}

export function isRawPointSolution(solution: RawSolution): solution is RawPointSolution {
  return !isRawLineSolution(solution);
}
