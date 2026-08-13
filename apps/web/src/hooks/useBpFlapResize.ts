import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { OristudioBpFlap, OristudioBpSheet } from '../engine/oristudioBpTypes';
import {
  bpFlapHandlePoint,
  bpFlapOuterBox,
  solveBpFlapReshape,
  type BpFlapFootprint,
  type BpFlapRadiusRange,
  type BpFlapResizeHandle,
} from '../lib/bpFlapReshape';
import type { BpPackingDragRequests } from './useBpPackingDragRequests';
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

/** Half the side of a handle square, in SVG user units. */
export const BP_FLAP_HANDLE_RADIUS = 5;

/**
 * Below this many handle-widths across, the eight handles start to cover each
 * other and the flap they belong to, and a click meant to move the flap resizes
 * it instead. Measured in SVG units against the flap's drawn extent, which makes
 * it a test of *relative* size — the camera scales handles and flap together, so
 * zoom cancels out.
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
  /** SVG units per grid cell, for the too-small gate. */
  unit: number;
  /** True while the gesture should not start: another drag, or a busy engine. */
  disabled: boolean;
  /** Grid-space pointer position, already rounded to the integer grid. */
  eventToPackingPoint: (event: PointerEvent<SVGElement>) => Point;
  dragRequests: BpPackingDragRequests;
}

export function useBpFlapResize(input: UseBpFlapResizeInput): BpFlapResize {
  const { flap, sheet, radiusRange, unit, disabled, eventToPackingPoint, dragRequests } = input;
  const gesture = useRef<Gesture | null>(null);
  const [active, setActive] = useState<BpFlapResizeHandle | null>(null);

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
    [dragRequests]
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
      footprint: {
        anchor: current.start.anchor,
        width: current.start.width,
        height: current.start.height,
        radius: current.start.radius,
      },
    });
  }, [dragRequests]);

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
      if (!flap || disabled) return;
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
    [flap, disabled, eventToPackingPoint, dragRequests]
  );

  const onHandlePointerMove = useCallback(
    (event: PointerEvent<SVGElement>) => {
      const current = gesture.current;
      if (!current) return;
      event.stopPropagation();
      const pointer = eventToPackingPoint(event);
      const footprint = solveBpFlapReshape({
        flap: current.start,
        handle: current.handle,
        pointer: { x: pointer.x - current.grab.x, y: pointer.y - current.grab.y },
        radiusRange,
        sheet,
      });
      if (!footprint) return;
      current.sent = footprint;
      dragRequests.queueFlapReshape({ id: current.start.id, footprint });
    },
    [eventToPackingPoint, radiusRange, sheet, dragRequests]
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
    [finish]
  );

  const box = flap ? bpFlapOuterBox(flap) : null;
  const roomy =
    box !== null &&
    Math.min(box.width, box.height) * unit >= MIN_HANDLE_SPACING * BP_FLAP_HANDLE_RADIUS * 2;

  return {
    flap: roomy ? flap : null,
    active,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
  };
}
