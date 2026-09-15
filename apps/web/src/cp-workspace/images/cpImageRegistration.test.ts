import { describe, expect, it } from 'vitest';
import { quadIsAxisAligned, registerImageOntoPaper } from './cpImageRegistration';

const square = (x0: number, y0: number, x1: number, y1: number) => ({
  top_left: { x: x0, y: y0 },
  top_right: { x: x1, y: y0 },
  bottom_right: { x: x1, y: y1 },
  bottom_left: { x: x0, y: y1 },
});

describe('quadIsAxisAligned', () => {
  it('accepts an upright rectangle and a hair of lean', () => {
    expect(quadIsAxisAligned(square(100, 100, 900, 900))).toBe(true);
    const leaning = square(100, 100, 900, 900);
    leaning.top_right.y = 104; // 0.5% of 800
    expect(quadIsAxisAligned(leaning)).toBe(true);
  });

  it('rejects a rotated or skewed outline, and a degenerate one', () => {
    const rotated = {
      top_left: { x: 500, y: 100 },
      top_right: { x: 900, y: 500 },
      bottom_right: { x: 500, y: 900 },
      bottom_left: { x: 100, y: 500 },
    };
    expect(quadIsAxisAligned(rotated)).toBe(false);
    const skewed = square(100, 100, 900, 900);
    skewed.bottom_left.x = 140; // 5% of 800
    expect(quadIsAxisAligned(skewed)).toBe(false);
    expect(quadIsAxisAligned(square(5, 5, 5, 5))).toBe(false);
  });
});

describe('registerImageOntoPaper', () => {
  it('scales and moves the image so the paper outline lands on the paper', () => {
    const patch = registerImageOntoPaper({
      source: { width: 1000, height: 1000 },
      quad: square(100, 100, 900, 900),
      paper: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
    });
    // 800 source px of paper -> 400 model units: half scale; the image's left
    // edge sits 100 source px = 50 model units left of the paper.
    expect(patch).toEqual({ center: { x: 200, y: 200 }, width: 500, height: 500, rotation: 0 });
  });

  it('handles a non-square source and a paper placed away from the origin', () => {
    const patch = registerImageOntoPaper({
      source: { width: 1200, height: 800 },
      quad: square(200, 0, 1000, 800),
      paper: { minX: 1000, minY: -200, maxX: 1400, maxY: 200 },
    });
    if (!patch) throw new Error('expected a patch');
    expect(patch.width).toBe(600);
    expect(patch.height).toBe(400);
    // Paper left is 1000; the quad starts 200 px in, i.e. 100 units: the image's left edge is 900.
    expect(patch.center).toEqual({ x: 900 + 300, y: -200 + 200 });
  });

  it('refuses a degenerate quad or source', () => {
    expect(
      registerImageOntoPaper({
        source: { width: 1000, height: 1000 },
        quad: square(50, 50, 50, 50),
        paper: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
      })
    ).toBeNull();
    expect(
      registerImageOntoPaper({
        source: { width: 0, height: 1000 },
        quad: square(0, 0, 10, 10),
        paper: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
      })
    ).toBeNull();
  });
});
