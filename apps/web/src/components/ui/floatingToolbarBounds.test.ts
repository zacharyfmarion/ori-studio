import { describe, expect, it } from 'vitest';
import { anchorIntersectsBoundary, type BoundaryRect } from './floatingToolbarBounds';
import type { FloatingAnchorRect } from './FloatingToolbar';

/**
 * When a canvas object's toolbar is still worth showing.
 *
 * The pane in these cases is 1000x600 at the origin with an 8px inset, so the
 * usable region is x ∈ [8, 992], y ∈ [8, 592].
 */
const PANE: BoundaryRect = { left: 0, top: 0, right: 1000, bottom: 600 };
const PADDING = 8;

function anchor(over: Partial<FloatingAnchorRect> = {}): FloatingAnchorRect {
  return { left: 400, top: 300, width: 120, height: 80, ...over };
}

function visible(rect: FloatingAnchorRect): boolean {
  return anchorIntersectsBoundary(rect, PANE, PADDING);
}

describe('anchorIntersectsBoundary', () => {
  it('shows a toolbar for an object well inside the pane', () => {
    expect(visible(anchor())).toBe(true);
  });

  it('keeps showing one while the object is only half out', () => {
    // Straddling each edge in turn — the object is still partly on screen, so
    // its actions are still reachable and still relevant.
    expect(visible(anchor({ left: -60 }))).toBe(true);
    expect(visible(anchor({ left: 960 }))).toBe(true);
    expect(visible(anchor({ top: -40 }))).toBe(true);
    expect(visible(anchor({ top: 560 }))).toBe(true);
  });

  it('hides one whose object has been panned clear of the pane', () => {
    expect(visible(anchor({ left: -200 }))).toBe(false);
    expect(visible(anchor({ left: 1200 }))).toBe(false);
    expect(visible(anchor({ top: -200 }))).toBe(false);
    expect(visible(anchor({ top: 800 }))).toBe(false);
  });

  it('hides one sitting in the padding band, where the pill could not fit anyway', () => {
    // Wholly between the pane edge and the inset: right edge at x=6, inside the
    // pane but outside the usable region.
    expect(visible(anchor({ left: 2, width: 4 }))).toBe(false);
  });

  it('counts a touching object as visible', () => {
    // Right edge exactly on the inset. Ties go to showing the toolbar: a
    // wrongly hidden one costs an action, a wrongly shown one costs a pixel.
    expect(visible(anchor({ left: -112, width: 120 }))).toBe(true);
  });

  it('shows a zero-size anchor by its position alone', () => {
    // A collapsed selection still has somewhere to hang a toolbar.
    expect(visible(anchor({ width: 0, height: 0 }))).toBe(true);
    expect(visible(anchor({ left: 1500, width: 0, height: 0 }))).toBe(false);
  });

  it('degrades to the centre line rather than blanking a pane too narrow to inset', () => {
    // A splitter dragged almost shut. Halving the 10px pane beats declaring
    // everything out of bounds, which would blink the toolbar out mid-drag.
    const sliver: BoundaryRect = { left: 0, top: 0, right: 10, bottom: 600 };
    expect(anchorIntersectsBoundary(anchor({ left: 0, width: 10 }), sliver, PADDING)).toBe(true);
    expect(anchorIntersectsBoundary(anchor({ left: 40, width: 10 }), sliver, PADDING)).toBe(false);
  });
});
