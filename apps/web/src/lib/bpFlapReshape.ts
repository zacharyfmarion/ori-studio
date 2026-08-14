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
 * that: **the drag sets the outer box, and the radius is then made as large as
 * that box allows.**
 *
 * ```
 * r′ = floor(min(W′, H′) / 2)        w′ = W′ − 2r′        h′ = H′ − 2r′
 * ```
 *
 * The radius is the only one of the three that means anything in the folded model
 * — it is the flap's length, and the leaf edge's — so it gets everything it can
 * hold, and `w`/`h` are what is left over. A square box of even side is therefore
 * a pure circle: `6 × 6` gives `r3`, not `r2` around a `2 × 2` base.
 *
 * Two properties follow from the answer depending on nothing but the outer box.
 * The dragged edge lands exactly where the pointer asked, always — this choice of
 * `r′` can never drive `w′` or `h′` negative, so there is never anything to clamp
 * against. And the same box always yields the same flap, so a drag out and back
 * returns to where it started, across separate gestures as well as within one.
 *
 * ## Three facts that shape it
 *
 * **A resize moves the flap.** The anchor is the *lower-left corner of the box*,
 * not a centre, so growing the radius walks it outward even on an axis the handle
 * is not dragging. That is why the result carries an anchor, and why the kernel
 * takes the whole footprint in one call.
 *
 * **Integrality.** `create_junction` derives the device overlap from flap AABBs
 * and tree distances, and BP's gadget generation hard-errors on a fractional
 * one — taking the whole graphics snapshot with it, not just that gadget. Every
 * number here is an integer in and an integer out.
 *
 * **Parity.** `W = w + 2r`, so a box of odd side cannot be a circle; the `floor`
 * leaves that one cell in `w` or `h`. It is the only reason a square box ever
 * keeps a box at all.
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

export interface SolveBpFlapReshapeInput {
  /** The flap as it was when the gesture began, never mid-gesture. */
  flap: OristudioBpFlap;
  handle: BpFlapResizeHandle;
  /** Pointer position in grid coordinates. */
  pointer: Point;
  radiusRange: BpFlapRadiusRange | null;
  sheet: OristudioBpSheet;
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
  const { flap, handle, pointer, radiusRange, sheet } = input;
  const signs = BP_FLAP_HANDLE_SIGNS[handle];
  const requested = requestedOuterDelta(flap, signs, pointer);

  for (const candidate of shrinkingDeltas(requested)) {
    const footprint = footprintFor(flap, signs, candidate, radiusRange);
    if (!footprint) continue;
    if (!bpPackingCanResizeFlap(footprint.anchor, footprint.width, footprint.height, sheet)) {
      continue;
    }
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
  pointer: Point
): OuterDelta {
  const outer = bpFlapOuterBox(flap);
  const along = (
    sign: -1 | 0 | 1,
    low: number,
    high: number,
    at: number
  ): number => {
    if (sign === 1) return Math.round(at - high);
    if (sign === -1) return Math.round(low - at);
    return 0;
  };
  return {
    x: along(signs.sx, outer.x, outer.x + outer.width, pointer.x),
    y: along(signs.sy, outer.y, outer.y + outer.height, pointer.y),
  };
}

/**
 * The footprint for one outer-box delta, or `null` when the flap cannot be it.
 *
 * **The radius is made as large as the box allows**, and whatever is left over
 * becomes the width and height:
 *
 * ```
 * r′ = floor(min(W′, H′) / 2)        w′ = W′ − 2r′        h′ = H′ − 2r′
 * ```
 *
 * That is the whole rule. A square box of even side comes out as a pure circle —
 * `6 × 6` is `r3`, not `r2` with a `2 × 2` box — and every other box comes out as
 * the roundest flap that fills it, with at most one of `w′`, `h′` left over on
 * each axis beyond the parity cell.
 *
 * Two properties fall out of it being a pure function of the outer box, and both
 * were missing from the delta-spending rule this replaced. The box lands exactly
 * where the pointer asked, **always** — `r′` chosen this way can never make `w′`
 * or `h′` negative, so there is nothing to clamp and nothing to overshoot. And
 * the same box always gives the same flap, so a drag out and back returns to
 * where it started even across separate gestures.
 *
 * The cost, which is real: a flap carrying a deliberate `w × h` base is rewritten
 * the first time a handle moves it. `(4,4,r2)` and `(0,0,r4)` fill the same paper
 * but are different models — a rectangular-tipped flap of length 2 against a
 * point flap of length 4 — and this rule always picks the second. The `W`/`H`
 * fields in the pill are how you get the first back.
 */
function footprintFor(
  flap: OristudioBpFlap,
  signs: { sx: -1 | 0 | 1; sy: -1 | 0 | 1 },
  delta: OuterDelta,
  radiusRange: BpFlapRadiusRange | null
): BpFlapFootprint | null {
  // A gesture that asks for the box the flap already has asks for nothing. Said
  // here rather than left to fall out of the arithmetic, so that merely pressing
  // a handle cannot rewrite a flap that was never dragged.
  if (delta.x === 0 && delta.y === 0) return null;

  const outer = bpFlapOuterBox(flap);
  const width = outer.width + delta.x;
  const height = outer.height + delta.y;
  const radius = radiusRange
    ? Math.min(Math.max(Math.floor(Math.min(width, height) / 2), radiusRange.min), radiusRange.max)
    : flap.radius;
  const box = { width: width - 2 * radius, height: height - 2 * radius };
  // Only reachable when the radius could not be lowered far enough — a box below
  // the 2x2 floor that a radius of 1 needs, or a flap whose radius is pinned
  // because it has no leaf edge.
  if (box.width < 0 || box.height < 0) return null;

  // The pinned edge is the one the handle is not dragging, so the new outer box
  // hangs off it; the anchor is then that edge plus the radius.
  const origin = (sign: -1 | 0 | 1, low: number, was: number, now: number): number =>
    sign === -1 ? low + was - now : low;
  const footprint = {
    anchor: {
      x: origin(signs.sx, outer.x, outer.width, width) + radius,
      y: origin(signs.sy, outer.y, outer.height, height) + radius,
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
 * The requested delta, then the same walked back toward `(0, 0)` one cell at a
 * time — the larger axis first, so a corner drag gives up its excess before its
 * shorter side.
 */
function* shrinkingDeltas(delta: OuterDelta): Generator<OuterDelta> {
  let { x, y } = delta;
  yield { x, y };
  while (x !== 0 || y !== 0) {
    if (x !== 0 && (Math.abs(x) >= Math.abs(y) || y === 0)) x -= Math.sign(x);
    else y -= Math.sign(y);
    yield { x, y };
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
