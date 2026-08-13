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
 * So three numbers govern one drawn box, and a handle drag says where one of its
 * edges should land without saying which of the three should move. This module
 * answers that, preferring the **radius** — the only one of the three that means
 * something in the folded model, the others being the flap's rectangular base.
 *
 * ## Why the radius is free to prefer
 *
 * Pin the three outer edges the handle does not drag, let `δ = r′ − r`, and
 * every unknown falls out of it:
 *
 * ```
 * w′ = w + Δx − 2δ      h′ = h + Δy − 2δ      r′ = r + δ
 * x′ = x + δ − (west handle ? Δx : 0)         y′ = y + δ − (south handle ? Δy : 0)
 * ```
 *
 * where `Δx`, `Δy` are the requested changes in the **outer** width and height.
 * Substituting back gives `W′ = W + Δx` and `H′ = H + Δy` for *every* `δ` — the
 * dragged edge lands exactly where the pointer asked whatever the radius does.
 * Choosing `δ` is therefore a free choice about meaning, not a compromise on
 * geometry.
 *
 * Note `x′ = x + δ` even when `Δx = 0`: growing the radius on a north drag has to
 * walk the anchor east to hold the left and right edges still. **A resize moves
 * the flap**, which is why the result carries an anchor and why the kernel takes
 * the whole footprint in one call.
 *
 * ## Two facts that shape the rule
 *
 * **Integrality.** `create_junction` derives the device overlap from flap AABBs
 * and tree distances, and BP's gadget generation hard-errors on a fractional
 * one — taking the whole graphics snapshot with it, not just that gadget. Every
 * number here is an integer in and an integer out.
 *
 * **Parity.** `W = w + 2r`, so the radius can only ever absorb an *even* change
 * in the outer extent; an odd `Δ` necessarily leaves ±1 in the box. Rounding `δ`
 * toward zero is what decides where that cell goes, and it means the box wobbles
 * by one while the outer edge — the thing under the cursor — tracks it exactly.
 * Rounding away from zero would instead shrink the box while the user drags
 * outward, which is worse: a number moving against the gesture.
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
 * The footprint for one exact outer-box delta, or `null` when no integer radius
 * satisfies it.
 */
function footprintFor(
  flap: OristudioBpFlap,
  signs: { sx: -1 | 0 | 1; sy: -1 | 0 | 1 },
  delta: OuterDelta,
  radiusRange: BpFlapRadiusRange | null
): BpFlapFootprint | null {
  const { width: w, height: h, radius: r } = flap;
  const radiusDelta = solveRadiusDelta(w, h, r, signs, delta, radiusRange);
  if (radiusDelta === null) return null;
  const width = w + delta.x - 2 * radiusDelta;
  const height = h + delta.y - 2 * radiusDelta;
  if (width < 0 || height < 0) return null;
  const anchor = {
    x: flap.anchor.x + radiusDelta - (signs.sx === -1 ? delta.x : 0),
    y: flap.anchor.y + radiusDelta - (signs.sy === -1 ? delta.y : 0),
  };
  const footprint = { anchor, width, height, radius: r + radiusDelta };
  // A flap that arrived off the integer lattice must not be nudged further along
  // it. Refusing is the safe answer: a fractional flap coordinate fails device
  // generation for the entire design, not just this flap.
  return isIntegralFootprint(footprint) ? footprint : null;
}

/**
 * How much of the drag the radius takes.
 *
 * - **As much as the drag paid for, and no more.** Maximising the radius
 *   outright would canonicalise the flap: grabbing a handle and moving a single
 *   cell would snap a `4×4 r2` flap straight to `r4`. `δwant` rounds toward zero
 *   so a drag can only ever move the radius in the direction it is going.
 * - **Only what the other dimension can pay.** `floor((h + Δy) / 2)` is the
 *   slack the *un-dragged* axis has to give up in exchange, and it is where the
 *   "if it can" lives: an east drag on an ordinary circular flap (`h = 0`) gets
 *   no radius at all, and the whole delta goes to the width — correctly, because
 *   making a circle wider without making it taller is exactly what a width is
 *   for.
 * - The driving deltas are the ones this **handle** controls. A corner drag
 *   grows the radius; an edge drag can only spend what the opposite dimension
 *   has.
 */
function solveRadiusDelta(
  w: number,
  h: number,
  r: number,
  signs: { sx: -1 | 0 | 1; sy: -1 | 0 | 1 },
  delta: OuterDelta,
  radiusRange: BpFlapRadiusRange | null
): number | null {
  if (!radiusRange) return 0;
  const driven: number[] = [];
  if (signs.sx !== 0) driven.push(delta.x);
  if (signs.sy !== 0) driven.push(delta.y);
  const drive = driven.length === 0 ? 0 : Math.max(...driven);
  const want = drive >= 0 ? Math.floor(drive / 2) : Math.ceil(drive / 2);
  const high = Math.min(
    Math.floor((w + delta.x) / 2),
    Math.floor((h + delta.y) / 2),
    radiusRange.max - r
  );
  const low = radiusRange.min - r;
  if (low > high) return null;
  return Math.min(Math.max(want, low), high);
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

function sameFootprint(flap: OristudioBpFlap, footprint: BpFlapFootprint): boolean {
  return (
    flap.anchor.x === footprint.anchor.x &&
    flap.anchor.y === footprint.anchor.y &&
    flap.width === footprint.width &&
    flap.height === footprint.height &&
    flap.radius === footprint.radius
  );
}
