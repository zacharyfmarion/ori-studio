import { describe, expect, it } from 'vitest';
import { findVisiblePieces, type DrawnPiece } from '../src/hiddenPieces.js';

const PAGE = { minX: 0, minY: 0, width: 100, height: 100 };

/** A square, as a filled polygon. */
function square(x: number, y: number, size: number): DrawnPiece {
  return {
    points: [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ],
    strokeWidth: 0,
  };
}

describe('finding the pieces nothing shows', () => {
  it('drops a piece a later one covers completely', () => {
    const visible = findVisiblePieces([square(20, 20, 20), square(10, 10, 40)], PAGE);
    expect(visible).toEqual([false, true]);
  });

  it('keeps a piece a later one only partly covers', () => {
    const visible = findVisiblePieces([square(10, 10, 40), square(30, 30, 40)], PAGE);
    expect(visible).toEqual([true, true]);
  });

  it('keeps the coverer and the covered when the order is the other way round', () => {
    // Nothing about being small or being first hides a piece — only being under
    // something drawn after it.
    const visible = findVisiblePieces([square(10, 10, 40), square(20, 20, 20)], PAGE);
    expect(visible).toEqual([true, true]);
  });

  it('drops a crease buried under a face', () => {
    const crease: DrawnPiece = { points: [[20, 30], [40, 30]], strokeWidth: 2 };
    expect(findVisiblePieces([crease, square(10, 10, 40)], PAGE)).toEqual([false, true]);
  });

  it('keeps a crease that runs out from under a face', () => {
    const crease: DrawnPiece = { points: [[20, 30], [80, 30]], strokeWidth: 2 };
    expect(findVisiblePieces([crease, square(10, 10, 40)], PAGE)).toEqual([true, true]);
  });

  it('counts a crease by the stroke it draws, not by its centreline', () => {
    // The covering face stops just short of the crease's centreline, so the
    // centreline alone would call it hidden while half the stroke still shows.
    const crease: DrawnPiece = { points: [[20, 50], [60, 50]], strokeWidth: 6 };
    const face = square(10, 10, 40); // covers y up to 50
    expect(findVisiblePieces([crease, face], PAGE)).toEqual([true, true]);
  });

  it('drops nothing when nothing overlaps', () => {
    const visible = findVisiblePieces([square(5, 5, 20), square(60, 60, 20)], PAGE);
    expect(visible).toEqual([true, true]);
  });

  it('sees a piece that shows through a gap between two others', () => {
    // The classic painter's-order trap: two coverers that individually leave the
    // piece visible and together nearly bury it. Nearly is not buried.
    const buried = square(20, 20, 40);
    const left = square(10, 10, 25);
    const right = square(45, 10, 25);
    expect(findVisiblePieces([buried, left, right], PAGE)).toEqual([true, true, true]);
  });

  it('handles an empty drawing and degenerate pieces', () => {
    expect(findVisiblePieces([], PAGE)).toEqual([]);
    const degenerate: DrawnPiece[] = [
      { points: [[10, 10]], strokeWidth: 0 },
      { points: [[10, 10], [10, 10]], strokeWidth: 0 },
      { points: [[20, 20], [20, 20]], strokeWidth: 2 },
    ];
    const visible = findVisiblePieces(degenerate, PAGE);
    expect(visible.slice(0, 2)).toEqual([false, false]);
    // A zero-length stroke still draws its round cap, so it is genuinely there.
    expect(visible[2]).toBe(true);
  });

  it('leaves pieces off the page out of the reckoning', () => {
    const visible = findVisiblePieces([square(-500, -500, 20), square(10, 10, 20)], PAGE);
    expect(visible).toEqual([false, true]);
  });

  it('respects the page offset', () => {
    // The page is a crop of a larger drawing, so a piece is placed by the
    // viewBox origin rather than by zero.
    const offset = { minX: 1000, minY: 2000, width: 100, height: 100 };
    expect(findVisiblePieces([square(1010, 2010, 20)], offset)).toEqual([true]);
    expect(findVisiblePieces([square(10, 20, 20)], offset)).toEqual([false]);
  });
});
