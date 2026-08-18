import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  useFloating,
  autoUpdate,
  offset as offsetMiddleware,
  flip,
  shift,
  size,
  limitShift,
  FloatingPortal,
  type Placement,
} from '@floating-ui/react';
import { useWheelPassthrough } from '../../hooks/useWheelPassthrough';
import { anchorIntersectsBoundary } from './floatingToolbarBounds';

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
  /**
   * The element the toolbar must stay inside.
   *
   * Omitted, it stays inside the **browser window** — a body-portaled pill
   * positioned `fixed` has no clipping ancestor but the viewport, so that is
   * what `@floating-ui` collides against by default. For a toolbar over a
   * docked pane that is the wrong answer in a way nothing else can correct:
   * the pill is free to slide across the neighbouring panes, and being
   * portaled it paints over them whatever its z-index. Pass the pane's own
   * element and the collision middleware clamps to that instead.
   */
  boundary?: Element | null;
  /**
   * The surface this toolbar is floating over, for wheel gestures. Supplied, a
   * scroll or pinch that lands on the toolbar is forwarded there instead of
   * reaching the browser — which would otherwise zoom the whole page, since a
   * toolbar hovering over a canvas has nothing else to do with a wheel. Omitted,
   * the wheel is left entirely alone, so a toolbar over ordinary scrollable
   * content still scrolls it.
   */
  wheelTarget?: () => Element | null | undefined;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };

/** Breathing room between the pill and the edge of its boundary, in px. */
const BOUNDARY_PADDING = 8;

/**
 * Narrowest the pill may be squeezed to before it is allowed to overflow its
 * boundary instead. Below this the controls stop being hittable, at which point
 * respecting the boundary has cost more than it bought.
 */
const MIN_TOOLBAR_WIDTH = 96;

/**
 * A generic floating toolbar: a portaled, collision-aware pill that hovers over
 * an arbitrary anchor rectangle. It flips to the opposite side and shifts along
 * the axis to stay inside its {@link FloatingToolbarProps.boundary}, so it works
 * against a pane edge as well as a screen edge.
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
  boundary,
  wheelTarget,
  ariaLabel,
  className,
  children,
}: FloatingToolbarProps) {
  const rectRef = useRef(anchorRect);
  // The mounted pill, as state rather than a ref: it comes and goes with
  // `anchorRect`, and the wheel listener has to follow it.
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);

  // Memoized: `useFloating` recomputes whenever the array's identity changes, so
  // a fresh one per render would reposition on every frame of a pan for nothing.
  const middleware = useMemo(() => {
    const overflow = {
      boundary: boundary ?? 'clippingAncestors',
      padding: BOUNDARY_PADDING,
    } as const;
    return [
      offsetMiddleware(offsetPx),
      flip(overflow),
      // `crossAxis` matters once the boundary is a pane rather than the window:
      // an object taller than the pane leaves `flip` with no side that fits, and
      // without the cross axis the pill then overflows vertically. With it, it
      // slides inside and overlaps the object — what a selection toolbar in a
      // design tool does. `limitShift` still lets it leave with an object that
      // is leaving, rather than detaching to slide along the edge.
      shift({ ...overflow, crossAxis: true, limiter: limitShift() }),
      // Shifting cannot rescue a pill that is simply wider than the pane, and
      // the inline-simulation inspector is. Capping the width is what lets
      // `.floating-toolbar`'s `flex-wrap` turn it into two rows instead.
      size({
        ...overflow,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.max(availableWidth, MIN_TOOLBAR_WIDTH)}px`;
        },
      }),
    ];
  }, [boundary, offsetPx]);

  const {
    refs: { setFloating, setPositionReference },
    floatingStyles,
    update,
  } = useFloating({
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware,
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

  // `autoUpdate` watches the reference and the pill, not the boundary. Dragging
  // the splitter between two docked panes resizes the boundary without moving
  // either, so nothing else would re-clamp.
  useLayoutEffect(() => {
    if (!boundary) return undefined;
    const observer = new ResizeObserver(() => update());
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [boundary, update]);

  useWheelPassthrough(toolbar, wheelTarget);

  const setToolbarRef = useCallback(
    (node: HTMLDivElement | null) => {
      setFloating(node);
      setToolbar(node);
    },
    [setFloating]
  );

  if (!anchorRect) return null;

  // Gone with its object. `limitShift` lets the pill follow an anchor out of the
  // boundary rather than detaching to slide along the edge; once the anchor is
  // fully outside, what is left is a pill hovering over the neighbouring pane
  // attached to nothing on screen.
  if (
    boundary &&
    !anchorIntersectsBoundary(anchorRect, boundary.getBoundingClientRect(), BOUNDARY_PADDING)
  ) {
    return null;
  }

  return (
    <FloatingPortal>
      <div
        ref={setToolbarRef}
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
