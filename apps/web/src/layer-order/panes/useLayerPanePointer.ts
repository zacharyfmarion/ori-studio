/**
 * A Layer order pane's pointer, as the inspector hears it
 * (`implementation-plans/layer-order-dialog.md`, row U8; D6): the surface's
 * hover and pick (`PaperPane`, `useCpSurface`) turned into the panes' events,
 * each saying which pane it came from and whether a pointer or a finger made
 * it, and a double tap turned into Fit.
 *
 * How a press came is read off the pane's own pointer events in the capture
 * phase, before the canvas under it handles them, so a pick knows its input
 * by the time the surface reports it.
 *
 * - **A pointer's pick** goes out at once.
 * - **A tap's pick** goes out once the double-tap window has passed with no
 *   second tap ({@link DOUBLE_TAP_MS}). A second tap soon after and near the
 *   first is a double tap (`isDoubleTap`): it fits both panes, and neither
 *   tap picks. A press that travels further than a click may
 *   (`CP_SURFACE_CLICK_SLOP_CSS`, the surface's own test) is a pan, and is no
 *   tap.
 *
 * The hover is told only when the face under it changes, not the spot: on
 * the folded paper a face lies over many. While a tap's pick waits, the face
 * under the finger stays pointed at: the hover the lift ends is told once the
 * pick goes or a double tap drops it, so the mark under the finger never
 * flickers off before its pick lands.
 *
 * No behaviour here depends on DOM focus: the events come from pointers on
 * the pane alone.
 */
import { useEffect, useMemo, useRef, type PointerEvent } from 'react';
import { isClick } from '../../cp-workspace/surface/cpSurfaceInput';
import { useEventCallback } from '../../hooks/useEventCallback';
import type { LayerFace } from '../engine/faceIndex';
import {
  DOUBLE_TAP_MS,
  isDoubleTap,
  paneInputOf,
  type LayerPaneHit,
  type LayerPaneId,
  type LayerPaneInput,
  type LayerPanesEvents,
  type LayerPaneTap,
} from './layerPaneInput';

export interface LayerPanePointer {
  /** For the pane's box: how each press came, and its double taps. Stable. */
  readonly capture: {
    readonly onPointerDownCapture: (event: PointerEvent) => void;
    readonly onPointerMoveCapture: (event: PointerEvent) => void;
    readonly onPointerUpCapture: (event: PointerEvent) => void;
  };
  /** For the surface's `onPick`. Stable. */
  readonly onPick: (hit: LayerPaneHit | null) => void;
  /** For the surface's `onHover`. Stable. */
  readonly onHover: (hit: LayerPaneHit | null) => void;
}

export function useLayerPanePointer(
  pane: LayerPaneId,
  events: LayerPanesEvents,
  onDoubleTap: () => void
): LayerPanePointer {
  const input = useRef<LayerPaneInput>('pointer');
  const press = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef<LayerPaneTap | null>(null);
  const dropPick = useRef(false);
  /** A tap's pick, waiting out the double-tap window. */
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; hit: LayerPaneHit | null } | null>(null);
  const hovered = useRef<LayerFace | null>(null);
  /** A hover the surface told while a tap's pick waited: told once it no longer does. */
  const heldHover = useRef<{ face: LayerFace | null; by: LayerPaneInput } | null>(null);

  const tellHover = useEventCallback((face: LayerFace | null, by: LayerPaneInput) => {
    if (hovered.current === face) return;
    hovered.current = face;
    events.onFaceHovered?.({ face, origin: pane, input: by });
  });
  /** The hover held while a pick waited, told now. */
  const releaseHover = () => {
    const held = heldHover.current;
    heldHover.current = null;
    if (held) tellHover(held.face, held.by);
  };

  const cancelPending = () => {
    if (pending.current !== null) clearTimeout(pending.current.timer);
    pending.current = null;
  };
  // A pane going away drops the tap still waiting.
  useEffect(() => {
    const held = pending;
    return () => {
      if (held.current !== null) clearTimeout(held.current.timer);
    };
  }, []);

  const onPointerDownCapture = useEventCallback((event: PointerEvent) => {
    input.current = paneInputOf(event.pointerType);
    press.current = { x: event.clientX, y: event.clientY };
    dropPick.current = false;
  });
  const onPointerMoveCapture = useEventCallback((event: PointerEvent) => {
    input.current = paneInputOf(event.pointerType);
  });
  const onPointerUpCapture = useEventCallback((event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    const from = press.current;
    press.current = null;
    if (!from || !isClick(from, { x: event.clientX, y: event.clientY })) {
      lastTap.current = null;
      return;
    }
    const tap = { at: event.timeStamp, x: event.clientX, y: event.clientY };
    if (isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null;
      // Neither tap picks: the first's is still waiting, the second's is about to be reported.
      cancelPending();
      dropPick.current = true;
      releaseHover();
      onDoubleTap();
    } else {
      lastTap.current = tap;
    }
  });

  const report = useEventCallback((hit: LayerPaneHit | null, by: LayerPaneInput) => {
    if (hit) events.onFacePicked?.({ face: hit.face, origin: pane, input: by });
    else events.onEmptyPaper?.({ origin: pane, input: by });
  });

  const onPick = useEventCallback((hit: LayerPaneHit | null) => {
    if (dropPick.current) {
      dropPick.current = false;
      return;
    }
    const by = input.current;
    if (by !== 'tap') {
      report(hit, by);
      return;
    }
    // A tap that made no double tap with the one before it: that one's pick goes now.
    const waiting = pending.current;
    cancelPending();
    if (waiting) report(waiting.hit, 'tap');
    const timer = setTimeout(() => {
      pending.current = null;
      report(hit, 'tap');
      releaseHover();
    }, DOUBLE_TAP_MS);
    pending.current = { timer, hit };
  });

  const onHover = useEventCallback((hit: LayerPaneHit | null) => {
    const face = hit?.face ?? null;
    if (pending.current !== null) {
      // A tap's pick waits: its face stays pointed at until the pick goes.
      heldHover.current = { face, by: input.current };
      return;
    }
    heldHover.current = null;
    tellHover(face, input.current);
  });

  const capture = useMemo(
    () => ({ onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture }),
    [onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture]
  );
  return { capture, onPick, onHover };
}
