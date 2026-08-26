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
 *   be stepped through.
 *
 * This window is for the second kind.
 *
 * # It frames the geometry rather than describing it
 *
 * The first version listed the affected creases inside the window, with their
 * before and after angles. That was redundant twice over: the creases are
 * already drawn in the colour the answer would give them, and
 * {@link CpFoldAngleLayer} already badges each with its angle. A list beside
 * them said the same thing again, in words, while covering the canvas.
 *
 * So the window is a **transparent frame around the region being changed**, with
 * its controls on the top edge. The content is the drawing itself.
 *
 * # It holds nothing
 *
 * A descriptor and callbacks. The tool owns the state — which is what makes a
 * second tool adopting this a matter of writing its own descriptor rather than
 * touching anything here, and the honest test of whether the generalisation was
 * real.
 */
import type { Point } from '../../lib/geometry';

/** An axis-aligned region of crease-pattern model space. */
export interface CpToolOptionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CpToolOptionWindow {
  /**
   * The region the choice is about, in model space — the three creases being
   * solved, the crease being offered alternatives. The window frames it, so this
   * is what the user sees change as they step.
   */
  bounds: CpToolOptionBounds;
  /**
   * What the header calls this window, shown only when there is no stepper.
   *
   * **Optional, because a title is not always worth its width.** A tool whose
   * window frames the change and states its finding in `note` can say
   * everything it has to say without one; propagation does exactly that. When
   * it is absent the header shrink-wraps to Apply/Cancel rather than stretching
   * a mostly-empty bar across the frame.
   */
  title?: string;
  /** 0-based; `count` of 0 means there is nothing to step through. */
  index: number;
  count: number;
  /**
   * A sentence about the chosen option that the drawing cannot carry — "this is
   * one of infinitely many", "this is what the vertex already does".
   */
  note?: string | null;
  onStep: (delta: number) => void;
  onApply: () => void;
  onCancel: () => void;
}

/** The region enclosing every one of `points`, or null when there are none. */
export function boundsOfPoints(points: readonly Point[]): CpToolOptionBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
