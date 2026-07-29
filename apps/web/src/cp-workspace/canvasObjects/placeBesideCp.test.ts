import { describe, expect, it } from 'vitest';
import { boxAabb, firstFreeSlotBeside } from './placeBesideCp';

const ANCHOR = { right: 100, top: 0 };
const GAP = 10;

function place(width: number, height: number, blockers: Array<[number, number, number, number]>) {
  return firstFreeSlotBeside({
    anchor: ANCHOR,
    width,
    height,
    gap: GAP,
    blockers: blockers.map(([minX, minY, maxX, maxY]) => ({ minX, minY, maxX, maxY })),
  });
}

describe('parking beside the crease pattern', () => {
  it('parks just right of the anchor when nothing is in the way', () => {
    expect(place(50, 50, [])).toEqual({ left: 110, top: 0 });
  });

  it('aligns to the anchor top, so repeated objects read as a row', () => {
    expect(place(50, 20, []).top).toBe(0);
    expect(place(50, 90, []).top).toBe(0);
  });

  it('moves past something occupying the slot', () => {
    // Blocker spans x 100..200 in the same band, so the slot starts after it.
    expect(place(50, 50, [[100, 0, 200, 50]]).left).toBe(210);
  });

  it('ignores something parked above or below the band', () => {
    // Far below: not in the way, and treating it as if it were is what flings a
    // new object off to the right.
    expect(place(50, 50, [[100, 500, 200, 560]]).left).toBe(110);
  });

  it('reuses a hole left in the middle of a row', () => {
    // Two blockers with a wide gap between them: the scan takes the gap rather
    // than jumping past everything, so deleting from a row does not make the
    // next object march off to the right forever.
    expect(place(50, 50, [[100, 0, 150, 50], [400, 0, 450, 50]]).left).toBe(160);
  });

  it('skips a hole that is too narrow', () => {
    // Only 20 wide between them, and 50 is needed.
    expect(place(50, 50, [[100, 0, 150, 50], [180, 0, 250, 50]]).left).toBe(260);
  });

  it('is unaffected by blocker ordering', () => {
    const ordered = place(50, 50, [[100, 0, 150, 50], [180, 0, 250, 50]]);
    const reversed = place(50, 50, [[180, 0, 250, 50], [100, 0, 150, 50]]);
    expect(reversed).toEqual(ordered);
  });

  it('counts a blocker that only clips the band', () => {
    // Overlaps the band's last few units, so it still blocks.
    expect(place(50, 50, [[100, 45, 200, 90]]).left).toBe(210);
  });
});

describe('boxAabb', () => {
  it('encloses an unrotated box', () => {
    expect(boxAabb({ center: { x: 10, y: 20 }, width: 4, height: 6, rotation: 0 })).toEqual({
      minX: 8,
      minY: 17,
      maxX: 12,
      maxY: 23,
    });
  });

  it('encloses a rotated box by its corners', () => {
    // A square turned 45 degrees needs a box its diagonal wide, not its side.
    const aabb = boxAabb({
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      rotation: Math.PI / 4,
    });
    expect(aabb.maxX).toBeCloseTo(Math.SQRT2, 6);
    expect(aabb.minX).toBeCloseTo(-Math.SQRT2, 6);
  });
});
