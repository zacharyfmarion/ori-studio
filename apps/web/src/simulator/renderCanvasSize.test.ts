import { describe, expect, it } from 'vitest';
import {
  MAX_BITMAP_RENDER_EDGE,
  bitmapRenderEdge,
  nextRenderCanvasSize,
} from './simulatorSession';

const at = (width: number, height: number) => ({ width, height });

describe('choosing a bitmap render size', () => {
  it('snaps up to the next power of two', () => {
    // Grow-only does nothing for a monotonically increasing sequence, and zooming
    // in is exactly that: every frame wants a few more pixels than the last, so
    // the buffer reallocated every frame anyway — 3.6ms small, 95ms by 8192.
    expect(bitmapRenderEdge(300)).toBe(512);
    expect(bitmapRenderEdge(513)).toBe(1024);
    expect(bitmapRenderEdge(1024)).toBe(1024);
  });

  it('never exceeds the cap', () => {
    // Past what the browser can back, the drawing buffer is silently clamped and
    // every window renders transparent with no error raised anywhere.
    expect(bitmapRenderEdge(4000)).toBe(MAX_BITMAP_RENDER_EDGE);
    expect(bitmapRenderEdge(50_000)).toBe(MAX_BITMAP_RENDER_EDGE);
  });

  it('keeps a floor for a window measured before layout', () => {
    expect(bitmapRenderEdge(0)).toBeGreaterThan(0);
    expect(bitmapRenderEdge(1)).toBe(bitmapRenderEdge(0));
  });

  it('takes at most a handful of steps across the whole range', () => {
    const steps = new Set<number>();
    for (let edge = 1; edge <= 4000; edge += 1) steps.add(bitmapRenderEdge(edge));
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
        if (next) { resizes.push(next.width); size = next; }
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
