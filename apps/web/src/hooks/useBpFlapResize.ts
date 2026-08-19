import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { OristudioBpFlap, OristudioBpSheet } from '../engine/oristudioBpTypes';
import {
  bpFlapFootprint,
  bpFlapHandlePoint,
  bpFlapOuterBox,
  sameBpFlapFootprint,
  solveBpFlapReshape,
  type BpFlapCentreConstraint,
  type BpFlapFootprint,
  type BpFlapRadiusRange,
  type BpFlapResizeHandle,
} from '../lib/bpFlapReshape';
import type { BpPackingDragRequests } from './useBpPackingDragRequests';
import { useEventCallback } from './useEventCallback';
import type { Point } from '../lib/geometry';
import { track } from '../analytics';

/**
 * The resize-handle gesture for the packing pane's selected flap.
 *
 * Beside the pane rather than in it for the usual reason — a small interface in,
 * a handful of verbs out — and because the interesting parts are testable
 * without a canvas: which handles exist, what a drag sends, and what Escape
 * undoes.
 *
 * Every step is solved from the footprint the flap had when the gesture
 * *started*, never from the one it has now. That is what makes an overshoot
 * recoverable: dragging back to where you began lands exactly where you began,
 * because the same pointer always yields the same answer. Accumulating deltas
 * would ratchet instead.
 */

/**
 * Half the side of a handle square, in **screen pixels**.
 *
 * The chrome divides this by the camera scale to get its SVG size, so a handle
 * is the same size on screen at every zoom. Sizing it in SVG units instead — as
 * the flap dots and labels are — looked consistent but made the handles
 * unusable on a large sheet: SVG units per grid cell is `612 / sheetSpan`, so on
 * a 64-cell sheet an ordinary radius-1 flap is 19 units across against a 10-unit
 * handle, and because the camera scales both together, zooming in never helped.
 */
export const BP_FLAP_HANDLE_RADIUS_PX = 5;

/**
 * Below this many handle-widths across, the eight handles start to cover each
 * other and the flap they belong to, and a click meant to move the flap resizes
 * it instead. Measured in screen pixels, so zooming in genuinely reveals the
 * handles on a flap that is small on the paper.
 */
const MIN_HANDLE_SPACING = 3;

export interface BpFlapResize {
  /** Null when nothing should be drawn: no single selection, or too small. */
  flap: OristudioBpFlap | null;
  /** The handle being dragged, for styling and for suppressing the others' hover. */
  active: BpFlapResizeHandle | null;
  onHandlePointerDown: (event: PointerEvent<SVGElement>, handle: BpFlapResizeHandle) => void;
  onHandlePointerMove: (event: PointerEvent<SVGElement>) => void;
  onHandlePointerUp: (event: PointerEvent<SVGElement>) => void;
}

interface Gesture {
  handle: BpFlapResizeHandle;
  /** The flap as it was when the gesture began — every step solves from this. */
  start: OristudioBpFlap;
  /** Pointer minus handle position at grab, so the flap does not jump on contact. */
  grab: Point;
  /** The last footprint actually sent, or null when the drag has not moved. */
  sent: BpFlapFootprint | null;
}

export interface UseBpFlapResizeInput {
  /** The single selected flap, or null when the selection is anything else. */
  flap: OristudioBpFlap | null;
  sheet: OristudioBpSheet;
  /** Null when the flap has no leaf edge, which pins the radius. */
  radiusRange: BpFlapRadiusRange | null;
  /** Screen pixels per grid cell: SVG units per cell, scaled by the camera. */
  pixelsPerCell: number;
  /** True while the gesture should not start: another drag, or a busy engine. */
  disabled: boolean;
  /**
   * The line this flap must stay centred on, when it is its own mirror. Applied
   * only if the flap is *already* on it — see below.
   */
  centre?: BpFlapCentreConstraint | null;
  /** Keeps a paired flap out of its own reflection. Null when it has no partner. */
  mirrorSideGuard?: ((flap: OristudioBpFlap, candidate: BpFlapFootprint) => boolean) | null;
  /** Grid-space pointer position, already rounded to the integer grid. */
  eventToPackingPoint: (event: PointerEvent<SVGElement>) => Point;
  dragRequests: BpPackingDragRequests;
}

export function useBpFlapResize(input: UseBpFlapResizeInput): BpFlapResize {
  const {
    flap,
    sheet,
    radiusRange,
    pixelsPerCell,
    centre: requestedCentre = null,
    mirrorSideGuard = null,
    disabled,
    eventToPackingPoint,
    dragRequests,
  } = input;
  const gesture = useRef<Gesture | null>(null);
  const [active, setActive] = useState<BpFlapResizeHandle | null>(null);

  // Pin the flap to the mirror only when it is genuinely sitting on it. A flap
  // whose *vertex* is on the tree's mirror but whose box is not on the paper's is
  // a design that is already asymmetric, and a resize is the wrong place to fix
  // that: honouring the constraint there would fling the flap across the sheet on
  // the first drag. Moving it onto the axis is the move path's job.
  const centre = useMemo(() => {
    if (!requestedCentre || !flap) return null;
    const box = bpFlapOuterBox(flap);
    const middle = requestedCentre.axis === 'x' ? box.x + box.width / 2 : box.y + box.height / 2;
    return Math.abs(middle - requestedCentre.at) < 1e-6 ? requestedCentre : null;
  }, [requestedCentre, flap]);

  const finish = useCallback(
    (footprint: BpFlapFootprint | null, id: number, handle: BpFlapResizeHandle, radius: number) => {
      gesture.current = null;
      setActive(null);
      if (!footprint) return;
      dragRequests.flushFlapReshape({ id, footprint });
      // Once per gesture, on release, and only when something moved — the same
      // terms `folded figure orbited` is on. No sizes: a flap's dimensions are a
      // measured value about someone's design.
      track('bp flap resized', {
        handle: handle.length === 2 ? 'corner' : 'edge',
        radius_changed: footprint.radius !== radius,
      });
    },
    [dragRequests],
  );

  const cancel = useCallback(() => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    setActive(null);
    if (!current.sent) return;
    // Put the flap back where the gesture found it. This still closes the undo
    // entry the drag opened — one step that changes nothing — which is the price
    // of cancelling through the same commit path everything else uses.
    dragRequests.flushFlapReshape({
      id: current.start.id,
      footprint: bpFlapFootprint(current.start),
    });
  }, [dragRequests]);

  // Stable identity, latest closure — so the unmount cleanup below can be a
  // mount-once effect instead of re-subscribing every time `cancel` is rebuilt.
  const cancelLatest = useEventCallback(cancel);

  useEffect(() => {
    if (active === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    // Bound to the window for the life of the gesture rather than to the pane:
    // a pointer capture can take focus anywhere, and a container listener would
    // simply not fire. It is removed the moment the gesture ends, so it can
    // never shadow the pane's own Escape.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, cancel]);

  const onHandlePointerDown = useCallback(
    (event: PointerEvent<SVGElement>, handle: BpFlapResizeHandle) => {
      // The same opening every other pointerdown in this pane has, and for the
      // same reason: the viewport pans on middle-drag and on space+left-drag, so
      // without this a pan that begins over a handle pans *and* resizes. Worse
      // than both at once — the pointer is mapped through the canvas rect, which
      // the pan is moving, so a stationary pointer resolves to a new grid cell
      // every frame and the flap runs away under it.
      if (event.button !== 0 || !flap || disabled) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      // Deliberately no store write here. A state update between pointerdown and
      // mousedown reflows the pane, and the browser then never synthesises the
      // click — which is how every BP toolbar button was silently dead once.
      const pointer = eventToPackingPoint(event);
      const at = bpFlapHandlePoint(flap, handle);
      gesture.current = {
        handle,
        start: flap,
        grab: { x: pointer.x - at.x, y: pointer.y - at.y },
        sent: null,
      };
      setActive(handle);
      dragRequests.beginFlapReshape();
    },
    [flap, disabled, eventToPackingPoint, dragRequests],
  );

  const onHandlePointerMove = useCallback(
    (event: PointerEvent<SVGElement>) => {
      const current = gesture.current;
      if (!current) return;
      event.stopPropagation();
      const pointer = eventToPackingPoint(event);
      const solved = solveBpFlapReshape({
        flap: current.start,
        handle: current.handle,
        pointer: { x: pointer.x - current.grab.x, y: pointer.y - current.grab.y },
        radiusRange,
        sheet,
        centre,
        accepts: mirrorSideGuard
          ? (candidate) => mirrorSideGuard(current.start, candidate)
          : undefined,
      });
      // A pointer back at the box it started from asks for the flap it started
      // as. Sending that rather than nothing is what makes an overshoot
      // recoverable *during* the drag: skipping it would leave the flap wherever
      // the furthest step put it, with no way back short of undo.
      const footprint = solved ?? bpFlapFootprint(current.start);
      if (!current.sent && sameBpFlapFootprint(bpFlapFootprint(current.start), footprint)) return;
      current.sent = footprint;
      dragRequests.queueFlapReshape({ id: current.start.id, footprint });
    },
    [eventToPackingPoint, radiusRange, sheet, centre, mirrorSideGuard, dragRequests],
  );

  const onHandlePointerUp = useCallback(
    (event: PointerEvent<SVGElement>) => {
      const current = gesture.current;
      if (!current) return;
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      finish(current.sent, current.start.id, current.handle, current.start.radius);
    },
    [finish],
  );

  // A gesture whose handles disappear underneath it is stuck: the layer unmounts,
  // no pointerup ever reaches the handler, and the undo entry the drag opened is
  // left open for the next unrelated edit to fold into. So end it here rather than
  // waiting for an event that is not coming.
  //
  // Two ways it happens. The flap can go — deleted, deselected, or the design tab
  // switched — which is a cancel: put it back, because nothing consented to where
  // the half-finished drag left it. And the flap can shrink past the too-small
  // gate mid-drag, which is not a reason to abandon anything: keep the handles up
  // for the rest of the gesture instead.
  useEffect(() => {
    const current = gesture.current;
    if (!current) return;
    if (!flap || flap.id !== current.start.id) cancel();
  }, [flap, cancel]);

  // The pane itself can go while a drag is live — a workspace switch, a closed
  // tab. Nothing else would ever end the gesture then: the terminators are a
  // pointerup that will not arrive and the effect above, which does not re-run on
  // unmount. The drag's `dragging: true` steps have already opened an undo entry,
  // and `runBpTreeMutation` only closes one on a settling commit, so leaving it
  // open means the next unrelated edit in this design commits against the
  // *pre-drag* snapshot and undoing it reverts the resize too.
  useEffect(() => () => cancelLatest(), [cancelLatest]);

  const box = flap ? bpFlapOuterBox(flap) : null;
  const roomy =
    box !== null &&
    Math.min(box.width, box.height) * pixelsPerCell >=
      MIN_HANDLE_SPACING * BP_FLAP_HANDLE_RADIUS_PX * 2;

  return {
    flap: roomy || active !== null ? flap : null,
    active,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
  };
}
