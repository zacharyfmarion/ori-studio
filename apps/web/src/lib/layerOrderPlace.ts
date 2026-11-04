import type { TFunction } from 'i18next';

/**
 * Where a flat fold stands among its layer orders, as the Diagram's Step pane
 * and Edit's Properties pane both show it between ‹ and ›.
 *
 * The orders are Oriedita's enumeration, which only counts forward. Going
 * back to an earlier one restarts it — the kernel replays it forward to the
 * one asked for (`folding_estimate_to_case`) — and the replay forgets every
 * order past the one it lands on. The search's *frontier* does not: it is how
 * many orders the search has reached on this fold, and whether it ran out
 * there, kept beside the fold by whoever holds it (a Diagram capture session,
 * an Edit figure), so "2 of 5+" never shrinks to "1 of 1+" on a step back.
 */

/** How many layer orders the search has reached, and whether it ran out there. */
export interface SolutionFrontier {
  cases: number;
  complete: boolean;
}

/** A fold the search has not reached into yet. */
export const UNSEARCHED_FRONTIER: SolutionFrontier = { cases: 0, complete: false };

/** What the kernel reports of a fold as it stands. */
export interface ReportedSolutions {
  /** The orders it has found so far — since its last restart. */
  discovered: number;
  /** Whether a search for another may find one. */
  hasNext: boolean;
}

/**
 * The frontier after the kernel reports a fold's state. It only grows, or
 * closes: the kernel learns it ran out only from a search that failed, and a
 * replay to the last order says "maybe more" again.
 */
export function advanceSolutionFrontier(
  frontier: SolutionFrontier,
  reported: ReportedSolutions
): SolutionFrontier {
  if (reported.discovered > frontier.cases) {
    return { cases: reported.discovered, complete: !reported.hasNext };
  }
  if (reported.discovered === frontier.cases && !reported.hasNext && !frontier.complete) {
    return { cases: frontier.cases, complete: true };
  }
  return frontier;
}

/**
 * The frontier with `known` orders known to exist already — the one a step
 * leaves, say — which a fold opened fresh cannot know.
 */
export function solutionFrontierKnowing(frontier: SolutionFrontier, known: number): SolutionFrontier {
  return known > frontier.cases ? { cases: known, complete: false } : frontier;
}

/** A flat fold's layer orders as the search knows them, for the readout. */
export interface LayerOrderSolutions {
  /** How many are found, this one or later. */
  discovered: number;
  /** Whether the search may find more than `discovered`. */
  hasNext: boolean;
  /** It has none: its layers could not be put in order, and it shows see-through. */
  none?: boolean;
}

/** What a frontier says for the readout: at least one found, more while it has not run out. */
export function frontierSolutions(frontier: SolutionFrontier): Omit<LayerOrderSolutions, 'none'> {
  return { discovered: Math.max(1, frontier.cases), hasNext: !frontier.complete };
}

/**
 * Where a constrained figure's or step's order stands among the solutions
 * that fit its record (layer order H6, H9), as its solutions cursor last
 * answered: "2 of 3" once the count is final, and "Solution 2" until then,
 * as on one too large to count (D7). Before the count is final the index
 * counts the solutions found so far, not their rank (E9), so "2 of 3+" would
 * misplace it. The host never counts at rest (D11), so a pager reads this
 * only once a press has asked.
 */
export function solutionPlaceCount(
  place: { position: { index: number; total: { n: number; exact: boolean } }; counted: boolean },
  t: TFunction
): string {
  const { index, total } = place.position;
  if (!place.counted || !total.exact) {
    return t('panels:cpProperties.folded.layerOrderSolution', 'Solution {{number}}', { number: index });
  }
  return layerOrderCount(index, { discovered: total.n, hasNext: false }, t);
}

/**
 * Where order `number` stands, between ‹ and ›: "2 of 5" when the search has
 * found them all, "2 of 5+" while it may find more, the number alone before it
 * has looked (`solutions` null), "None" for a fold whose layers could not be
 * ordered.
 */
export function layerOrderCount(
  number: number,
  solutions: LayerOrderSolutions | null,
  t: TFunction
): string {
  if (solutions?.none) return t('panels:diagram.pose.layerOrderNone', 'None');
  if (!solutions) return String(number);
  const total = Math.max(solutions.discovered, number);
  return solutions.hasNext
    ? t('panels:diagram.pose.layerOrderOfMore', '{{number}} of {{total}}+', { number, total })
    : t('panels:diagram.pose.layerOrderOf', '{{number}} of {{total}}', { number, total });
}
