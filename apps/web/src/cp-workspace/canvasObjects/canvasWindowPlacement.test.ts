import { describe, expect, it } from 'vitest';
import { canvasWindowPlacement, paintedSize } from './canvasWindowPlacement';

const box = { center: { x: 0, y: 0 }, width: 120, height: 90, rotation: 0 };
const at = (pxPerModel: number, renderedPxPerModel: number) =>
  canvasWindowPlacement({
    box,
    center: { x: 400, y: 300 },
    angle: 0.6,
    pxPerModel,
    renderedPxPerModel,
  });

describe('placing a window under a moving camera', () => {
  it('paints the same size however stale the layout box is', () => {
    // The invariant that decides whether settling *pops*. Layout size times the
    // transform's scale has to be the live size, or the window would jump the
    // moment it re-renders instead of merely sharpening.
    const settled = paintedSize(at(2.5, 2.5));
    for (const rendered of [0.4, 1, 2.5, 6, 17.3]) {
      const midGesture = paintedSize(at(2.5, rendered));
      expect(midGesture.width).toBeCloseTo(settled.width, 9);
      expect(midGesture.height).toBeCloseTo(settled.height, 9);
    }
  });

  it('paints at the live camera scale, not the rendered one', () => {
    expect(paintedSize(at(3, 1)).width).toBeCloseTo(box.width * 3, 9);
  });

  it('lays out at the rendered scale, which is what the bitmap was drawn for', () => {
    // Rendering for one size and laying out at another is what made the window
    // stretch its own picture.
    const placement = at(3, 1);
    expect(placement.width).toBe(box.width * 1);
    expect(placement.height).toBe(box.height * 1);
  });

  it('holds the layout box still while only the camera moves', () => {
    // The whole point: a pan or zoom must not touch a layout-affecting property.
    const a = at(1.2, 2.5);
    const b = at(4.8, 2.5);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(a.transform).not.toBe(b.transform);
  });

  it('is exactly scale(1) once settled, so nothing is resampled at rest', () => {
    expect(at(2.5, 2.5).transform).toContain('scale(1)');
  });

  it('survives a camera scale of zero rather than dividing by it', () => {
    // A window measured before the canvas has laid out reports no scale at all.
    expect(() => at(1, 0)).not.toThrow();
    expect(Number.isFinite(paintedSize(at(1, 0)).width)).toBe(true);
  });
});

/** What the radius paints at on screen, which is what the eye judges. */
const paintedRadius = (placement: ReturnType<typeof at>) => {
  const scale = Number(/scale\(([-\d.e]+)\)/.exec(placement.transform)?.[1] ?? 1);
  return placement.cornerRadius * scale;
};

/** Painted short edge of the window, which is what the chrome is sized against. */
const shortEdge = (pxPerModel: number) => Math.min(box.width, box.height) * pxPerModel;

describe('keeping a window the same shape at every size', () => {
  it('keeps the full radius while the window is comfortably large', () => {
    // The sizes that already read correctly must not change at all.
    expect(paintedRadius(at(4, 4))).toBeCloseTo(6, 9);
    // Exactly at the reference edge, from the stale side: still the flat 6px.
    expect(paintedRadius(at(200 / box.height, 1))).toBeCloseTo(6, 9);
  });

  it('rounds a thumbnail neither into a lozenge nor into a hard square', () => {
    // The two failure modes, both seen: a flat 6px is a third of an 18px window,
    // and a constant *share* of it is sub-pixel and reads as a sharp corner.
    const radius = paintedRadius(at(0.2, 0.2));
    expect(radius).toBeGreaterThan(0.75);
    expect(radius).toBeLessThan(shortEdge(0.2) * 0.1);
  });

  it('rounds a small window proportionally more, not less', () => {
    // What "overcorrected" meant: the corner has to keep gaining share as the
    // window shrinks, or it squares off.
    const share = (pxPerModel: number) =>
      paintedRadius(at(pxPerModel, pxPerModel)) / shortEdge(pxPerModel);
    expect(share(0.2)).toBeGreaterThan(share(0.6));
    expect(share(0.6)).toBeGreaterThan(share(2));
  });

  it('never lets the corner run away with the window', () => {
    // The lozenge bound, stated for every size rather than one sample.
    for (const px of [4, 2, 1, 0.6, 0.3, 0.18, 0.05]) {
      expect(paintedRadius(at(px, px))).toBeLessThan(shortEdge(px) * 0.5);
    }
  });

  it('paints the same radius however stale the layout box is', () => {
    // The settle must sharpen a window, never restyle it: the radius has to be
    // continuous across the moment the layout box catches up.
    const settled = paintedRadius(at(0.3, 0.3));
    for (const rendered of [0.4, 1, 2.5, 6, 17.3]) {
      expect(paintedRadius(at(0.3, rendered))).toBeCloseTo(settled, 9);
    }
  });

  it('survives a camera scale of zero rather than dividing by it', () => {
    expect(Number.isFinite(at(1, 0).cornerRadius)).toBe(true);
  });
});

/** The badge's on-screen scale, which is what has to stay put. */
const paintedBadgeScale = (placement: ReturnType<typeof at>) => {
  const outer = Number(/scale\(([-\d.e]+)\)/.exec(placement.transform)?.[1] ?? 1);
  const inner = Number(/scale\(([-\d.e]+)\)/.exec(placement.badge?.transform ?? '')?.[1] ?? 1);
  return outer * inner;
};

describe('holding a badge still while the camera moves the window', () => {
  it('paints a badge at its declared size whatever the camera is doing', () => {
    // The lag: a badge inherits the window's transform, so mid-gesture it was
    // drawn at whatever scale the stale layout box implied and only corrected
    // when that box caught up.
    for (const rendered of [0.4, 1, 2.5, 6, 17.3]) {
      expect(paintedBadgeScale(at(2.5, rendered))).toBeCloseTo(1, 9);
    }
  });

  it('recovers the inset the window transform took off it', () => {
    // Half scale halves a 6px inset, so the badge asks for the missing 6px back
    // in its own units — which the outer scale then halves into place.
    expect(at(2, 4).badge!.transform).toContain('translate(6px, -6px)');
    expect(at(2, 2).badge!.transform).toContain('translate(0px, 0px)');
  });

  it('fades out rather than popping as the window shrinks', () => {
    const opacityAt = (px: number) => at(px, px).badge?.opacity ?? 0;
    expect(opacityAt(4)).toBe(1);
    expect(opacityAt(1.4)).toBeGreaterThan(0);
    expect(opacityAt(1.4)).toBeLessThan(1);
  });

  it('is gone entirely once the window could not hold it', () => {
    // Null, not transparent: a badge that is never seen should not be in the
    // document being restyled every frame.
    expect(at(0.9, 0.9).badge).toBeNull();
    expect(at(0.2, 0.2).badge).toBeNull();
  });

  it('styles badges with compositor properties only', () => {
    // The load-bearing constraint: anything reaching layout here would wake the
    // canvas's ResizeObserver and re-render the simulation every frame.
    expect(Object.keys(at(2, 4).badge!).sort()).toEqual(['opacity', 'transform']);
  });
});
