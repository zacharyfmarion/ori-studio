import { describe, expect, it } from 'vitest';
import {
  LOUPE_GAP_PX,
  LOUPE_SIZE_PX,
  loupeImageRect,
  loupeOffset,
  loupeSpan,
  loupeWindow,
  projectToLoupe,
  quadEdges,
  sourceSizeForRectification,
} from './cpDetectCropLoupe';

describe('loupeSpan', () => {
  it('shows a 24th of the longer side, between 32 and 96 source pixels', () => {
    expect(loupeSpan(1000, 800)).toBeCloseTo(1000 / 24);
    expect(loupeSpan(400, 300)).toBe(32);
    expect(loupeSpan(4000, 3000)).toBe(96);
  });
});

describe('loupeWindow', () => {
  it('is centred on the handle and scales to the loupe size', () => {
    const window = loupeWindow({ x: 500, y: 300 }, 1200, 1200);
    expect(window.x + window.span / 2).toBe(500);
    expect(window.y + window.span / 2).toBe(300);
    expect(window.span * window.scale).toBeCloseTo(LOUPE_SIZE_PX);
    // The handle itself lands at the loupe's centre.
    expect(projectToLoupe({ x: 500, y: 300 }, window)).toEqual({
      x: LOUPE_SIZE_PX / 2,
      y: LOUPE_SIZE_PX / 2,
    });
  });
});

describe('loupeImageRect', () => {
  it('draws the whole window when it lies inside the image', () => {
    const window = loupeWindow({ x: 500, y: 500 }, 1200, 1200);
    const rect = loupeImageRect(window, 1200, 1200);
    expect(rect).toEqual({
      sx: window.x,
      sy: window.y,
      sw: window.span,
      sh: window.span,
      dx: 0,
      dy: 0,
      dw: LOUPE_SIZE_PX,
      dh: LOUPE_SIZE_PX,
    });
  });

  it('keeps the crosshair over the handle at the image corner', () => {
    // A handle on the top-left corner: only the bottom-right quarter of the
    // window is image, and it must land in the bottom-right quarter of the loupe.
    const window = loupeWindow({ x: 0, y: 0 }, 1200, 1200);
    const rect = loupeImageRect(window, 1200, 1200);
    expect(rect).not.toBeNull();
    expect(rect?.sx).toBe(0);
    expect(rect?.dx).toBeCloseTo(LOUPE_SIZE_PX / 2);
    expect(rect?.dy).toBeCloseTo(LOUPE_SIZE_PX / 2);
    expect(rect?.dw).toBeCloseTo(LOUPE_SIZE_PX / 2);
  });

  it('is null when the window misses the image', () => {
    const window = loupeWindow({ x: -500, y: -500 }, 1200, 1200);
    expect(loupeImageRect(window, 1200, 1200)).toBeNull();
  });
});

describe('loupeOffset', () => {
  const pane = { width: 500, height: 500 };

  it('sits above and to the right of the handle by default', () => {
    expect(loupeOffset({ x: 250, y: 250 }, pane)).toEqual({
      x: LOUPE_GAP_PX,
      y: -LOUPE_GAP_PX - LOUPE_SIZE_PX,
    });
  });

  it('flips left at the right edge and below at the top', () => {
    expect(loupeOffset({ x: 480, y: 20 }, pane)).toEqual({
      x: -LOUPE_GAP_PX - LOUPE_SIZE_PX,
      y: LOUPE_GAP_PX,
    });
  });

  it('stays inside a pane too narrow for either side', () => {
    // 160 px wide: neither right of the handle nor left of it fits, so the
    // loupe hugs the pane's edge instead of being clipped away.
    const narrow = { width: 160, height: 500 };
    const offset = loupeOffset({ x: 10, y: 250 }, narrow);
    expect(10 + offset.x).toBeGreaterThanOrEqual(0);
    expect(10 + offset.x + LOUPE_SIZE_PX).toBeLessThanOrEqual(narrow.width);
    expect(offset.y).toBe(-LOUPE_GAP_PX - LOUPE_SIZE_PX);
  });
});

describe('quadEdges', () => {
  it('walks the four corners in order and closes the loop', () => {
    const edges = quadEdges({
      top_left: { x: 0, y: 0 },
      top_right: { x: 10, y: 0 },
      bottom_right: { x: 10, y: 10 },
      bottom_left: { x: 0, y: 10 },
    });
    expect(edges).toHaveLength(4);
    expect(edges[3]).toEqual([
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]);
  });
});

describe('sourceSizeForRectification', () => {
  it('leaves an image at or under the cap alone', () => {
    expect(sourceSizeForRectification(1024, 768)).toEqual({ width: 1024, height: 768 });
    expect(sourceSizeForRectification(2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it('scales the longer side to the cap and keeps the aspect ratio', () => {
    expect(sourceSizeForRectification(4096, 3072)).toEqual({ width: 2048, height: 1536 });
    expect(sourceSizeForRectification(3000, 6000)).toEqual({ width: 1024, height: 2048 });
  });
});
