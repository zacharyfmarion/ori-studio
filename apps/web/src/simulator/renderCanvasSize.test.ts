import { describe, expect, it } from 'vitest';
import {
  MAX_BITMAP_RENDER_EDGE,
  bitmapCanvasEdge,
  fitRenderWithin,
  nextRenderCanvasSize,
  renderCanvasResize,
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
      expect(nextRenderCanvasSize({
        current: at(1024, 1024),
        requested: at(240, 240),
        mode: 'bitmap',
      })).toBeNull();
    });

    it('does not resize across a whole zoom within one bucket', () => {
      // The regression this exists for: every one of these used to reallocate.
      for (let edge = 520; edge <= 1024; edge += 4) {
        expect(nextRenderCanvasSize({
          current: at(1024, 1024),
          requested: at(edge, edge),
          mode: 'bitmap',
        })).toBeNull();
      }
    });

    it('grows to the bucket, not to the request', () => {
      expect(nextRenderCanvasSize({
        current: at(256, 256),
        requested: at(300, 300),
        mode: 'bitmap',
      })).toEqual(at(512, 512));
    });

    it('grows on one axis without shrinking the other', () => {
      expect(nextRenderCanvasSize({
        current: at(1024, 256),
        requested: at(300, 480),
        mode: 'bitmap',
      })).toEqual(at(1024, 512));
    });

    it('stops growing at the cap however far you zoom', () => {
      let size = at(128, 128);
      const resizes: number[] = [];
      // A fast zoom in: the request climbs without bound.
      for (let edge = 130; edge <= 12_000; edge += 37) {
        const next = nextRenderCanvasSize({
          current: size,
          requested: at(edge, edge),
          mode: 'bitmap',
        });
        if (next) { resizes.push(next.width); size = next; }
      }
      expect(resizes).toEqual([256, 512, 1024, MAX_BITMAP_RENDER_EDGE]);
      expect(size.width).toBe(MAX_BITMAP_RENDER_EDGE);
    });

    it('hands the buffer back when asked, once nobody needs it', () => {
      // Why this is worth a reallocation. The buffer is only read through
      // `createImageBitmap`, and with `preserveDrawingBuffer: false` that
      // obliges the browser to clear the whole of it before the next draw — a
      // clear that is the browser's, so no scissor of ours bounds it, and that
      // is charged per render for as long as the buffer stays big. Measured in
      // WebKit: 234x234 windows drawing into a 2048x2048 buffer cost ~7ms a
      // render against 0.69ms at 512x512. Grow-only paid that forever after one
      // deep zoom.
      expect(nextRenderCanvasSize({
        current: at(2048, 2048),
        requested: at(234, 234),
        mode: 'bitmap',
        allowShrink: true,
      })).toEqual(at(256, 256));
    });

    it('shrinks only when asked, so a caller that cannot see the other windows does not', () => {
      // The buffer is shared. A window sizing it by its own request alone would
      // thrash it against a larger sibling on every message, which is the
      // regression the grow-only rule was introduced to remove.
      expect(nextRenderCanvasSize({
        current: at(2048, 2048),
        requested: at(234, 234),
        mode: 'bitmap',
      })).toBeNull();
    });

    it('still does not resize when the request is already the right bucket', () => {
      // Shrinking must not mean resizing on every render: 500 and 512 are the
      // same bucket, so there is nothing to hand back.
      expect(nextRenderCanvasSize({
        current: at(512, 512),
        requested: at(500, 500),
        mode: 'bitmap',
        allowShrink: true,
      })).toBeNull();
    });

    it('settles once the largest window has been seen', () => {
      let size = at(1, 1);
      let resizes = 0;
      for (let i = 0; i < 60; i += 1) {
        const want = [at(240, 240), at(520, 520), at(380, 380)][i % 3]!;
        const next = nextRenderCanvasSize({ current: size, requested: want, mode: 'bitmap' });
        if (next) { resizes += 1; size = next; }
      }
      expect(resizes).toBe(2);
      expect(size).toEqual(at(1024, 1024));
    });
  });

  describe('canvas mode — the canvas is the visible surface', () => {
    it('matches the request exactly, and shrinks', () => {
      // Unlike bitmap mode: here the canvas is what the user sees, so a buffer
      // that does not match the drawing gets stretched by the compositor.
      expect(nextRenderCanvasSize({
        current: at(800, 800),
        requested: at(400, 400),
        mode: 'canvas',
      })).toEqual(at(400, 400));
      expect(nextRenderCanvasSize({
        current: at(400, 400),
        requested: at(830, 830),
        mode: 'canvas',
      })).toEqual(at(830, 830));
    });

    it('does nothing when already exact', () => {
      expect(nextRenderCanvasSize({
        current: at(400, 400),
        requested: at(400, 400),
        mode: 'canvas',
      })).toBeNull();
    });

    it('never sizes to zero', () => {
      expect(nextRenderCanvasSize({
        current: at(0, 0),
        requested: at(0, 0),
        mode: 'canvas',
      })).toEqual(at(1, 1));
    });
  });
});

describe('the render viewport keeps the window\'s shape', () => {
  const aspect = (s: { width: number; height: number }) => s.width / s.height;
  const huge = { width: 100_000, height: 100_000 };

  it('renders at the window\'s exact size when it fits', () => {
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

describe('the resize policy as the session actually applies it', () => {
  // The tests above set `allowShrink` themselves, which proves the leaf handles
  // it and nothing about whether anything ever asks. These drive the policy the
  // way `sizeRenderCanvas` does, so a shrink that is unreachable in practice
  // fails here rather than passing everywhere.
  const policy = (over: Partial<Parameters<typeof renderCanvasResize>[0]> = {}) =>
    renderCanvasResize({
      current: at(2048, 2048),
      callerRequest: at(234, 234),
      peak: at(234, 234),
      mode: 'bitmap',
      msSinceResize: 10_000,
      ...over,
    });

  it('hands the buffer back once every window is small and the hold has passed', () => {
    // The reported bug, end to end: zoom in far, zoom back out, and the buffer
    // stops being charged for the zoom.
    expect(policy()).toEqual(at(256, 256));
  });

  it('keeps the buffer while the hold is still running', () => {
    // Otherwise a zoom-out reallocates once per frame of the gesture, which is
    // the thrash grow-only was introduced to remove.
    expect(policy({ msSinceResize: 100 })).toBeNull();
  });

  it('keeps the buffer for a small window while a large one is still open', () => {
    // The buffer is shared. Sizing it to whoever is drawing right now is how two
    // windows of different sizes thrash it against each other.
    expect(policy({ peak: at(1800, 1800) })).toBeNull();
  });

  it('grows for the caller immediately, without waiting out the hold', () => {
    // A window that needs more pixels gets them on the frame it asks, even mid
    // gesture — only shrinking waits.
    expect(
      policy({ current: at(256, 256), callerRequest: at(900, 900), msSinceResize: 0 })
    ).toEqual(at(1024, 1024));
  });

  it('does not collapse to the floor before any window has a size', () => {
    // `peakRequestedSize` reports zeros when no session has been given a size
    // yet, and taking that literally would size the buffer to the minimum and
    // then immediately regrow it.
    expect(policy({ peak: at(0, 0), callerRequest: at(1500, 1500) })).toBeNull();
  });

  it('ignores the peak in canvas mode, where the buffer is the visible surface', () => {
    // It must match the drawing exactly or the compositor stretches it, and
    // there is one consumer — so the caller's request wins over any other
    // window's, whatever the peak says.
    expect(
      policy({ mode: 'canvas', callerRequest: at(400, 400), peak: at(2048, 2048) })
    ).toEqual(at(400, 400));
  });
});
