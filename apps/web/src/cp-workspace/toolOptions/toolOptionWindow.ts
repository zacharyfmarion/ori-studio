/**
 * What a tool offers when it has found several answers and cannot point at them.
 *
 * # Why this is not just "the fold-angle stepper, moved"
 *
 * `CreasePatternCommandPayload.candidate_index` is already how a UI tells any
 * operation which of several answers to commit, and several tools take one —
 * `VertexMakeAngularlyFlatFoldable`, `ParallelDrawWidth`, `Axiom5`/`Axiom7`,
 * `CircleDrawTangentLine`. They currently choose in three different ways, and
 * the split that matters is not which tool it is but **whether the candidates
 * are distinguishable on the canvas**:
 *
 * - §4's completion rays point in different directions, so clicking the one you
 *   want is more direct than reading a list. Those keep their click.
 * - The three-angle solve's branches occupy the *same three creases* and differ
 *   only in their angles. There is nothing to click at, so the answers have to
 *   be listed.
 *
 * This window is for the second kind. It is deliberately not a general floating
 * panel system: one window, at one anchor, for the active tool.
 *
 * # It holds nothing
 *
 * A descriptor and callbacks. The tool owns the state — which is what makes a
 * second tool adopting this a matter of writing its own descriptor rather than
 * touching anything here, and the honest test of whether the generalisation was
 * real.
 */
import type { Point } from '../../lib/geometry';

/** One thing the chosen option would change. */
export interface CpToolOptionRow {
  /** Stable across steps, so React keeps the row rather than remounting it. */
  id: string;
  /**
   * Leading swatch colour, resolved. Optional because "what colour is this"
   * only means something for some kinds of thing.
   */
  color?: string | null;
  label: string;
  /** What it is now, when showing the change is clearer than showing the result. */
  before?: string | null;
  /** What the chosen option would make it. */
  after: string;
  /** False when this row is untouched by the chosen option, so it can recede. */
  changed?: boolean;
}

export interface CpToolOptionWindow {
  /**
   * Where the window points, in crease-pattern model space — the vertex being
   * solved, the crease being offered alternatives for.
   */
  anchor: Point;
  title: string;
  /** 0-based; `count` of 0 means there is nothing to step through. */
  index: number;
  count: number;
  rows: readonly CpToolOptionRow[];
  /**
   * A sentence about the chosen option that the rows cannot carry — "this is one
   * of infinitely many", "this is what the vertex already does".
   */
  note?: string | null;
  onStep: (delta: number) => void;
  onApply: () => void;
  onCancel: () => void;
}
