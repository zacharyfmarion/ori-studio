import { describe, expect, it } from 'vitest';
import type { Point } from '../../../lib/geometry';
import { bookScene, flatSquareScene } from '../../canvas/foldCanvas.fixtures';
import { polygonArea } from '../../canvas/foldCanvasGeometry';
import { foldPickIndex } from '../../canvas/foldPicking';
import {
  clipToWedges,
  fanGivenCreases,
  fanGivenOnFolded,
  fanRegionAt,
  fanRegionMiddle,
  fanRegionOnFolded,
  fanRegionOnSheet,
  fanRegionWedges,
  fanStayer,
  fanToward,
  type FoldFanGiven,
} from './fanGeometry';
import { incenter } from './vertexStep';

const p = (x: number, y: number): Point => ({ x, y });
const area = (parts: readonly (readonly Point[])[]) => parts.reduce((sum, part) => sum + Math.abs(polygonArea(part)), 0);

/** The owner's case: the triangle above the diagonal from top left to bottom right. */
const TL = p(0, 1);
const TR = p(1, 1);
const BR = p(1, 0);
function ear(): FoldFanGiven {
  const center = incenter([TL, TR, BR]);
  const fan = center ? fanToward(center, [TL, TR, BR]) : null;
  if (!fan) throw new Error('no fan');
  return fan;
}

describe('a fan’s given rays and the regions between them', () => {
  it('runs from the center toward each point, counter-clockwise, and is none with a point on the center or two rays alike', () => {
    const fan = ear();
    const degrees = fan.rays.map(({ x, y }) => (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360);
    // Toward TR (45°), TL (157.5°) and BR (292.5°), from the x axis round.
    [45, 157.5, 292.5].forEach((expected, k) => expect(degrees[k]).toBeCloseTo(expected, 9));
    expect(fanToward(p(0, 0), [p(0, 0), p(1, 0), p(0, 1)])).toBeNull();
    expect(fanToward(p(0, 0), [p(1, 0), p(2, 0), p(0, 1)])).toBeNull();
  });

  it('names the region a point lies in: counter-clockwise from ray k to ray k + 1', () => {
    const fan = ear();
    // Above the incenter, between TR and TL: the triangle's top.
    expect(fanRegionAt(fan, p(0.72, 0.9))).toBe(0);
    // The lower-left half of the square, and the diagonal's side of the triangle.
    expect(fanRegionAt(fan, p(0.3, 0.3))).toBe(1);
    expect(fanRegionAt(fan, p(0.05, 0.05))).toBe(1);
    // Between BR and TR: the triangle's right.
    expect(fanRegionAt(fan, p(0.9, 0.6))).toBe(2);
    expect(fanRegionAt(fan, fan.center)).toBeNull();
    // Each region's middle lies in it.
    for (const k of [0, 1, 2]) {
      const m = fanRegionMiddle(fan, k);
      expect(fanRegionAt(fan, { x: fan.center.x + m.x, y: fan.center.y + m.y })).toBe(k);
    }
  });

  it('cuts a region out of convex paper: one wedge under a half turn, two halves of a wider one', () => {
    const fan = ear();
    expect(fanRegionWedges(fan, 0)).toHaveLength(1);
    // The three regions tile the square.
    const square = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
    const total = [0, 1, 2].reduce((sum, k) => sum + area(clipToWedges(square, fanRegionWedges(fan, k))), 0);
    expect(total).toBeCloseTo(1, 12);
    // The lower-left region holds the whole lower-left half, and the diagonal's sliver of the triangle.
    expect(area(clipToWedges(square, fanRegionWedges(fan, 1)))).toBeGreaterThan(0.5);
    // A swivel's rays may leave a region wider than a half turn: two halves.
    const wide = fanToward(p(0.5, 0.5), [p(1, 0.6), p(0.9, 0.9), p(0.6, 1)]);
    if (!wide) throw new Error('no fan');
    const widest = [0, 1, 2].find((k) => fanRegionWedges(wide, k).length === 2);
    expect(widest).toBeDefined();
    const wideTotal = [0, 1, 2].reduce((sum, k) => sum + area(clipToWedges(square, fanRegionWedges(wide, k))), 0);
    expect(wideTotal).toBeCloseTo(1, 12);
  });

  it('lights a region on the folded form cell by cell, and on the sheet face by face', () => {
    const index = foldPickIndex(flatSquareScene(), null, []);
    const fan = ear();
    const folded = [0, 1, 2].map((k) => area(fanRegionOnFolded(index, fan, k)));
    const sheet = [0, 1, 2].map((k) => area(fanRegionOnSheet(index, fan, k)));
    expect(folded.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // The flat square lies where it is: the same on both panes.
    folded.forEach((each, k) => expect(sheet[k]).toBeCloseTo(each, 12));
    // On the book, the sheet's region is each layer's part, the top one mirrored back.
    const book = foldPickIndex(bookScene(), null, []);
    const center = p(0.25, 0.5);
    const swivel = fanToward(center, [p(0.5, 0.8), p(0, 0.8), p(0.25, 0)]);
    if (!swivel) throw new Error('no fan');
    const up = fanRegionAt(swivel, p(0.25, 0.9))!;
    const onSheet = fanRegionOnSheet(book, swivel, up);
    expect(area(onSheet)).toBeCloseTo(2 * area(fanRegionOnFolded(book, swivel, up)), 12);
    expect(onSheet.some((part) => part.every((q) => q.x >= 0.5 - 1e-9))).toBe(true);
    expect(onSheet.some((part) => part.every((q) => q.x <= 0.5 + 1e-9))).toBe(true);
  });
});

describe('the paper that stays, and the given creases', () => {
  const book = () => foldPickIndex(bookScene(), null, []);
  const swivel = () => {
    const fan = fanToward(p(0.25, 0.5), [p(0.5, 0.8), p(0, 0.8), p(0.25, 0)]);
    if (!fan) throw new Error('no fan');
    return fan;
  };

  it('names a region by a point inside it near the center, on the farthest layer the fan cuts', () => {
    const index = book();
    const fan = swivel();
    const up = fanRegionAt(fan, p(0.25, 0.9))!;
    const at = (layers: number | null, direction: 'valley' | 'mountain') => {
      const stayer = fanStayer(index, fan, up, direction, layers);
      return stayer && [Number(stayer[0].toFixed(9)), Number(stayer[1].toFixed(9))];
    };
    // Straight up from (¼, ½), half way to the top edge: on the bottom layer for a valley through every layer…
    expect(at(null, 'valley')).toEqual([0.25, 0.75]);
    // …the top one, mirrored, through only the top; the top again for a mountain through every layer.
    expect(at(1, 'valley')).toEqual([0.75, 0.75]);
    expect(at(null, 'mountain')).toEqual([0.75, 0.75]);
    expect(at(1, 'mountain')).toEqual([0.25, 0.75]);
    // Off the paper: none.
    const off = fanToward(p(0.75, 0.5), [p(1, 0.8), p(0.5, 0.8), p(0.75, 0)]);
    if (!off) throw new Error('no fan');
    expect(fanStayer(index, off, 0, 'valley', null)).toBeNull();
  });

  it('runs each given crease to where each layer cut ends, its letter from the front by which way the layer faces', () => {
    const index = book();
    const fan = swivel();
    const pieces = fanGivenCreases(index, fan, 'valley', null);
    // Three rays through two layers.
    expect(pieces).toHaveLength(6);
    for (const piece of pieces) expect(piece.scene[0]).toEqual(fan.center);
    // The bottom layer faces the viewer: valley from its front; the top is
    // seen from its back: mountain from its front, and mirrored on the sheet.
    const down = pieces.filter((piece) => piece.ray === fan.rays.findIndex((r) => r.y < -0.99));
    expect(down.map((piece) => piece.letter).sort()).toEqual(['mountain', 'valley']);
    const top = down.find((piece) => piece.letter === 'mountain')!;
    expect(top.sheet[0].x).toBeCloseTo(0.75, 12);
    expect(top.sheet[1].x).toBeCloseTo(0.75, 12);
    expect(top.sheet[1].y).toBeCloseTo(0, 12);
    // Only the top layer: only its creases.
    expect(fanGivenCreases(index, fan, 'valley', 1).every((piece) => piece.letter === 'mountain')).toBe(true);
    // The folded pane shows one per ray, as far as any layer reaches.
    expect(fanGivenOnFolded(pieces)).toHaveLength(3);
  });

  it('runs the owner’s bisectors from the incenter to the corners on the flat square', () => {
    const index = foldPickIndex(flatSquareScene(), null, []);
    const fan = ear();
    const pieces = fanGivenCreases(index, fan, 'mountain', null);
    expect(pieces).toHaveLength(3);
    const ends = pieces.map((piece) => piece.scene[1]);
    for (const corner of [TL, TR, BR]) {
      expect(ends.some((end) => Math.hypot(end.x - corner.x, end.y - corner.y) < 1e-9)).toBe(true);
    }
    expect(pieces.every((piece) => piece.letter === 'mountain')).toBe(true);
  });
});
