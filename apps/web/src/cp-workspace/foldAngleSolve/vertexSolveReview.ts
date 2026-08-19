/**
 * The review state for the three-angle vertex solve — pure, so the stepping
 * rules can be tested without a canvas, a kernel or React.
 *
 * # Why this tool holds a state no other CP tool has
 *
 * Every other construction tool commits on its final click. This one usually
 * cannot: closing a vertex by changing three fold angles generally admits *two*
 * answers — the paper's "all mountains" and the same vertex popped inside out —
 * and there is no basis for the software to pick between them. So the tool stays
 * active with the whole set in hand and lets you step through it.
 *
 * The state does not live in the `ToolEngine` reducer, which commits on the
 * final input and has nowhere to park a decision. Widening `ToolInput['kind']`
 * with an `apply` variant would touch every engine's exhaustive switch for one
 * tool's benefit, and would be modelling the wrong thing anyway: stepping and
 * applying are driven by keys and buttons, not by pointers. See
 * implementation-plans/vertex-fold-angle-solver.md.
 *
 * # What the counter is allowed to say
 *
 * "2 of 3" is only honest over a finite set. A triple whose creases do not
 * independently control closure has a *continuous family* of answers rather than
 * a set of them, and the kernel reports that separately (`candidate_is_family`)
 * rather than putting a number on infinity. So:
 *
 * - isolated solutions exist -> step through exactly those, and count them;
 * - none do, but a family member was found -> show it, badged, with no counter;
 * - neither -> the kernel's `unavailable` code says why.
 */
import type { OristudioCpCommandPreview } from '../../engine/oristudioCpTypes';

export interface VertexSolveReview {
  /** The three creases the user nominated, as one-based kernel line ids. */
  readonly lineIds: readonly number[];
  /** Which solution is being previewed. */
  readonly index: number;
  /** How many solutions can be stepped through. `0` when this is a family. */
  readonly count: number;
  /**
   * Whether the shown answer is one arbitrary member of a continuous family
   * rather than a branch in its own right. Applying it is still valid — it
   * closes the vertex — but it is not "the" answer, and calling it one of two
   * would be false.
   */
  readonly isFamily: boolean;
  /**
   * Whether the shown answer is the state the three creases are already in.
   *
   * A vertex that already closes offers its own angles and the vertex popped
   * inside out. Both are real; saying which is which is the difference between
   * "here are two options" and "here is yours, and here is the alternative".
   */
  readonly isCurrent: boolean;
}

export type VertexSolveOutcome =
  /**
   * Exactly one isolated answer, so there is nothing to choose between: apply it
   * on the third pick, the way every other CP tool commits on its final click.
   *
   * Deliberately *not* extended to a lone family member. That is one point on a
   * curve of equally valid answers, and committing it unasked would present an
   * arbitrary choice as a determination.
   */
  | { readonly kind: 'apply' }
  | { readonly kind: 'review'; readonly review: VertexSolveReview }
  | { readonly kind: 'none'; readonly reason: string | null };

/** What to do with a kernel preview of the three picked creases. */
export function outcomeForPreview(
  lineIds: readonly number[],
  preview: OristudioCpCommandPreview | null | undefined,
): VertexSolveOutcome {
  if (!preview) return { kind: 'none', reason: null };
  if (preview.unavailable) return { kind: 'none', reason: preview.unavailable };
  const isFamily = preview.candidate_is_family === true;
  const count = isFamily ? 0 : (preview.candidate_count ?? 0);
  // Neither a branch nor a family member. The kernel says why through
  // `unavailable`, handled above, so reaching here means the preview never ran —
  // a stale response or a document that changed underneath it.
  if (count === 0 && !isFamily) return { kind: 'none', reason: null };
  const isCurrent = preview.candidate_is_current === true;
  // Nothing to apply: this *is* the document. Offering it as a one-click change
  // would be offering a no-op, so it holds for review with the alternatives.
  if (count === 1 && !isCurrent) return { kind: 'apply' };
  return { kind: 'review', review: { lineIds, index: 0, count, isFamily, isCurrent } };
}

/**
 * Move `delta` steps through the solutions, wrapping at both ends.
 *
 * Wrapping rather than clamping because the list is a *ring* of alternatives
 * with no natural first or last — the order is nearest-to-current, which ranks
 * them but does not make either end a boundary. Stepping back from the first
 * answer should reach the furthest one, not sit still.
 */
export function stepReview(review: VertexSolveReview, delta: number): VertexSolveReview {
  if (review.count <= 1) return review;
  const next = (((review.index + delta) % review.count) + review.count) % review.count;
  // `isCurrent` describes the *shown* answer, so stepping invalidates it until
  // the new preview lands. Assuming it carried over would label the wrong one.
  return next === review.index ? review : { ...review, index: next, isCurrent: false };
}

/** Whether the stepper should be shown at all. */
export function isSteppable(review: VertexSolveReview | null): boolean {
  return review != null && review.count > 1;
}
