import { describe, expect, it } from 'vitest';
import {
  MAX_BITMAP_RENDER_EDGE,
  bitmapCanvasEdge,
  fitRenderWithin,
  nextRenderCanvasSize,
} from './simulatorSession';

const at = (width: number, height: number) => ({ width, height });

describe('choosing a canvas size', () => {
  it('snaps up to the next power of two', () => {
    // Grow-only does nothing for a monotonically increasing sequence, and zooming
    // in is exactly that: every frame wants a few more pixels than the last, so
    // the buffer reallocated every frame anyway — 3.6ms small, 95ms by 8192.
    expect(bitmapCanvasEdge(300)).toBe(512);
    expect(bitmapCanvasEdge(513)).toBe(1024);
    expect(bitmapCanvasEdge(1024)).toBe(1024);
  });

  it('never exceeds the cap', () => {
    // Past what the browser can back, the drawing buffer is silently clamped and
    // every window renders transparent with no error raised anywhere.
    expect(bitmapCanvasEdge(4000)).toBe(MAX_BITMAP_RENDER_EDGE);
    expect(bitmapCanvasEdge(50_000)).toBe(MAX_BITMAP_RENDER_EDGE);
  });

  it('keeps a floor for a window measured before layout', () => {
    expect(bitmapCanvasEdge(0)).toBeGreaterThan(0);
    expect(bitmapCanvasEdge(1)).toBe(bitmapCanvasEdge(0));
  });

  it('takes at most a handful of steps across the whole range', () => {
    const steps = new Set<number>();
    for (let edge = 1; edge <= 4000; edge += 1) steps.add(bitmapCanvasEdge(edge));
    expect(steps.size).toBeLessThanOrEqual(6);
  });
});

describe('sizing the shared render canvas', () => {
  describe('bitmap mode — the canvas is scratch, shared by every window', () => {
    it('does not resize for a smaller request', () => {
      expect(nextRenderCanvasSize(at(1024, 1024), at(240, 240), 'bitmap')).toBeNull();
    });

    it('does not resize across a whole zoom within one bucket', () => {
      // The regression this exists for: every one of these used to reallocate.
      for (let edge = 520; edge <= 1024; edge += 4) {
        expect(nextRenderCanvasSize(at(1024, 1024), at(edge, edge), 'bitmap')).toBeNull();
      }
    });

    it('grows to the bucket, not to the request', () => {
      expect(nextRenderCanvasSize(at(256, 256), at(300, 300), 'bitmap')).toEqual(at(512, 512));
    });

    it('grows on one axis without shrinking the other', () => {
      expect(nextRenderCanvasSize(at(1024, 256), at(300, 480), 'bitmap')).toEqual(at(1024, 512));
    });

    it('stops growing at the cap however far you zoom', () => {
      let size = at(128, 128);
      const resizes: number[] = [];
      // A fast zoom in: the request climbs without bound.
      for (let edge = 130; edge <= 12_000; edge += 37) {
        const next = nextRenderCanvasSize(size, at(edge, edge), 'bitmap');
        if (next) {
          resizes.push(next.width);
          size = next;
        }
      }
      expect(resizes).toEqual([256, 512, 1024, MAX_BITMAP_RENDER_EDGE]);
      expect(size.width).toBe(MAX_BITMAP_RENDER_EDGE);
    });

    it('settles once the largest window has been seen', () => {
      let size = at(1, 1);
      let resizes = 0;
      for (let i = 0; i < 60; i += 1) {
        const want = [at(240, 240), at(520, 520), at(380, 380)][i % 3]!;
        const next = nextRenderCanvasSize(size, want, 'bitmap');
        if (next) {
          resizes += 1;
          size = next;
        }
      }
      expect(resizes).toBe(2);
      expect(size).toEqual(at(1024, 1024));
    });
  });

  describe('canvas mode — the canvas is the visible surface', () => {
    it('matches the request exactly, and shrinks', () => {
      // Unlike bitmap mode: here the canvas is what the user sees, so a buffer
      // that does not match the drawing gets stretched by the compositor.
      expect(nextRenderCanvasSize(at(800, 800), at(400, 400), 'canvas')).toEqual(at(400, 400));
      expect(nextRenderCanvasSize(at(400, 400), at(830, 830), 'canvas')).toEqual(at(830, 830));
    });

    it('does nothing when already exact', () => {
      expect(nextRenderCanvasSize(at(400, 400), at(400, 400), 'canvas')).toBeNull();
    });

    it('never sizes to zero', () => {
      expect(nextRenderCanvasSize(at(0, 0), at(0, 0), 'canvas')).toEqual(at(1, 1));
    });
  });
});

describe("the render viewport keeps the window's shape", () => {
  const aspect = (s: { width: number; height: number }) => s.width / s.height;
  const huge = { width: 100_000, height: 100_000 };

  it("renders at the window's exact size when it fits", () => {
    expect(fitRenderWithin({ width: 257, height: 255 }, huge)).toEqual({ width: 257, height: 255 });
  });

  it('does not round the viewport to a bucket', () => {
    // The bug this replaced: bucketing each axis separately sent a 257x255
    // window to 512x256, and the bitmap is stretched to the window's box on the
    // way to the screen — so the fold appeared twice as wide as it is.
    const fitted = fitRenderWithin({ width: 257, height: 255 }, huge);
    expect(aspect(fitted)).toBeCloseTo(257 / 255, 4);
  });

  it('keeps the aspect when scaling down to a limit', () => {
    const fitted = fitRenderWithin({ width: 3000, height: 1000 }, { width: 2048, height: 1024 });
    expect(aspect(fitted)).toBeCloseTo(3, 2);
    expect(fitted.width).toBeLessThanOrEqual(2048);
    expect(fitted.height).toBeLessThanOrEqual(1024);
  });

  it('never scales up past the requested size', () => {
    expect(fitRenderWithin({ width: 300, height: 200 }, huge)).toEqual({ width: 300, height: 200 });
  });

  it('holds the aspect across every size a zoom passes through', () => {
    // The reported symptom was a flicker between right and wrong as the window
    // crossed a bucket boundary on one axis but not the other.
    for (let w = 120; w < 1400; w += 7) {
      const h = Math.round(w * 0.83);
      const canvas = { width: bitmapCanvasEdge(w), height: bitmapCanvasEdge(h) };
      const fitted = fitRenderWithin({ width: w, height: h }, canvas);
      expect(aspect(fitted)).toBeCloseTo(w / h, 2);
    }
  });

  it('stays inside the canvas it will be cropped from', () => {
    for (let w = 120; w < 4000; w += 31) {
      const h = Math.round(w * 1.6);
      const canvas = { width: bitmapCanvasEdge(w), height: bitmapCanvasEdge(h) };
      const fitted = fitRenderWithin({ width: w, height: h }, canvas);
      expect(fitted.width).toBeLessThanOrEqual(canvas.width);
      expect(fitted.height).toBeLessThanOrEqual(canvas.height);
    }
  });

  it('never exceeds the cap once the canvas is the limit', () => {
    const canvas = { width: MAX_BITMAP_RENDER_EDGE, height: MAX_BITMAP_RENDER_EDGE };
    const fitted = fitRenderWithin({ width: 9000, height: 9000 }, canvas);
    expect(fitted.width).toBe(MAX_BITMAP_RENDER_EDGE);
  });
});
