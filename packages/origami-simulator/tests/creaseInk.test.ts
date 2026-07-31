import { describe, expect, it } from 'vitest';
import {
  creaseFrameScale,
  rasterCreaseInk,
  type RenderSettings,
} from '../src/webgl/meshRenderer.js';

/**
 * How heavy a crease is drawn, given the frame it lands in.
 *
 * The rule these encode: a viewport keeps a constant on-screen weight, an object
 * keeps a constant share of the paper. Everything below is the second case,
 * which is what an inline simulation window is.
 */
function settings(overrides: Partial<RenderSettings> = {}): RenderSettings {
  return {
    frontColor: [1, 1, 0],
    backColor: [1, 1, 1],
    mountainColor: [1, 0, 0],
    valleyColor: [0, 0, 1],
    borderColor: [0, 0, 0],
    lightDir: [0, 0, 1],
    background: [0, 0, 0],
    showFaces: true,
    showEdges: true,
    lighting: true,
    creaseWidthPx: 2.2,
    faceAlpha: 1,
    ...overrides,
  };
}

describe('scaling crease weight to its frame', () => {
  it('leaves a crease alone when no reference edge is set', () => {
    // The Simulate workspace: a pane is a window onto the fold, and its linework
    // should not thin because the pane got narrower.
    expect(creaseFrameScale(settings(), 64, 64)).toBe(1);
    expect(creaseFrameScale(settings(), 2048, 2048)).toBe(1);
  });

  it('leaves a frame at or above the reference alone', () => {
    const config = settings({ creaseWidthReferenceEdge: 512 });
    expect(creaseFrameScale(config, 512, 512)).toBe(1);
    expect(creaseFrameScale(config, 2048, 2048)).toBe(1);
  });

  it('shrinks in lockstep with the frame below the reference', () => {
    const config = settings({ creaseWidthReferenceEdge: 512 });
    expect(creaseFrameScale(config, 256, 256)).toBeCloseTo(0.5, 10);
    expect(creaseFrameScale(config, 128, 128)).toBeCloseTo(0.25, 10);
  });

  it('measures the short edge, which is what the model is fitted to', () => {
    const config = settings({ creaseWidthReferenceEdge: 512 });
    expect(creaseFrameScale(config, 1024, 128)).toBeCloseTo(0.25, 10);
  });

  it('takes an exponent, so the rule can be dialled between the two extremes', () => {
    const frame = 128;
    const constant = settings({ creaseWidthReferenceEdge: 512, creaseWidthShrinkExponent: 0 });
    const partial = settings({ creaseWidthReferenceEdge: 512, creaseWidthShrinkExponent: 0.5 });
    expect(creaseFrameScale(constant, frame, frame)).toBe(1);
    expect(creaseFrameScale(partial, frame, frame)).toBeCloseTo(0.5, 10);
  });

  it('ignores a degenerate frame rather than dividing by it', () => {
    const config = settings({ creaseWidthReferenceEdge: 512 });
    expect(creaseFrameScale(config, 0, 0)).toBe(1);
    expect(creaseFrameScale(settings({ creaseWidthReferenceEdge: 0 }), 64, 64)).toBe(1);
  });
});

describe('the width and opacity a rasterizer draws creases at', () => {
  it('draws the scaled width outright while it is still a pixel wide', () => {
    const config = settings({ creaseWidthReferenceEdge: 512 });
    const ink = rasterCreaseInk(config, 256, 256);
    expect(ink.widthPx).toBeCloseTo(1.1, 10);
    expect(ink.alpha).toBe(1);
  });

  it('pins a sub-pixel crease at one pixel and takes the rest out of alpha', () => {
    // Shrinking the geometry alone would flicker: a sub-pixel ribbon lands on a
    // sample or misses depending where it falls.
    const config = settings({ creaseWidthReferenceEdge: 512 });
    const ink = rasterCreaseInk(config, 128, 128);
    expect(ink.widthPx).toBe(1);
    expect(ink.alpha).toBeCloseTo(0.55, 10);
  });

  it('keeps thinning the whole way down rather than pinning at the floor', () => {
    // The ink a crease lays down — width times opacity — has to keep tracking
    // the frame, or a window would fatten again at the bottom of its range.
    const config = settings({ creaseWidthReferenceEdge: 512 });
    const inkAt = (edge: number) => {
      const { widthPx, alpha } = rasterCreaseInk(config, edge, edge);
      return widthPx * alpha;
    };
    expect(inkAt(64) / inkAt(128)).toBeCloseTo(0.5, 10);
    expect(inkAt(32) / inkAt(64)).toBeCloseTo(0.5, 10);
  });

  it('never fades a crease that is wide enough to draw', () => {
    expect(rasterCreaseInk(settings(), 2048, 2048).alpha).toBe(1);
    expect(rasterCreaseInk(settings({ creaseWidthPx: 0.5 }), 2048, 2048)).toEqual({
      widthPx: 1,
      alpha: 0.5,
    });
  });
});
