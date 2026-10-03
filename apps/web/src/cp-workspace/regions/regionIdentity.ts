/**
 * A region of a crease pattern recognised by what it is, not where it sits
 * (implementation-plans/pattern-identity.md): a pattern is its creases
 * relative to its own outline, and a link to it stops matching only when a
 * crease changes. A move is not a change; a rotation or a flip is.
 *
 * Two questions, answered separately:
 *
 * - **Did the creases change?** {@link relativeCreaseFingerprint}: the lines
 *   taken relative to their own lower-left corner and rounded, so a
 *   translation — and the floating-point noise a drag leaves — changes
 *   nothing, while a crease moved relative to the others, a recolour or a new
 *   angle does.
 * - **Which region is it?** {@link resolveMovedRegion}: a region of the same
 *   outline shape whose creases are unchanged, wherever it is; else the one
 *   still in its old place; else the only one of that shape; else none.
 *
 * Shared, with no owner's types: the Diagram uses it today, and Edit's folded
 * figures and the References plan cache can adopt it.
 */
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { Point } from '../../lib/geometry';
import { keyDigest } from '../../lib/keyDigest';
import { outerRing, resolveRegion, ringCorners, ringsMatch, type RegionReference } from './regionReference';

/**
 * Names the algorithm in the value, as `cs1:` (absolute, `foldedSourceFingerprint`)
 * does: a stored value is compared by the rule that made it.
 */
export const RELATIVE_FINGERPRINT_PREFIX = 'rc1:';

/**
 * The rounding of a relative coordinate, as a fraction of the lines' size.
 * The order of the kernel's own point tolerance on a sheet of ordinary size,
 * and a million times a drag's last-bit error, so a move never lands on the
 * other side of a rounding step except by a vanishing chance.
 */
const RELATIVE_QUANTUM = 1e-6;

/** Whether a stored fingerprint is a relative one: the kind a moved region can be recognised by. */
export function isRelativeFingerprint(fingerprint: string | null): fingerprint is string {
  return fingerprint !== null && fingerprint.startsWith(RELATIVE_FINGERPRINT_PREFIX);
}

/**
 * An order-independent fingerprint of a set of lines that a translation of
 * the whole set leaves unchanged.
 *
 * Each endpoint is taken relative to the set's lower-left corner — the least
 * x and the least y over every endpoint — and rounded to a millionth of the
 * set's size; a line's two endpoints are put in one order, so tracing it the
 * other way is not a change. Then what `cs1:` keys besides the position:
 * `active`, the colour, the custom colour and the fold magnitude. Sorted and
 * digested as `cs1:` is, so the order of the lines never matters either.
 *
 * Taken from the lines alone, not from a traced rim: it does not depend on how
 * the segmentation walked the region's border.
 */
export function relativeCreaseFingerprint(lines: readonly OristudioCpLineSegment[]): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { a, b } of lines) {
    minX = Math.min(minX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y);
    maxX = Math.max(maxX, a.x, b.x);
    maxY = Math.max(maxY, a.y, b.y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  const quantum = size > 0 ? size * RELATIVE_QUANTUM : 1;
  // `+ 0` folds a rounded -0 into 0, so the two never spell differently.
  const at = (value: number, origin: number) => Math.round((value - origin) / quantum) + 0;
  const keys = lines.map((line) => {
    const a = `${at(line.a.x, minX)},${at(line.a.y, minY)}`;
    const b = `${at(line.b.x, minX)},${at(line.b.y, minY)}`;
    const [first, second] = a <= b ? [a, b] : [b, a];
    const { customized_color: cc } = line;
    return [
      first,
      second,
      line.active,
      line.color,
      line.customized,
      cc.red,
      cc.green,
      cc.blue,
      line.fold_magnitude ?? '',
    ].join(';');
  });
  return keyDigest(keys.sort(), RELATIVE_FINGERPRINT_PREFIX);
}

/** A ring's corners, taken relative to their lower-left corner: its shape, wherever it is. */
function shapeOf(ring: readonly Point[]): Point[] {
  const corners = ringCorners(ring);
  const { x, y } = lowerLeft(corners);
  return corners.map((point) => ({ x: point.x - x, y: point.y - y }));
}

function lowerLeft(points: readonly Point[]): Point {
  let x = Infinity;
  let y = Infinity;
  for (const point of points) {
    x = Math.min(x, point.x);
    y = Math.min(y, point.y);
  }
  return { x, y };
}

/**
 * Whether two boundaries have outer rings of the same shape, wherever each
 * is: equal once both are moved to their own lower-left corner. A rectangle
 * turned a quarter is another shape; a square turned a quarter is not, and its
 * creases tell it apart instead.
 */
export function boundariesMatchMoved(a: readonly Point[][], b: readonly Point[][]): boolean {
  const outerA = outerRing(a);
  const outerB = outerRing(b);
  if (!outerA || !outerB) return false;
  return ringsMatch(shapeOf(outerA), shapeOf(outerB));
}

/** How far apart two boundaries are: between their outer rings' lower-left corners. */
function boundaryDistance(a: readonly Point[][], b: readonly Point[][]): number {
  const outerA = outerRing(a);
  const outerB = outerRing(b);
  if (!outerA || !outerB) return Infinity;
  const left = lowerLeft(ringCorners(outerA));
  const right = lowerLeft(ringCorners(outerB));
  return Math.hypot(left.x - right.x, left.y - right.y);
}

/** What a link remembers of its region's creases, and how to read a candidate's today. */
export interface RegionIdentity {
  /** The fingerprint kept for the region's creases. Only a relative one can recognise it after a move. */
  fingerprint: string | null;
  /** A region's fingerprint today, taken over the same lines the kept one was; null when it has none. */
  fingerprintOf: (segment: CpSegment) => string | null;
}

/**
 * How a region was found:
 * - `unchanged`: its creases are the ones remembered, wherever it is now;
 * - `in-place`: its rim is where it was, and its creases may have changed;
 * - `only-shape`: it moved and changed, and is the only region of its shape.
 */
export type RegionFound = 'unchanged' | 'in-place' | 'only-shape';

/**
 * The region a reference names, wherever it is now, or null:
 *
 * 1. a region of the same outline shape whose creases are unchanged — of
 *    several identical ones, the nearest to where it was, which is the one in
 *    place when nothing moved;
 * 2. else the region still at its old position (edited in place);
 * 3. else the only region of that shape (moved and edited);
 * 4. else none. It never guesses between regions that differ: a link that
 *    silently re-points at another pattern is the failure this exists to
 *    prevent (`resolveRegion`).
 *
 * Only a relative fingerprint can take part in 1; an absolute one (`cs1:`)
 * goes straight to 2 and 3. Nothing moved, the answer comes from the region
 * in place without looking at any other.
 */
export function resolveMovedRegion(
  reference: Pick<RegionReference, 'boundary' | 'segmentIdHint'>,
  segments: readonly CpSegment[],
  identity: RegionIdentity
): { segment: CpSegment; found: RegionFound } | null {
  const { boundary } = reference;
  if (boundary.length === 0) return null;
  const inPlace = resolveRegion(reference, segments);
  const relative = isRelativeFingerprint(identity.fingerprint);
  if (inPlace && relative && identity.fingerprintOf(inPlace) === identity.fingerprint) {
    return { segment: inPlace, found: 'unchanged' };
  }
  const shaped = segments.filter((segment) => boundariesMatchMoved(boundary, segment.boundary));
  if (relative) {
    const same = shaped.filter((segment) => segment !== inPlace && identity.fingerprintOf(segment) === identity.fingerprint);
    if (same.length > 0) {
      const nearest = same.reduce((best, segment) =>
        boundaryDistance(boundary, segment.boundary) < boundaryDistance(boundary, best.boundary) ? segment : best
      );
      return { segment: nearest, found: 'unchanged' };
    }
  }
  if (inPlace) return { segment: inPlace, found: 'in-place' };
  if (shaped.length === 1) return { segment: shaped[0]!, found: 'only-shape' };
  return null;
}
