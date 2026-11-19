/**
 * What is left of a segment once stretches of it are taken out: References
 * keeps the parts of a fold a step did not crease, and a Diagram picture the
 * parts of a crease no line drawn over it covers.
 *
 * Along the segment as a parameter, 0 at one end and 1 at the other: each
 * covered stretch is an interval, its ends either way round. One reaching
 * past an end is clipped there — a stretch of the same line beyond the
 * segment is not a gap in it, and unclipped it made one from the segment's
 * end out to the stretch (markhor's step 39 drew the blank between two of
 * step 38's runs as if it were creased). The intervals are merged, and the
 * gaps between them from one end to the other are what is left; a gap no
 * longer than `epsilon`, in the same parameter, is rounding.
 *
 * Pure.
 */
export function uncoveredSpans(
  covered: readonly (readonly [number, number])[],
  epsilon: number
): [number, number][] {
  const intervals = covered
    .map(([u, v]) => [Math.max(0, Math.min(u, v)), Math.min(1, Math.max(u, v))] as const)
    .filter(([u, v]) => v > u)
    .sort((left, right) => left[0] - right[0]);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [start, end] of intervals) {
    if (start > cursor + epsilon) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1 - epsilon) gaps.push([cursor, 1]);
  return gaps;
}
