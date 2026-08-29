/**
 * The move gesture a region's chip carries.
 *
 * A region's **body takes no pointer events** — a suppression box usually sits
 * over the creases being repaired, and a body that swallowed presses would make
 * the pattern inside it uneditable, which is the one thing the whole repair flow
 * needs. So the chip is the region's handle: pressing it selects, dragging it
 * moves, exactly like a window title bar.
 *
 * The gesture is the same shape `CanvasObjectOverlay` runs for every other
 * canvas object — client-space delta since the press, mapped through the live
 * camera to model space and applied as a new centre — and it is written here
 * rather than shared with that overlay because the two have almost nothing in
 * common structurally: this is one HTML element with no resize or rotate arm, no
 * crop mode and no handle set, and the shared version is an SVG layer whose
 * every path is keyed by handle kind.
 *
 * # Two things it must get right
 *
 * **One undo entry per drag.** `beginGesture` is opened on the first press that
 * actually *moves* — not on `pointerdown` — so a click that selects and a click
 * on a button leave the history untouched, and the snapshot is never left open
 * for a later commit to close with the wrong baseline. Every intermediate
 * `onMove` is unbracketed; `onGestureCommit` closes the whole drag as one entry.
 *
 * **Controls are not drag handles.** A press that lands on a button, the class
 * dropdown or any other control selects the region and then gets out of the way:
 * no pointer capture, no drag. Radix opens its dropdown on `pointerdown`, so
 * capturing the pointer there would take the press away from the menu it was
 * aimed at.
 */
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCpOverlayViews } from '../cpOverlayViewStore';
import { overlayCssDeltaToModel, type Vec2 } from '../annotations/annotationTransform';

/**
 * How far the pointer must travel before a press counts as a drag, in CSS px.
 *
 * Without it a click with a pixel of hand tremor writes a centre and records an
 * undo entry for a move nobody made.
 */
const DRAG_THRESHOLD_PX = 2;

/**
 * Anything on the bar that owns its own press.
 *
 * Matched with `closest`, so an icon inside a button counts as the button. The
 * bar's only ancestors are the portal root and `<body>`, so there is nothing
 * above it for this to match by accident.
 */
const CONTROL_SELECTOR =
  'button, a, input, select, textarea, [role="menuitem"], [role="menuitemcheckbox"], [contenteditable="true"]';

function isChipControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROL_SELECTOR) !== null;
}

/** The handlers to spread onto the bar. */
export interface CpRegionChipDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface CpRegionChipDragOptions {
  /** The region's centre in model space, read at the moment of the press. */
  center: Vec2;
  /** Take the canvas-object selection. Called for every press on the bar. */
  onSelect: () => void;
  /** Write a new centre. Unbracketed — see {@link onGestureStart}. */
  onMove: (center: Vec2) => void;
  /** Snapshot for undo, opened on the first move rather than on the press. */
  onGestureStart: () => void;
  /** Close the snapshot under a label, so the drag undoes as one entry. */
  onGestureCommit: (label: string) => void;
}

interface Drag {
  pointerId: number;
  startClient: Vec2;
  startCenter: Vec2;
  /** Whether the pointer has travelled far enough to have opened a gesture. */
  moved: boolean;
}

export function useCpRegionChipDrag({
  center,
  onSelect,
  onMove,
  onGestureStart,
  onGestureCommit,
}: CpRegionChipDragOptions): CpRegionChipDragHandlers {
  const { t } = useTranslation();
  // Subscribed here rather than passed in: the camera can change mid-drag (a
  // trackpad zoom during a move), and the delta has to be mapped through the
  // affine in force at the time the sample arrives.
  const views = useCpOverlayViews();
  const dragRef = useRef<Drag | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      onSelect();
      if (event.button !== 0 || isChipControl(event.target)) return;
      // Optional because the bar moves *with* the region it is dragging, so the
      // cursor can leave it mid-gesture; capture is what keeps the samples
      // arriving. jsdom implements no pointer capture at all, hence the guard
      // rather than a bare call — the same shape `CanvasObjectOverlay` uses.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        // `center` directly, not through a ref: reading a ref during render is
        // a lint error, and syncing it in an effect would leave the captured
        // origin one frame stale — which during a pan is a visible offset. The
        // chip already re-renders per camera frame to track its box, so
        // rebuilding this one closure alongside it costs nothing.
        startCenter: { ...center },
        moved: false,
      };
    },
    [center, onSelect]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !views) return;
      const dCss = {
        x: event.clientX - drag.startClient.x,
        y: event.clientY - drag.startClient.y,
      };
      if (!drag.moved) {
        if (Math.hypot(dCss.x, dCss.y) <= DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        onGestureStart();
      }
      const dModel = overlayCssDeltaToModel(views.model, dCss);
      if (!dModel) return;
      onMove({ x: drag.startCenter.x + dModel.x, y: drag.startCenter.y + dModel.y });
    },
    [onGestureStart, onMove, views]
  );

  /**
   * End the drag, recording it if it changed anything.
   *
   * Cancellation commits too, unlike `CanvasObjectOverlay`'s. The difference is
   * what the two are protecting against: there, a cancel is usually a camera
   * gesture stealing the surface and the object's motion was never intended, so
   * it is dropped. Here the only way to reach this is a press that has already
   * dragged the bar, and the store is holding that moved centre either way — so
   * not recording would leave a real edit outside the undo stack.
   */
  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (drag?.moved) onGestureCommit(t('panels:cpRegion.move', 'Move region'));
    },
    [onGestureCommit, t]
  );

  return { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag };
}
