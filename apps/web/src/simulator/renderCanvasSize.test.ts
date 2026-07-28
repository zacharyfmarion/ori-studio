import { describe, expect, it } from 'vitest';
import { nextRenderCanvasSize } from './simulatorSession';

const at = (width: number, height: number) => ({ width, height });

describe('sizing the shared render canvas', () => {
  describe('bitmap mode — the canvas is scratch, shared by every window', () => {
    it('does not resize for a smaller request', () => {
      // The whole point. Reallocating a drawing buffer costs ~2.2ms and stalls
      // the GPU process, and windows of different sizes take turns on this one
      // canvas — so honouring each request meant paying it on every message.
      expect(nextRenderCanvasSize(at(640, 640), at(240, 240), 'bitmap')).toBeNull();
    });

    it('does not resize for the same request', () => {
      expect(nextRenderCanvasSize(at(640, 640), at(640, 640), 'bitmap')).toBeNull();
    });

    it('grows to fit a larger request', () => {
      expect(nextRenderCanvasSize(at(240, 240), at(512, 512), 'bitmap')).toEqual(at(512, 512));
    });

    it('grows on one axis without shrinking the other', () => {
      // A tall narrow window after a short wide one must not give back width.
      expect(nextRenderCanvasSize(at(640, 200), at(300, 480), 'bitmap')).toEqual(at(640, 480));
    });

    it('settles after the largest window has been seen', () => {
      // Three windows taking turns: one growth, then nothing forever, which is
      // what makes window size stop being a performance variable.
      let size = at(1, 1);
      const resizes: Array<{ width: number; height: number }> = [];
      for (let i = 0; i < 30; i += 1) {
        const want = [at(240, 240), at(520, 520), at(380, 380)][i % 3]!;
        const next = nextRenderCanvasSize(size, want, 'bitmap');
        if (next) { resizes.push(next); size = next; }
      }
      expect(resizes).toEqual([at(240, 240), at(520, 520)]);
      expect(size).toEqual(at(520, 520));
    });
  });

  describe('canvas mode — the canvas is the visible surface', () => {
    it('shrinks to match, unlike bitmap mode', () => {
      // The transferred canvas is what the user sees; a buffer larger than the
      // drawing gets stretched across it by the compositor.
      expect(nextRenderCanvasSize(at(800, 800), at(400, 400), 'canvas')).toEqual(at(400, 400));
    });

    it('grows to match', () => {
      expect(nextRenderCanvasSize(at(400, 400), at(800, 800), 'canvas')).toEqual(at(800, 800));
    });

    it('does nothing when already exact', () => {
      expect(nextRenderCanvasSize(at(400, 400), at(400, 400), 'canvas')).toBeNull();
    });
  });

  it('never sizes to zero', () => {
    // A window measured before layout reports 0; a zero-sized drawing buffer is
    // a GL error rather than an empty picture.
    expect(nextRenderCanvasSize(at(0, 0), at(0, 0), 'canvas')).toEqual(at(1, 1));
    expect(nextRenderCanvasSize(at(1, 1), at(0, 0), 'bitmap')).toBeNull();
  });

  it('floors fractional requests', () => {
    // Device pixels are integers; a fractional width would silently truncate at
    // the canvas and desync the crop rect from what was drawn.
    expect(nextRenderCanvasSize(at(1, 1), at(300.7, 300.2), 'bitmap')).toEqual(at(300, 300));
  });
});
