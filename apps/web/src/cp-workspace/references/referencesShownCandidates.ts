/**
 * Which of ReferenceFinder's answers the Find tab lists.
 *
 * The core always returns `count` candidates, sorted by error: the exact
 * construction first when there is one, then the nearest *other* marks or
 * lines in its database. It keeps one reference per position, so for a target
 * it can construct exactly those others are never a second exact route — they
 * are near misses, a rank-6 construction landing a quarter of a thousandth
 * off, and their steps read as nonsense: on the sheet centre the runner-up
 * made a mark 0.00024 from a corner and then folded to it as if it were the
 * corner. Zach: "6 and 7 appear to be establishing a reference point for the
 * corner of the paper, which does not need a reference point... its the
 * corner."
 *
 * The "Include approximate solutions" setting is off by default and promises
 * exact-only answers (plan decision D8; `DEFAULT_REFERENCES_SETTINGS`), so
 * with it off an approximation is listed only when nothing exact exists —
 * the folder still gets the closest construction rather than nothing, and
 * the badge says it is off. With it on, every candidate is listed in the
 * core's own order, which at upstream's `goodEnoughError` puts a close cheap
 * approximation above a dearer exact one.
 */
export function shownCandidates<T extends { exact: boolean }>(
  solutions: readonly T[],
  includeApproximate: boolean
): number[] {
  const all = solutions.map((_, index) => index);
  if (includeApproximate) return all;
  const exact = all.filter((index) => solutions[index].exact);
  return exact.length > 0 ? exact : all;
}
