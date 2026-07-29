import { describe, expect, it } from 'vitest';
import { inlineSimulationPlacement, paintedSize } from './inlineSimulationPlacement';

const box = { center: { x: 0, y: 0 }, width: 120, height: 90, rotation: 0 };
const at = (pxPerModel: number, renderedPxPerModel: number) =>
  inlineSimulationPlacement({
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
