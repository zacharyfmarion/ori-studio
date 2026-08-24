/**
 * The pure geometry of a multi-touch camera gesture: what a set of contacts
 * moving from one arrangement to the next does to a 2D view.
 *
 * Deliberately separate from the arbitration that decides *whether* a set of
 * contacts is a camera gesture at all (`cpTouchArbiter.ts`) and from the canvas
 * that applies the result, so the arithmetic can be checked without a DOM, a
 * camera, or a WebGL context.
 *
 * Everything here is in client (CSS) pixels. Scaling into the camera's device
 * pixels is the caller's job, because only the caller knows the device ratio.
 */

/** A contact position, in client (CSS) pixels. */
export interface GesturePoint {
  x: number;
  y: number;
}

/**
 * What the contacts did between two samples: how far their centroid travelled,
 * and how much their spread grew.
 *
 * `scale` carries no sensitivity constant, on purpose. It is the literal ratio
 * of finger spread, which is the physically correct mapping and the one a
 * tablet user's hands already know — unlike the wheel, which needs
 * `WHEEL_ZOOM_SENSITIVITY` only because a scroll delta is not a distance. There
 * is no number here to tune wrong.
 */
export interface PinchTransform {
  dx: number;
  dy: number;
  scale: number;
}

/** The transform that changes nothing — a fresh or degenerate sample. */
export const IDENTITY_PINCH: PinchTransform = { dx: 0, dy: 0, scale: 1 };

/**
 * Below this spread (client px) the contacts are effectively coincident, and
 * the ratio between two such measurements is noise rather than intent — so the
 * sample carries translation only.
 *
 * Two fingers cannot physically get this close: the guard is for synthetic and
 * degenerate input, not for a gesture anybody performs. That is why it can be
 * set here rather than on hardware.
 */
const MIN_SPREAD_PX = 4;

/** Mean position of the contacts, or null for an empty set. */
export function contactCentroid(points: readonly GesturePoint[]): GesturePoint | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Mean distance from the centroid — the "size" of the contact set.
 *
 * For two contacts this is exactly half the gap between them, so a ratio of two
 * spreads is a ratio of two finger gaps, which is what a pinch means.
 * Generalising through the mean rather than special-casing two contacts is what
 * lets a third finger join a pinch in progress without a discontinuity.
 */
export function contactSpread(
  points: readonly GesturePoint[],
  centroid: GesturePoint
): number {
  if (points.length === 0) return 0;
  let total = 0;
  for (const point of points) {
    total += Math.hypot(point.x - centroid.x, point.y - centroid.y);
  }
  return total / points.length;
}

/**
 * The transform carrying `prev` onto `next`, for the *same* contacts in the
 * same order.
 *
 * Differenced frame to frame rather than measured against a reference taken at
 * gesture start, because a pinch delivers one `pointermove` per finger: each
 * event moves one contact and leaves the others where they were. Against a
 * fixed reference, every sample would replay the other finger's stale offset;
 * frame-to-frame differencing makes each partial update a valid sample of a
 * staggered pair, and the wobble that remains is second-order.
 *
 * **Rotation is not computed, and that is a decision rather than an omission.**
 * A twist is derivable from these same contacts, and the CP camera fully
 * supports `rotation` — wiring it would be roughly one line. But fingers
 * essentially never pinch without a few degrees of twist, and a crease pattern
 * knocked three degrees off square makes every later visual judgement subtly
 * wrong with no cue that it happened. Making it safe needs an unlock threshold
 * (rotation stays locked until accumulated twist passes some angle, then
 * applies twist-minus-threshold) whose constant is only settleable on real
 * hardware, and this change should not ship an unmeasured constant in the very
 * gesture that exists to stop the canvas doing surprising things. Absent beats
 * wrong-by-default; rotation is still reachable from the toolbar, which is
 * tappable.
 *
 * The seam for that follow-up is the data, not a dead field: callers pass the
 * whole contact set, from which twist is derivable, so adding it later is
 * purely additive. `pinchTransform.test.ts` pins a pure twist to the identity
 * so the choice reads as deliberate.
 */
export function pinchTransform(
  prev: readonly GesturePoint[],
  next: readonly GesturePoint[]
): PinchTransform {
  if (prev.length === 0 || prev.length !== next.length) return IDENTITY_PINCH;
  const from = contactCentroid(prev);
  const to = contactCentroid(next);
  if (!from || !to) return IDENTITY_PINCH;
  const fromSpread = contactSpread(prev, from);
  const toSpread = contactSpread(next, to);
  return {
    dx: to.x - from.x,
    dy: to.y - from.y,
    // A single contact has zero spread by construction, so this is also what
    // makes "one finger of a pinch lifted" degrade into a plain pan.
    scale: fromSpread >= MIN_SPREAD_PX && toSpread > 0 ? toSpread / fromSpread : 1,
  };
}
