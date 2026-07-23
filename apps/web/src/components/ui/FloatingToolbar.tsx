import { useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  useFloating,
  autoUpdate,
  offset as offsetMiddleware,
  flip,
  shift,
  limitShift,
  FloatingPortal,
  type Placement,
} from '@floating-ui/react';

/**
 * A rectangle in viewport (CSS px) coordinates that a {@link FloatingToolbar}
 * anchors against. This is deliberately a plain data shape (not a DOM node) so
 * the toolbar can float above things that aren't elements — a selected object on
 * a pan/zoom canvas, a text range, a computed region.
 */
export interface FloatingAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingToolbarProps {
  /** Anchor in viewport CSS px; the toolbar hides while this is null. */
  anchorRect: FloatingAnchorRect | null;
  /**
   * Preferred side; flips automatically on collision. Defaults to `'top-start'`
   * — the toolbar lines up with the object's leading edge rather than centring
   * on it, so it stays put as the object resizes and reads as belonging to it.
   */
  placement?: Placement;
  /** Gap between the anchor and the toolbar, in px. Defaults to 8. */
  offset?: number;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };

/**
 * A generic floating toolbar: a portaled, collision-aware pill that hovers over
 * an arbitrary anchor rectangle. It flips to the opposite side and shifts along
 * the axis to stay within the viewport, so it works near screen edges.
 *
 * The anchor is a virtual reference driven by {@link FloatingToolbarProps.anchorRect}
 * rather than a DOM node, because the things we anchor to (a canvas object under
 * a camera) move without emitting scroll/resize events. Callers recompute the
 * rect as their source moves and pass it in; this component repositions on every
 * change. Body-portaled so it escapes transformed/`will-change` ancestors (e.g.
 * Dockview panels), matching {@link ContextMenu}'s rationale.
 *
 * Presentational only — compose the actual controls as children.
 */
export function FloatingToolbar({
  anchorRect,
  placement = 'top-start',
  offset: offsetPx = 8,
  ariaLabel,
  className,
  children,
}: FloatingToolbarProps) {
  const rectRef = useRef(anchorRect);

  const {
    refs: { setFloating, setPositionReference },
    floatingStyles,
    update,
  } = useFloating({
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offsetMiddleware(offsetPx),
      flip({ padding: 8 }),
      shift({ padding: 8, limiter: limitShift() }),
    ],
  });

  // Virtual reference: reads the latest anchor rect on demand.
  useLayoutEffect(() => {
    setPositionReference({
      getBoundingClientRect() {
        const r = rectRef.current;
        if (!r) return EMPTY_RECT;
        return {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          left: r.left,
          top: r.top,
          right: r.left + r.width,
          bottom: r.top + r.height,
        };
      },
    });
  }, [setPositionReference]);

  // Camera pan/zoom changes the rect without any DOM event, so publish the
  // latest rect and reposition explicitly whenever it changes.
  useLayoutEffect(() => {
    rectRef.current = anchorRect;
    update();
  }, [anchorRect, update]);

  if (!anchorRect) return null;

  return (
    <FloatingPortal>
      <div
        ref={setFloating}
        className={['floating-toolbar', className].filter(Boolean).join(' ')}
        role="toolbar"
        aria-label={ariaLabel}
        style={floatingStyles}
      >
        {children}
      </div>
    </FloatingPortal>
  );
}
