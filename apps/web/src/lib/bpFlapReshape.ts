import type { OristudioBpFlap, OristudioBpSheet } from '../engine/oristudioBpTypes';
import { bpPackingCanResizeFlap } from './bpPackingViewport';
import type { Point } from './geometry';

/**
 * Solving a flap's footprint from a resize-handle drag.
 *
 * A flap draws as the rounded rectangle its box makes when grown by its radius
 * on every side — Box Pleating Studio's `Flap.$drawCircle`, ported in
 * `bpPackingFlapClearanceRect`:
 *
 * ```
 * [x - r, x + w + r] × [y - r, y + h + r]     W = w + 2r    H = h + 2r
 * ```
 *
 * So three numbers govern one drawn box, and a handle drag says where its edges
 * should land without saying which of the three should move. This module answers
 * that with one rule, on every handle:
 *
 * ```
 * r′ = clamp(floor(min(W′, H′) / 2), rMin, rMax)   w′ = W′ − 2r′   h′ = H′ − 2r′
 * ```
 *
 * **The drag sets the outer box; the radius is then the largest that box will
 * hold.** A flap is always the roundest thing that fits its bounds — a square box
 * of even side is a plain circle, `6 × 6` giving `r3` rather than `r2` around a
 * `2 × 2` base, and `5 × 5` giving `r2` with a `1 × 1` base rather than `r1` with
 * a `3 × 3` one. The radius is the only one of the three that means anything in
 * the folded model (it is the flap's length, and its leaf edge's), so it takes
 * everything it can and `w`/`h` are the leftovers. The `W`/`H` fields in the pill
 * are there for the cases where that is not what you want.
 *
 * Because the answer depends on the outer box and nothing else, **how the box was
 * reached cannot matter**: two perpendicular edge drags land on exactly the flap
 * one corner drag would have produced. That is the property that made this rule
 * apply to every handle rather than to corners alone.
 *
 * ## The trade this makes, deliberately
 *
 * The *box* is not continuous under it. `h = H − 2r`, so a radius stepping by one
 * steps the perpendicular box by two, and an edge drag moves the radius whenever
 * the axis it drags is the smaller one — so one cell of horizontal drag can
 * restructure the flap vertically. That is not a defect to be tuned away; it is
 * the exact price of "always maximal", and the two cannot both hold. The radius
 * itself *is* continuous, and the outer box tracks the pointer exactly.
 *
 * ## Three facts that shape it
 *
 * **A resize moves the flap.** The anchor is the *lower-left corner of the box*,
 * not a centre, so a bigger radius walks it outward even on an axis the handle is
 * not dragging. That is why the result carries an anchor, and why the kernel
 * takes the whole footprint in one call.
 *
 * **Integrality.** `create_junction` derives the device overlap from flap AABBs
 * and tree distances, and BP's gadget generation hard-errors on a fractional
 * one — taking the whole graphics snapshot with it, not just that gadget. Every
 * number here is an integer in and an integer out.
 *
 * **Parity.** `W = w + 2r`, so a box of odd side cannot be a circle; the `floor`
 * leaves that one cell in `w` or `h`, and it is the only reason `min(w, h)` is
 * ever anything but zero.
 */

export type BpFlapResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, in draw order around the box. */
export const BP_FLAP_RESIZE_HANDLES: readonly BpFlapResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

/**
 * Which outer edges a handle drives, in **grid** space (y up, as the sheet is
 * measured) rather than screen space. `0` means that axis is pinned on both
 * sides. Same shape as the CP overlay's `HANDLE_SIGNS`, which does the same job
 * for annotation boxes.
 */
export const BP_FLAP_HANDLE_SIGNS: Record<
  BpFlapResizeHandle,
  { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }
> = {
  n: { sx: 0, sy: 1 },
  ne: { sx: 1, sy: 1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: -1 },
  s: { sx: 0, sy: -1 },
  sw: { sx: -1, sy: -1 },
  w: { sx: -1, sy: 0 },
  nw: { sx: -1, sy: 1 },
};

/** A flap's footprint: everything a reshape writes. */
export interface BpFlapFootprint {
  anchor: Point;
  width: number;
  height: number;
  radius: number;
}

/** What a flap's radius may become. `null` when the flap has no leaf edge to set. */
export interface BpFlapRadiusRange {
  min: number;
  max: number;
}

/**
 * The axis a flap is pinned to the middle of, when it is its own mirror.
 *
 * A flap sitting on the mirror line has to stay centred on it: it *is* its own
 * partner, so an edge that moved on one side alone would leave it asymmetric and
 * the design no longer mirror-symmetric. `x` pins the horizontal centre (a
 * vertical mirror), `y` the vertical one.
 */
export interface BpFlapCentreConstraint {
  axis: 'x' | 'y';
  /** Where the mirror line is, in grid coordinates. */
  at: number;
}

export interface SolveBpFlapReshapeInput {
  /** The flap as it was when the gesture began, never mid-gesture. */
  flap: OristudioBpFlap;
  handle: BpFlapResizeHandle;
  /** Pointer position in grid coordinates. */
  pointer: Point;
  radiusRange: BpFlapRadiusRange | null;
  sheet: OristudioBpSheet;
  /** Set when the flap is its own mirror. Null for every ordinary flap. */
  centre?: BpFlapCentreConstraint | null;
  /**
   * A last veto on a candidate footprint, clamped like the sheet rule rather
   * than refused. Opaque on purpose: the only caller uses it to keep a paired
   * flap out of its own reflection, and this module has no business knowing what
   * a mirror is.
   */
  accepts?: (footprint: BpFlapFootprint) => boolean;
}

interface OuterDelta {
  x: number;
  y: number;
}

/**
 * A flap's drawn extent in grid coordinates: the box grown by the radius.
 *
 * Shared with the chrome, which draws its handles on this box rather than on the
 * `width × height` rectangle — the grown box is what a flap looks like, and for
 * the ordinary flap (`w = h = 0`) the rectangle is a point.
 */
export function bpFlapOuterBox(
  flap: Pick<OristudioBpFlap, 'anchor' | 'width' | 'height' | 'radius'>
): { x: number; y: number; width: number; height: number } {
  return {
    x: flap.anchor.x - flap.radius,
    y: flap.anchor.y - flap.radius,
    width: flap.width + flap.radius * 2,
    height: flap.height + flap.radius * 2,
  };
}

/**
 * Where a handle sits on a flap's drawn extent, in grid coordinates: on the
 * corner it names, or the middle of the edge it drives.
 */
export function bpFlapHandlePoint(
  flap: Pick<OristudioBpFlap, 'anchor' | 'width' | 'height' | 'radius'>,
  handle: BpFlapResizeHandle
): Point {
  const box = bpFlapOuterBox(flap);
  const { sx, sy } = BP_FLAP_HANDLE_SIGNS[handle];
  const along = (sign: -1 | 0 | 1, low: number, span: number): number =>
    sign === -1 ? low : sign === 1 ? low + span : low + span / 2;
  return {
    x: along(sx, box.x, box.width),
    y: along(sy, box.y, box.height),
  };
}

/**
 * The footprint a handle drag asks for, or `null` when it asks for nothing this
 * flap can be.
 *
 * A request the sheet refuses is **clamped, not rejected**: the delta walks back
 * toward zero until the sheet accepts it, so a flap dragged past the paper's edge
 * stops there instead of freezing the gesture. Box Pleating Studio's own resize
 * setters early-return in silence for the same situation, so nothing is
 * announced.
 */
export function solveBpFlapReshape(input: SolveBpFlapReshapeInput): BpFlapFootprint | null {
  const { flap, handle, pointer, radiusRange, sheet, centre = null, accepts } = input;
  const signs = BP_FLAP_HANDLE_SIGNS[handle];
  const requested = requestedOuterDelta(flap, signs, pointer, centre);

  for (const candidate of shrinkingDeltas(requested, centre, signs)) {
    const footprint = footprintFor(flap, signs, candidate, radiusRange, centre);
    if (!footprint) continue;
    if (!bpPackingCanResizeFlap(footprint.anchor, footprint.width, footprint.height, sheet)) {
      continue;
    }
    if (accepts && !accepts(footprint)) continue;
    return sameFootprint(flap, footprint) ? null : footprint;
  }
  return null;
}

/**
 * How far the dragged edge wants to move, as a change in the **outer** width and
 * height — so a west handle dragged left and an east handle dragged right both
 * report a positive `x`.
 *
 * Rounded, because the delta is the only place a non-integer can enter: a flap
 * with no leaf edge falls back to a radius of `max(w, h) / 2`, which can be a
 * half, and its outer edges with it.
 */
function requestedOuterDelta(
  flap: OristudioBpFlap,
  signs: { sx: -1 | 0 | 1; sy: -1 | 0 | 1 },
  pointer: Point,
  centre: BpFlapCentreConstraint | null
): OuterDelta {
  const outer = bpFlapOuterBox(flap);
  const along = (
    sign: -1 | 0 | 1,
    low: number,
    span: number,
    at: number,
    pinned: number | null
  ): number => {
    if (sign === 0) return 0;
    // Pinned to the mirror: the opposite edge cannot stay put, so the box grows
    // from the line in both directions and the pointer sets the half-extent.
    // The extent therefore changes by an even number, which is exactly what
    // keeps the recentred anchor on the integer lattice.
    //
    // Signed, and floored at zero. Taking `|at - pinned|` cannot tell a pointer
    // five cells short of the line from one five cells past it, so dragging a
    // handle *inward* through the centre reversed direction and grew the flap
    // without bound. Past the line the request is simply the floor.
    if (pinned !== null) return 2 * Math.max(0, Math.round(sign * (at - pinned))) - span;
    if (sign === 1) return Math.round(at - (low + span));
    return Math.round(low - at);
  };
  return {
    x: along(signs.sx, outer.x, outer.width, pointer.x, centre?.axis === 'x' ? centre.at : null),
    y: along(signs.sy, outer.y, outer.height, pointer.y, centre?.axis === 'y' ? centre.at : null),
  };
}

/**
 * The footprint for one outer-box delta, or `null` when the flap cannot be it.
 *
 * **A corner drag resizes the flap; an edge drag extends it.** Those are
 * different verbs and they move different numbers:
 *
 * ```
 * corner:  r′ = clamp(floor(min(W′, H′) / 2))   w′ = W′ − 2r′   h′ = H′ − 2r′
 * edge:    r′ = r                               w′ = W′ − 2r    h′ = H′ − 2r
 * ```
 *
 * A corner makes the flap as round as its new bounds allow, so dragging one out
 * to a `6 × 6` box gives a plain `r3` circle rather than `r2` around a `2 × 2`
 * base. An edge leaves the radius alone and puts the whole change into the box on
 * the axis it drags, so pulling the east edge simply makes the flap longer that
 * way and pushing it back in stops at the circle.
 *
 * ## Why they cannot both maximise the radius
 *
 * Making every state "biggest circle plus leftovers" and making an edge drag
 * behave are **mutually exclusive**, and the proof is one line. Under
 * `r = floor(min(W,H)/2)`, an edge drag changes one extent; when that extent is
 * the smaller one the radius follows it, and since `h = H − 2r` a radius that
 * steps by one steps the *perpendicular* box by two. So one cell of horizontal
 * drag restructures the flap vertically — measured, before this: a `0 × 0 r2`
 * flap pulled one cell in from the east came back as `r1` with a `1 × 2` box,
 * halving the flap's length in the folded model.
 *
 * A corner has no such problem: both extents move together, so the minimum moves
 * with them and every number changes by at most one per cell.
 *
 * The cost is that two perpendicular edge drags can leave a flap whose radius is
 * not maximal, and the next corner drag will snap it. That is a deliberate,
 * one-off restructure of a shape the user built deliberately — and it is the
 * lesser of the two, because it happens on the gesture that means "resize this
 * flap" rather than on the one that means "make it a bit longer".
 */
function footprintFor(
  flap: OristudioBpFlap,
  signs: { sx: -1 | 0 | 1; sy: -1 | 0 | 1 },
  delta: OuterDelta,
  radiusRange: BpFlapRadiusRange | null,
  centre: BpFlapCentreConstraint | null
): BpFlapFootprint | null {
  // A gesture that asks for the box the flap already has asks for nothing. Said
  // here rather than left to fall out of the arithmetic, so that merely pressing
  // a handle cannot rewrite a flap that was never dragged.
  if (delta.x === 0 && delta.y === 0) return null;

  // `outerWidth`/`outerHeight` are the DRAWN extent the pointer asked for;
  // `box` is the flap's own rectangle inside it. Naming both `width` invites the
  // one substitution that would be silently wrong everywhere.
  const outer = bpFlapOuterBox(flap);
  const outerWidth = outer.width + delta.x;
  const outerHeight = outer.height + delta.y;
  const radius = radiusFor(flap, outerWidth, outerHeight, radiusRange);
  const box = { width: outerWidth - 2 * radius, height: outerHeight - 2 * radius };
  // An edge drag pushed in past the flap's own circle, or a box below the 2x2
  // floor a radius of 1 needs. Either way the caller walks the delta back.
  if (box.width < 0 || box.height < 0) return null;

  // The pinned edge is the one the handle is not dragging, so the new outer box
  // hangs off it; the anchor is then that edge plus the radius.
  const origin = (
    sign: -1 | 0 | 1,
    low: number,
    was: number,
    now: number,
    pinned: number | null
  ): number => {
    if (pinned !== null) return pinned - now / 2;
    return sign === -1 ? low + was - now : low;
  };
  const footprint = {
    anchor: {
      x:
        origin(signs.sx, outer.x, outer.width, outerWidth, centre?.axis === 'x' ? centre.at : null) +
        radius,
      y:
        origin(
          signs.sy,
          outer.y,
          outer.height,
          outerHeight,
          centre?.axis === 'y' ? centre.at : null
        ) + radius,
    },
    ...box,
    radius,
  };
  // A flap that arrived off the integer lattice must not be nudged further along
  // it. Refusing is the safe answer: a fractional flap coordinate fails device
  // generation for the entire design, not just this flap.
  return isIntegralFootprint(footprint) ? footprint : null;
}

/**
 * The radius the new bounds should have: **always the largest that fits**, on
 * every handle.
 *
 * The one exception is a flap with no leaf edge to set — there is no tree edge to
 * write a radius to, so it keeps the one it has and the box takes everything.
 */
function radiusFor(
  flap: OristudioBpFlap,
  outerWidth: number,
  outerHeight: number,
  radiusRange: BpFlapRadiusRange | null
): number {
  if (!radiusRange) return flap.radius;
  // `min` wins a contradictory range. Clamping the other way round would hand
  // back a radius below the engine's floor of 1, which it rejects — and a
  // rejected mid-drag step is a stuck gesture rather than a visible error.
  const largest = Math.floor(Math.min(outerWidth, outerHeight) / 2);
  return Math.max(Math.min(largest, radiusRange.max), radiusRange.min);
}

/**
 * The requested delta first, then every smaller one in order of how much of the
 * request it gives up.
 *
 * The obvious walk — decrement the larger axis, repeat — enumerates a *staircase*
 * from the request to the origin rather than the rectangle beneath it, so an axis
 * that is blocked drags a perfectly feasible one down with it and never comes
 * back. Measured on the staircase: a corner drag of `(+5, +1)` on a flap resting
 * against the paper's top edge returned nothing at all, while `(+5, 0)` — a
 * strictly smaller request — landed exactly. The whole corner went dead the
 * moment the pointer rose one cell.
 *
 * Sweeping by total shortfall instead means the first candidate the sheet accepts
 * is the closest one to what the pointer asked for, on both axes at once. It is
 * lazy, so an unobstructed drag — nearly all of them — still costs one candidate.
 *
 * A pinned axis moves in twos (its extent grows from the mirror both ways), so
 * walking it one at a time would offer half-steps the flap cannot take and land
 * its recentred anchor off the lattice.
 */
function* shrinkingDeltas(
  delta: OuterDelta,
  centre: BpFlapCentreConstraint | null,
  signs: { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }
): Generator<OuterDelta> {
  const stepX = centre?.axis === 'x' && signs.sx !== 0 ? 2 : 1;
  const stepY = centre?.axis === 'y' && signs.sy !== 0 ? 2 : 1;
  const reachX = Math.floor(Math.abs(delta.x) / stepX);
  const reachY = Math.floor(Math.abs(delta.y) / stepY);
  const signX = Math.sign(delta.x);
  const signY = Math.sign(delta.y);
  for (let shortfall = 0; shortfall <= reachX + reachY; shortfall++) {
    for (let backX = Math.max(0, shortfall - reachY); backX <= Math.min(shortfall, reachX); backX++) {
      const backY = shortfall - backX;
      yield {
        x: delta.x - signX * backX * stepX,
        y: delta.y - signY * backY * stepY,
      };
    }
  }
}

function isIntegralFootprint(footprint: BpFlapFootprint): boolean {
  return [
    footprint.anchor.x,
    footprint.anchor.y,
    footprint.width,
    footprint.height,
    footprint.radius,
  ].every((value) => Number.isInteger(value));
}

/** The footprint a flap already has, for restoring one a gesture moved. */
export function bpFlapFootprint(flap: OristudioBpFlap): BpFlapFootprint {
  return {
    anchor: flap.anchor,
    width: flap.width,
    height: flap.height,
    radius: flap.radius,
  };
}

export function sameBpFlapFootprint(a: BpFlapFootprint, b: BpFlapFootprint): boolean {
  return (
    a.anchor.x === b.anchor.x &&
    a.anchor.y === b.anchor.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.radius === b.radius
  );
}

function sameFootprint(flap: OristudioBpFlap, footprint: BpFlapFootprint): boolean {
  return sameBpFlapFootprint(bpFlapFootprint(flap), footprint);
}
