/**
 * Where to draw fold-angle readouts, and at what fidelity.
 *
 * The lightness ramp turned out to be too quiet on a 1px stroke to carry the
 * signal on its own, so the midpoint badge is the primary way a non-flat crease
 * announces itself. It degrades by available room rather than switching off:
 *
 * - enough crease on screen  -> the number (`-90°`), which is the actual readout
 * - a little                 -> a dot, which still says "this one is not flat"
 * - almost none              -> nothing, because a dot every few pixels is noise
 *
 * One concept at two densities: the dot is the number's low-zoom form, not a
 * separate feature.
 *
 * Classic creases never get a badge, so a classic pattern is untouched.
 *
 * `degrees` is carried through as an opaque payload: every decision here —
 * whether a badge fits, whether it degrades to a dot, which badges survive the
 * cap — is made on **screen length** alone. That is what makes the signed angle
 * safe to pass in, and there is a test that says so.
 */
import type { Point } from '../../lib/geometry';

/** Screen-space length a crease needs before its number fits legibly. */
export const NUMBER_MIN_SCREEN_LENGTH = 34;
/** Below this, even a dot is more noise than signal. */
export const DOT_MIN_SCREEN_LENGTH = 9;
/**
 * Most badges to emit. A dense CP has tens of thousands of creases; past a few
 * hundred DOM nodes the layer costs more than it tells you. Longest creases win,
 * because they are the ones with room to read.
 */
export const MAX_BADGES = 300;

export interface FoldAngleBadge {
  /** 1-based line id, stable across renders. */
  lineId: number;
  /** Screen-space midpoint of the crease. */
  at: Point;
  /** Signed ρ in degrees — negative is a mountain, positive a valley. */
  degrees: number;
  /** `number` draws the readout; `dot` only flags that it is non-flat. */
  detail: 'number' | 'dot';
}

export interface FoldAngleBadgeInput {
  lineId: number;
  /** Screen-space endpoints. */
  a: Point;
  b: Point;
  degrees: number;
}

function screenLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Pick badges for the non-classic creases already projected to screen space.
 *
 * Input is expected to be pre-filtered to non-classic creases; this decides
 * placement and fidelity only.
 */
export function planFoldAngleBadges(creases: readonly FoldAngleBadgeInput[]): FoldAngleBadge[] {
  const scored: { badge: FoldAngleBadge; length: number }[] = [];

  for (const crease of creases) {
    const length = screenLength(crease.a, crease.b);
    if (length < DOT_MIN_SCREEN_LENGTH) continue;
    scored.push({
      length,
      badge: {
        lineId: crease.lineId,
        at: { x: (crease.a.x + crease.b.x) / 2, y: (crease.a.y + crease.b.y) / 2 },
        degrees: crease.degrees,
        detail: length >= NUMBER_MIN_SCREEN_LENGTH ? 'number' : 'dot',
      },
    });
  }

  if (scored.length > MAX_BADGES) {
    // Longest first, so what survives the cap is what was readable anyway.
    scored.sort((left, right) => right.length - left.length);
    scored.length = MAX_BADGES;
  }
  // Stable order regardless of whether the cap kicked in, so React keys and
  // snapshot comparisons do not churn.
  scored.sort((left, right) => left.badge.lineId - right.badge.lineId);
  return scored.map((entry) => entry.badge);
}

/** How many creases the cap dropped, for a "showing N of M" affordance. */
export function badgeOverflowCount(creaseCount: number, badges: readonly FoldAngleBadge[]): number {
  return Math.max(0, creaseCount - badges.length);
}
