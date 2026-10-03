import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  useFloating,
  autoUpdate,
  offset as offsetMiddleware,
  flip,
  shift,
  limitShift,
  type Placement,
} from '@floating-ui/react';
import { anchorIntersectsBoundary, toolbarMaxWidth } from './floatingToolbarBounds';
import { observeResizeDeferred } from './observeResizeDeferred';

/**
 * A rectangle in viewport (CSS px) coordinates that a floating surface anchors
 * against. This is deliberately a plain data shape (not a DOM node) so a surface
 * can float above things that aren't elements — a selected object on a pan/zoom
 * canvas, a text range, a computed region.
 */
export interface FloatingAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AnchoredFloatingOptions {
  /** Anchor in viewport CSS px; nothing floats while this is null. */
  anchorRect: FloatingAnchorRect | null;
  /** Preferred side; flips automatically on collision. */
  placement: Placement;
  /** Gap between the anchor and the floating element, in px. */
  offset: number;
  /**
   * The element the floating surface must stay inside.
   *
   * Omitted, it stays inside the **browser window** — a body-portaled element
   * positioned `fixed` has no clipping ancestor but the viewport, so that is
   * what `@floating-ui` collides against by default. For a surface over a docked
   * pane that is the wrong answer in a way nothing else can correct: it is free
   * to slide across the neighbouring panes, and being portaled it paints over
   * them whatever its z-index. Pass the pane's own element and the collision
   * middleware clamps to that instead.
   */
  boundary?: Element | null;
  /**
   * Narrowest the surface may be squeezed to before it is allowed to overflow
   * its boundary instead. Below this its controls stop being hittable, at which
   * point respecting the boundary has cost more than it bought.
   */
  minWidth: number;
}

export interface AnchoredFloating {
  /** Callback ref for the floating element. */
  setFloating: (node: HTMLElement | null) => void;
  /** The floating element while it is mounted, for listeners that must follow it. */
  floating: HTMLElement | null;
  /** Its position, and the width cap that keeps it inside the boundary. */
  style: CSSProperties;
  /**
   * False with no anchor, and once the anchor has left the boundary: render
   * nothing then.
   */
  visible: boolean;
}

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };

/** Breathing room between the surface and the edge of its boundary, in px. */
const BOUNDARY_PADDING = 8;

/**
 * Places a body-portaled surface against an anchor rectangle, kept inside a
 * boundary: it flips to the opposite side and shifts along the axis to stay in,
 * so it works against a pane edge as well as a screen edge.
 *
 * The anchor is a virtual reference driven by `anchorRect` rather than a DOM
 * node, because the things we anchor to (a canvas object under a camera) move
 * without emitting scroll/resize events. Callers recompute the rect as their
 * source moves and pass it in; the surface repositions on every change.
 *
 * This is the half of `FloatingToolbar` that is not a toolbar, for a floating
 * surface with chrome of its own — the crease-angle popover is a
 * `FloatingPanel`, not a bar of controls.
 */
export function useAnchoredFloating({
  anchorRect,
  placement,
  offset,
  boundary,
  minWidth,
}: AnchoredFloatingOptions): AnchoredFloating {
  const rectRef = useRef(anchorRect);
  // The mounted element, as state rather than a ref: it comes and goes with
  // `anchorRect`, and listeners on it have to follow it.
  const [floating, setFloatingElement] = useState<HTMLElement | null>(null);

  // Memoized: `useFloating` recomputes whenever the array's identity changes, so
  // a fresh one per render would reposition on every frame of a pan for nothing.
  const middleware = useMemo(() => {
    const overflow = {
      boundary: boundary ?? 'clippingAncestors',
      padding: BOUNDARY_PADDING,
    } as const;
    return [
      offsetMiddleware(offset),
      flip(overflow),
      // `crossAxis` matters once the boundary is a pane rather than the window:
      // an object taller than the pane leaves `flip` with no side that fits, and
      // without the cross axis the surface then overflows vertically. With it,
      // it slides inside and overlaps the object — what a selection toolbar in a
      // design tool does. `limitShift` still lets it leave with an object that
      // is leaving, rather than detaching to slide along the edge.
      shift({ ...overflow, crossAxis: true, limiter: limitShift() }),
    ];
  }, [boundary, offset]);

  const {
    refs: { setFloating: setFloatingNode, setPositionReference },
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

  // `autoUpdate` watches the reference and the surface, not the boundary.
  // Dragging the splitter between two docked panes resizes the boundary without
  // moving either, so nothing else would re-clamp.
  //
  // Deferred, because `update()` runs the `size` middleware and that writes the
  // surface's own width — see `observeResizeDeferred` for why doing that inline
  // ends in a background-error toast. `autoUpdate` guards against the same loop
  // (floating-ui#1740), but only when the *reference element* resizes, and ours
  // is a virtual reference, so its guard never fires and never protected us.
  useLayoutEffect(() => {
    if (!boundary) return undefined;
    return observeResizeDeferred(boundary, update);
  }, [boundary, update]);

  const setFloating = useCallback(
    (node: HTMLElement | null) => {
      setFloatingNode(node);
      setFloatingElement(node);
    },
    [setFloatingNode]
  );

  const boundaryRect = anchorRect ? boundary?.getBoundingClientRect() : undefined;

  // Gone with its object. `limitShift` lets the surface follow an anchor out of
  // the boundary rather than detaching to slide along the edge; once the anchor
  // is fully outside, what is left is a surface hovering over the neighbouring
  // pane attached to nothing on screen.
  const visible =
    anchorRect !== null &&
    !(boundaryRect && !anchorIntersectsBoundary(anchorRect, boundaryRect, BOUNDARY_PADDING));

  const style: CSSProperties = {
    ...floatingStyles,
    // Shifting cannot rescue a surface that is simply wider than the pane, and
    // the inline-simulation inspector is; this is what lets a floating toolbar's
    // `flex-wrap` turn it into two rows instead. Rendered as a plain style rather
    // than through `size` — see `toolbarMaxWidth` for why it must not come from
    // the position pass.
    maxWidth: boundaryRect ? toolbarMaxWidth(boundaryRect, BOUNDARY_PADDING, minWidth) : undefined,
  };

  return { setFloating, floating, style, visible };
}
