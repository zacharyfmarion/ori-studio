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
 * - **Which region is it?** {@link resolveMovedRegion}: the one in its old
 *   place, unchanged or edited there; else a region of the same outline shape
 *   whose creases are unchanged, wherever it is; else none.
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
 * The rounding of a relative coordinate, as a fraction of the lines' size:
 * about a millionth, the order of the kernel's own point tolerance on a sheet
 * of ordinary size, and a million times a drag's last-bit error.
 *
 * A power of two, not 1e-6. A pattern's coordinates are dyadic fractions of
 * its size — a grid of 2^n divisions, a reference at 1/128 — and a decimal
 * step puts the odd multiples of 1/128 exactly on a rounding boundary
 * (1e6 / 128 = 7812.5), where a drag's last-bit noise picks the side: on a
 * 128-division grid a quarter of all drags changed the fingerprint. With
 * 2^-20 every dyadic fraction down to 1/2^20 lands on a step's centre, and the
 * scaling by it is exact in floating point.
 */
const RELATIVE_QUANTUM = 2 ** -20;

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
 * - `in-place`: its rim is where it was, and its creases may have changed.
 */
export type RegionFound = 'unchanged' | 'in-place';

/**
 * The region a reference names, wherever it is now, or null:
 *
 * 1. the region still at its old position — unchanged, or edited there. Its
 *    own place wins over an identical copy elsewhere: a sheet edited beside an
 *    untouched duplicate of it is out of date, not silently the duplicate;
 * 2. else a region of the same outline shape whose creases are unchanged,
 *    wherever it is — of several identical ones, the nearest to where it was
 *    (they draw the same picture);
 * 3. else none. A region that moved *and* changed cannot be told from a
 *    deleted one beside another of its shape, so it is not guessed at: a link
 *    that silently re-points at another pattern is the failure this exists
 *    to prevent (`resolveRegion`). Relink picks it again.
 *
 * Only a relative fingerprint can take part in 2; an absolute one (`cs1:`)
 * finds its region only in place.
 */
export function resolveMovedRegion(
  reference: Pick<RegionReference, 'boundary' | 'segmentIdHint'>,
  segments: readonly CpSegment[],
  identity: RegionIdentity
): { segment: CpSegment; found: RegionFound } | null {
  const { boundary } = reference;
  if (boundary.length === 0) return null;
  const inPlace = resolveRegion(reference, segments);
  if (inPlace) {
    const unchanged = isRelativeFingerprint(identity.fingerprint) && identity.fingerprintOf(inPlace) === identity.fingerprint;
    return { segment: inPlace, found: unchanged ? 'unchanged' : 'in-place' };
  }
  if (!isRelativeFingerprint(identity.fingerprint)) return null;
  const same = segments.filter(
    (segment) => boundariesMatchMoved(boundary, segment.boundary) && identity.fingerprintOf(segment) === identity.fingerprint
  );
  if (same.length === 0) return null;
  const nearest = same.reduce((best, segment) =>
    boundaryDistance(boundary, segment.boundary) < boundaryDistance(boundary, best.boundary) ? segment : best
  );
  return { segment: nearest, found: 'unchanged' };
}
