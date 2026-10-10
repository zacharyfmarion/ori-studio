import { describe, expect, it } from 'vitest';
import {
  TOOL_HINT_INSET,
  TOOL_HINT_OVERHANG,
  TOOL_HINT_WIDTH,
  toolHintPlacement,
} from './toolHintPlacement';

/** A 1440x900 browser window, the default Edit layout inside it. */
const WINDOW = { width: 1440, height: 900 };

/** The seam with a 260px View pane: the viewport ends where the pane begins. */
const DEFAULT_ANCHOR = { right: WINDOW.width - 260, bottom: WINDOW.height - 40 };

describe('toolHintPlacement', () => {
  it('overhangs the seam by a fixed amount at the default pane width', () => {
    const { left, width } = toolHintPlacement(DEFAULT_ANCHOR, WINDOW);
    expect(DEFAULT_ANCHOR.right - left).toBe(TOOL_HINT_OVERHANG);
    expect(width).toBe(TOOL_HINT_WIDTH);
  });

  it('keeps the same overhang when the View pane is dragged wider', () => {
    // The property the seam anchor exists for: anchoring to the app's right edge
    // instead would shrink this to nothing once the pane is wider than the window.
    const wide = { ...DEFAULT_ANCHOR, right: WINDOW.width - 520 };
    const { left } = toolHintPlacement(wide, WINDOW);
    expect(wide.right - left).toBe(TOOL_HINT_OVERHANG);
  });

  it('keeps to the viewport’s side of the seam when asked, its right edge the inset in from it (review 4)', () => {
    const { left, width } = toolHintPlacement(DEFAULT_ANCHOR, WINDOW, null, { inside: true });
    expect(left + width).toBe(DEFAULT_ANCHOR.right - TOOL_HINT_INSET);
    // The pane dragged wider: still clear of it.
    const wide = { ...DEFAULT_ANCHOR, right: WINDOW.width - 520 };
    const placed = toolHintPlacement(wide, WINDOW, null, { inside: true });
    expect(placed.left + placed.width).toBe(wide.right - TOOL_HINT_INSET);
    // And over a toolbar that reaches its corner, as overhanging it steps.
    const toolbar = { left: DEFAULT_ANCHOR.right - 400, right: DEFAULT_ANCHOR.right - 100, top: DEFAULT_ANCHOR.bottom - 40 };
    expect(toolHintPlacement(DEFAULT_ANCHOR, WINDOW, toolbar, { inside: true }).bottom).toBeGreaterThan(WINDOW.height - toolbar.top);
  });

  it('sits above the viewport bottom by the inset', () => {
    const { bottom } = toolHintPlacement(DEFAULT_ANCHOR, WINDOW);
    expect(bottom).toBe(WINDOW.height - DEFAULT_ANCHOR.bottom + TOOL_HINT_INSET);
  });

  it('clamps instead of overflowing when the View pane is closed', () => {
    // Seam at the app's right edge: the unclamped rule would put all but 50px of
    // the window past it.
    const closed = { ...DEFAULT_ANCHOR, right: WINDOW.width };
    const { left, width } = toolHintPlacement(closed, WINDOW);
    expect(left + width).toBeLessThanOrEqual(WINDOW.width);
    expect(closed.right - left).toBeGreaterThan(TOOL_HINT_OVERHANG);
  });

  it('floors at the left edge rather than going off-screen', () => {
    const narrow = { width: 320, height: 700 };
    const { left, width } = toolHintPlacement({ right: 40, bottom: 660 }, narrow);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(narrow.width);
  });

  it('shrinks the window on a browser window too narrow to hold it', () => {
    const tiny = { width: 200, height: 500 };
    const { left, width } = toolHintPlacement({ right: 200, bottom: 480 }, tiny);
    expect(width).toBeLessThan(TOOL_HINT_WIDTH);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(tiny.width);
  });

  describe('stepping over the viewport toolbar', () => {
    // Measured in the running app rather than derived, because the toolbar is
    // centred on the viewport and the viewport does not start at the window's
    // left edge — the tool rail is in front of it. Deriving these from the anchor
    // alone gets the toolbar's centre wrong and the overlap never fires.
    const NARROW = { width: 1280, height: 720 };
    /** 1280px window: a 431px viewport that a 407px toolbar all but fills. */
    const NARROW_ANCHOR = { right: 665, bottom: 720 };
    const NARROW_TOOLBAR = { left: 246, right: 653, top: 674 };

    it('lifts above a toolbar that reaches into the corner', () => {
      // The case the browser found: the window sat on top of the toolbar's right
      // end, covering 38px of it.
      const flush = toolHintPlacement(NARROW_ANCHOR, NARROW);
      const lifted = toolHintPlacement(NARROW_ANCHOR, NARROW, NARROW_TOOLBAR);

      expect(flush.left).toBeLessThan(NARROW_TOOLBAR.right); // i.e. they overlap
      expect(lifted.bottom).toBeGreaterThan(flush.bottom);
      // Clear of the toolbar's top edge, not merely moved.
      expect(NARROW.height - lifted.bottom).toBeLessThan(NARROW_TOOLBAR.top);
    });

    it('stays flush with the canvas when the toolbar is clear of it', () => {
      // A wider window moves the seam right while the toolbar keeps its width, so
      // the two stop meeting and the window should not lift for nothing.
      const wideAnchor = { right: 1180, bottom: 900 };
      const wideToolbar = { left: 503, right: 910, top: 854 };

      const flush = toolHintPlacement(wideAnchor, WINDOW);
      const withToolbar = toolHintPlacement(wideAnchor, WINDOW, wideToolbar);

      expect(flush.left).toBeGreaterThan(wideToolbar.right); // i.e. they clear
      expect(withToolbar.bottom).toBe(flush.bottom);
    });

    it('ignores a toolbar that is absent', () => {
      expect(toolHintPlacement(DEFAULT_ANCHOR, WINDOW, null)).toEqual(
        toolHintPlacement(DEFAULT_ANCHOR, WINDOW)
      );
    });
  });

  it('never lets the window sit below the browser window edge', () => {
    // A viewport whose bottom is past the fold (mid-layout-change) must not push
    // the window off the bottom.
    const { bottom } = toolHintPlacement({ right: 1180, bottom: 2000 }, WINDOW);
    expect(bottom).toBeGreaterThan(0);
  });
});
