import type { BpFlapFootprint } from './bpFlapReshape';
import type { Point } from './geometry';

/**
 * What a packing-pane drag asks the engine for, and whether it has asked already.
 *
 * A drag sends the engine a grid-snapped position once per frame. The pointer is
 * rounded to the integer grid before it is sent, so crossing a single cell — half
 * a second of ordinary dragging at a normal zoom — produces a run of byte-for-byte
 * identical requests. The engine's answer to an input it has already been given is
 * the answer it already gave, so each repeat costs a solve, a full document
 * refresh and a re-render for nothing.
 *
 * These live here rather than in the pane because they are about the identity of
 * a request, not about drawing, and because that is a thing worth testing
 * directly.
 */

export interface BpPackingDragBackendUpdate {
  ids: number[];
  loc: Point;
}

export interface BpPackingReshapeBackendUpdate {
  id: number;
  footprint: BpFlapFootprint;
}

export interface BpPackingDeviceBackendUpdate {
  stretchId: string;
  index: number;
  loc: Point;
}

/**
 * Whether a queued flap request would tell the engine what it was last told.
 *
 * `sent` being null means nothing has been sent yet — the start of a gesture —
 * which is never a repeat.
 */
export function sameBpDragUpdate(
  sent: BpPackingDragBackendUpdate | null,
  next: BpPackingDragBackendUpdate
): boolean {
  return (
    sent !== null &&
    sent.loc.x === next.loc.x &&
    sent.loc.y === next.loc.y &&
    sent.ids.length === next.ids.length &&
    sent.ids.every((id, index) => id === next.ids[index])
  );
}

/**
 * The same question for a resize-handle drag.
 *
 * A footprint, not a position: a handle drag can leave the anchor exactly where
 * it was and change only the box or the radius — dragging the north edge of a
 * flap whose radius cannot grow does precisely that — so comparing locations
 * alone would drop every step of it as a repeat.
 */
export function sameBpReshapeUpdate(
  sent: BpPackingReshapeBackendUpdate | null,
  next: BpPackingReshapeBackendUpdate
): boolean {
  return (
    sent !== null &&
    sent.id === next.id &&
    sent.footprint.anchor.x === next.footprint.anchor.x &&
    sent.footprint.anchor.y === next.footprint.anchor.y &&
    sent.footprint.width === next.footprint.width &&
    sent.footprint.height === next.footprint.height &&
    sent.footprint.radius === next.footprint.radius
  );
}

/** The same question for a stretch device's drag. */
export function sameBpDeviceUpdate(
  sent: BpPackingDeviceBackendUpdate | null,
  next: BpPackingDeviceBackendUpdate
): boolean {
  return (
    sent !== null &&
    sent.stretchId === next.stretchId &&
    sent.index === next.index &&
    sent.loc.x === next.loc.x &&
    sent.loc.y === next.loc.y
  );
}
