import type {
  OristudioBpDevice,
  OristudioBpFlap,
  OristudioBpSelection,
  OristudioBpSheet,
} from '../engine/oristudioBpTypes';
import { deviceIndexFromId } from '../components/panels/BpPackingPrimitive';
import { constrainBpPackingFlapGroupTarget } from './bpPackingViewport';
import type { BpPackingNudgeDirection } from './bpPackingContextMenu';
import type { Point } from './geometry';

/**
 * Moving the packing selection by one grid unit.
 *
 * Lifted out of `BpPackingPanel` when the context menu became a second caller.
 * Two things forced it, and both are the point:
 *
 * 1. **A menu has to ask before it acts.** The pane's original mover both
 *    tested and moved, which an arrow key can live with — it just skips
 *    `preventDefault` when nothing shifted — but a menu must grey a direction
 *    that is against a wall *before* the press. So the question is separated
 *    from the act: `planBpPackingNudge` answers, and the caller commits.
 * 2. **It is pure, so it belongs here.** Free of React and of the store, which
 *    is what lets the wall cases be tested without a pane, a worker, or a
 *    pointer.
 */

export const BP_PACKING_NUDGE_VECTORS: Record<BpPackingNudgeDirection, Point> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function bpPackingNudgeDirectionFromKey(key: string): BpPackingNudgeDirection | null {
  switch (key) {
    case 'ArrowUp':
    case 'Up':
      return 'up';
    case 'ArrowDown':
    case 'Down':
      return 'down';
    case 'ArrowLeft':
    case 'Left':
      return 'left';
    case 'ArrowRight':
    case 'Right':
      return 'right';
    default:
      return null;
  }
}

/** The flaps a nudge would move: the selected one, or the selected group. */
export function selectedNudgeFlaps(
  selection: OristudioBpSelection,
  flaps: readonly OristudioBpFlap[]
): OristudioBpFlap[] {
  if (selection.kind === 'bp-flap') {
    return flaps.filter((flap) => flap.id === selection.id);
  }
  if (selection.kind === 'bp-multi') {
    const selected = new Set(selection.flaps);
    return flaps.filter((flap) => selected.has(flap.id));
  }
  return [];
}

/**
 * The device a nudge would move.
 *
 * Only when it is the *sole* thing selected: a device rides on a stretch whose
 * flaps are also selectable, and nudging it while a flap is selected too would
 * move two things that are constrained against each other.
 */
export function selectedNudgeDevice(
  selection: OristudioBpSelection,
  devices: readonly OristudioBpDevice[]
): OristudioBpDevice | null {
  if (selection.kind === 'bp-device') {
    return devices.find((device) => device.id === selection.id) ?? null;
  }
  if (
    selection.kind === 'bp-multi' &&
    selection.vertices.length === 0 &&
    selection.edges.length === 0 &&
    selection.flaps.length === 0 &&
    selection.rivers.length === 0 &&
    selection.stretches.length === 0 &&
    selection.devices.length === 1 &&
    selection.invalidJunctions.length === 0
  ) {
    const id = selection.devices[0];
    return id ? (devices.find((device) => device.id === id) ?? null) : null;
  }
  return null;
}

/** What a committed nudge should do. */
export type BpPackingNudgePlan =
  | { kind: 'device'; stretchId: string; index: number; loc: Point }
  | { kind: 'flaps'; ids: number[]; referenceId: number; loc: Point };

export interface BpPackingNudgeInput {
  selection: OristudioBpSelection;
  flaps: readonly OristudioBpFlap[];
  devices: readonly OristudioBpDevice[];
  sheet: OristudioBpSheet;
}

/**
 * What one grid-unit move would do, or `null` when it would do nothing.
 *
 * `null` covers both "nothing is selected" and "the selection is already against
 * the wall in that direction" — which the caller wants to treat identically, and
 * which is exactly the predicate the menu greys a row on.
 */
export function planBpPackingNudge(
  direction: BpPackingNudgeDirection,
  input: BpPackingNudgeInput
): BpPackingNudgePlan | null {
  const flaps = selectedNudgeFlaps(input.selection, input.flaps);
  const reference = flaps[0];
  const vector = BP_PACKING_NUDGE_VECTORS[direction];

  if (!reference) {
    const device = selectedNudgeDevice(input.selection, input.devices);
    if (!device || !device.rangeScalar || device.forward === null) return null;
    const index = deviceIndexFromId(device.id);
    if (index === null) return null;
    // Two units, not one: a device slides along its stretch, where the grid step
    // is half a cell.
    const constrained = constrainBpPackingDeviceTarget(device, device.position, {
      x: device.position.x + vector.x * 2,
      y: device.position.y + vector.y * 2,
    });
    if (constrained.vector.x === 0 && constrained.vector.y === 0) return null;
    return { kind: 'device', stretchId: device.stretchId, index, loc: constrained.loc };
  }

  const { loc, vector: constrainedVector } = constrainBpPackingFlapGroupTarget(
    flaps,
    reference,
    { x: reference.anchor.x + vector.x, y: reference.anchor.y + vector.y },
    input.sheet
  );
  if (constrainedVector.x === 0 && constrainedVector.y === 0) return null;
  return {
    kind: 'flaps',
    ids: flaps.map((flap) => flap.id),
    referenceId: reference.id,
    loc,
  };
}

/**
 * Where a device may sit, given where a gesture wants to put it.
 *
 * A device slides along its stretch's diagonal, so the drag is projected onto
 * that axis and clamped to the device's own range — which is why both the drag
 * path and the nudge above go through it rather than writing a position
 * directly.
 *
 * Moved here from `BpPackingPanel` when the nudge planner became its second
 * caller; the drag path still uses it, and it is re-exported to that pane.
 */
export function constrainBpPackingDeviceTarget(
  device: OristudioBpDevice,
  start: Point,
  target: Point
): {
  loc: Point;
  vector: Point;
  rangeScalar: [number, number];
} {
  const forward = device.forward ?? true;
  const f = forward ? 1 : -1;
  const range = device.rangeScalar ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  const projected = Math.round((target.x - start.x + f * (target.y - start.y)) / 2);
  const dx = Math.min(range[1], Math.max(range[0], projected));
  const vector = { x: dx, y: f * dx };
  return {
    loc: { x: device.position.x + vector.x, y: device.position.y + vector.y },
    vector,
    rangeScalar: [range[0] - dx, range[1] - dx],
  };
}
