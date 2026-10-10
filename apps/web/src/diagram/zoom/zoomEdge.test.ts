import { describe, expect, it } from 'vitest';
import type { PicturePoint } from '../annotate/annotationModel';
import { piecesUnder } from '../annotate/behindFlaps';
import type { PictureCover } from '../annotate/pictureGeometry';
import type { DiagramZoomOutline } from '../document/diagramDocument';
import { referencesStep } from '../document/diagramSteps.fixtures';
import { craneStep } from './zoom.fixtures';
import {
  paperSilhouette,
  ZOOM_EDGE_SIDES,
  zoomEdgeDrawn,
  zoomEdgePaths,
  zoomEdgeRing,
  zoomOvershootMm,
  type ZoomEdgeDrawn,
  type ZoomStretch,
} from './zoomEdge';
import { ZOOM_OVERSHOOT } from './zoomModel';

/** A paper of one face, its corners in picture units. */
function paper(...rings: PicturePoint[][]): PictureCover[] {
  return rings.map((ring, order) => {
    const xs = ring.map(([x]) => x);
    const ys = ring.map(([, y]) => y);
    return { ring, order, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const };
  });
}

const SQUARE = paper([
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]);

/** The outline's length, in its units. */
function perimeter(outline: DiagramZoomOutline): number {
  const ring = zoomEdgeRing(outline);
  return ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length]!;
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1]);
  }, 0);
}

function stretches(drawn: ZoomEdgeDrawn): readonly ZoomStretch[] {
  if (drawn.kind !== 'stretches') throw new Error(`drawn ${drawn.kind}`);
  return drawn.stretches;
}

/** Where a share of an outline's length is, walking its ring. */
function pointAt(outline: DiagramZoomOutline, share: number): PicturePoint {
  const ring = zoomEdgeRing(outline);
  const total = perimeter(outline);
  let want = (((share % 1) + 1) % 1) * total;
  for (let index = 0; index < ring.length; index += 1) {
    const [a, b] = [ring[index]!, ring[(index + 1) % ring.length]!];
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (want <= run) return [a[0] + ((b[0] - a[0]) * want) / run, a[1] + ((b[1] - a[1]) * want) / run];
    want -= run;
  }
  return ring[0]!;
}

describe("an enlarged step's boundary", () => {
  describe('look 1: a circle cut where it crosses the paper', () => {
    // The crane's head, as 16d's golden frames it: its tip's circle, printed 50 mm across.
    const crane = craneStep('S.none');
    const silhouette = paperSilhouette(crane, {})!;
    const head: DiagramZoomOutline = { centre: [0.37, 0.13], radius: 0.13 };
    const mmPerUnit = 50 / 0.26;

    it('draws one arc, over the paper and on past each crossing by the overshoot', () => {
      const [arc, ...rest] = stretches(zoomEdgeDrawn(head, 'cut', silhouette, mmPerUnit));
      expect(rest).toEqual([]);
      // Where the circle is over the paper, before it runs on.
      const { pieces, length } = piecesUnder(zoomEdgeRing(head), silhouette, true);
      const over = pieces.filter((piece) => piece.under);
      expect(over).toHaveLength(1);
      const [from, to] = [over[0]!.start / length, over[0]!.end / length];
      // 0.2 of its printed radius, 25 mm: 5 mm, as a share of its printed length.
      const overshoot = zoomOvershootMm(head, mmPerUnit);
      expect(overshoot).toBeCloseTo(5, 9);
      const share = overshoot / mmPerUnit / length;
      expect(arc![0]).toBeCloseTo(from - share, 9);
      expect(arc![1]).toBeCloseTo(to + share, 9);
      // The span: the lower part of the circle, under the head's tip — never the top, where only its point is.
      for (const at of [from, (from + to) / 2, to]) expect(pointAt(head, at)[1]).toBeGreaterThan(head.centre[1]);
    });

    it('runs on 0.2 of its printed radius, never less than 2 mm nor more than 6', () => {
      expect(zoomOvershootMm(head, mmPerUnit)).toBeCloseTo(ZOOM_OVERSHOOT.share * 0.13 * mmPerUnit, 9);
      // Printed tiny, a stub would not read: 2 mm. Printed vast, it would run on round the circle: 6 mm.
      expect(zoomOvershootMm(head, 10)).toBe(ZOOM_OVERSHOOT.minMm);
      expect(zoomOvershootMm(head, 10_000)).toBe(ZOOM_OVERSHOOT.maxMm);
      // A rounded rectangle's printed radius is its shorter half-side.
      expect(zoomOvershootMm({ centre: [0, 0], size: [0.4, 0.2] }, 200)).toBeCloseTo(0.2 * 0.1 * 200, 9);
    });

    it('is drawn as the arc of the circle itself', () => {
      const [d, ...rest] = zoomEdgePaths(head, zoomEdgeDrawn(head, 'cut', silhouette, mmPerUnit));
      expect(rest).toEqual([]);
      expect(d).toMatch(/^M [\d.]+ [\d.]+ A 0\.13 0\.13 0 [01] 1 [\d.]+ [\d.]+$/);
    });
  });

  describe('look 2: a rounded rectangle', () => {
    // Its top-right corner off the paper, as look 2's frame is on both its steps.
    const frame: DiagramZoomOutline = { centre: [0.85, 0.2], size: [0.4, 0.5] };

    it('draws whole, its corner off the paper and all', () => {
      expect(zoomEdgeDrawn(frame, 'whole', SQUARE, 200)).toEqual({ kind: 'whole' });
      const [d, ...rest] = zoomEdgePaths(frame, { kind: 'whole' });
      expect(rest).toEqual([]);
      // Four sides and four quarter circles of 0.22 of its shorter side.
      expect(d!.match(/A 0\.088 0\.088 0 0 1/g)).toHaveLength(4);
      expect(d).toMatch(/Z$/);
    });

    it('cut, breaks where its corner leaves the paper: what look 2 would print broken', () => {
      const [piece, ...rest] = stretches(zoomEdgeDrawn(frame, 'cut', SQUARE, 200));
      expect(rest).toEqual([]);
      // Drawn from where it comes back over the paper, round, to where it leaves it.
      const gap: ZoomStretch = [piece![1], piece![0] + 1];
      const middle = pointAt(frame, (gap[0] + gap[1]) / 2);
      expect(middle[0] > 1 || middle[1] < 0).toBe(true);
      expect(pointAt(frame, (piece![0] + piece![1]) / 2)[0]).toBeLessThan(1);
      // As a run along its sides and round its corners.
      const [d] = zoomEdgePaths(frame, zoomEdgeDrawn(frame, 'cut', SQUARE, 200));
      expect(d).toMatch(/^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+)+$/);
    });
  });

  it('cuts a rounded rectangle turned at an angle along its turned outline', () => {
    // Turned 30°, its middle on the paper's right edge: half of it off the paper.
    const turned: DiagramZoomOutline = { centre: [1, 0.5], size: [0.4, 0.2], angle: 30 };
    const [piece, ...rest] = stretches(zoomEdgeDrawn(turned, 'cut', SQUARE, 200));
    expect(rest).toEqual([]);
    const overshoot = zoomOvershootMm(turned, 200) / 200;
    // Each end lies off the paper by the overshoot, along the turned outline: just right of the edge.
    for (const end of piece!) {
      const [x] = pointAt(turned, end);
      expect(x).toBeGreaterThan(1);
      expect(x).toBeLessThan(1 + overshoot + 1e-9);
    }
    // Its middle is the half over the paper.
    expect(pointAt(turned, (piece![0] + piece![1]) / 2)[0]).toBeLessThan(1);
  });

  it('draws closed when the paper covers 97% of it, the one that lies over paper', () => {
    // Wholly over it.
    expect(zoomEdgeDrawn({ centre: [0.5, 0.5], radius: 0.3 }, 'cut', SQUARE, 200)).toEqual({ kind: 'whole' });
    // Its right side past the paper's edge by 1.6% of its length — 40 mm printed 400 mm across its
    // radius, more than the overshoots and the gap rule close (6 + 6 + 2 mm): whole, as Zach's rule for
    // look 2 says of a frame lying over paper.
    const across = (share: number) => ({ centre: [0.6, 0.5] as PicturePoint, radius: 0.4 / Math.cos(Math.PI * share) });
    expect(zoomEdgeDrawn(across(0.016), 'cut', SQUARE, 1000)).toEqual({ kind: 'whole' });
    // Past it by 6%: cut.
    expect(stretches(zoomEdgeDrawn(across(0.06), 'cut', SQUARE, 1000))).toHaveLength(1);
  });

  it('draws through a gap the overshoots leave under 2 mm, and not a longer one', () => {
    // Two papers with an upright slot between them, the circle across it top and bottom.
    const split = (slot: number) =>
      paper(
        [
          [-5, -5],
          [-slot / 2, -5],
          [-slot / 2, 5],
          [-5, 5],
        ],
        [
          [slot / 2, -5],
          [5, -5],
          [5, 5],
          [slot / 2, 5],
        ]
      );
    // Printed 10 mm in radius: it runs on 2 mm past each side of a slot.
    const circle: DiagramZoomOutline = { centre: [0, 0], radius: 1 };
    expect(zoomOvershootMm(circle, 10)).toBeCloseTo(2, 9);
    // A 5 mm slot leaves 1 mm between the overshoots: drawn through; a 7 mm one leaves 3 mm, top and bottom.
    expect(zoomEdgeDrawn(circle, 'cut', split(0.5), 10)).toEqual({ kind: 'whole' });
    expect(stretches(zoomEdgeDrawn(circle, 'cut', split(0.7), 10))).toHaveLength(2);
  });

  it('draws nothing over no paper; an upload, with no paper to cut along, whole', () => {
    expect(zoomEdgeDrawn({ centre: [3, 3], radius: 0.2 }, 'cut', SQUARE, 200)).toEqual({ kind: 'none' });
    expect(zoomEdgePaths({ centre: [3, 3], radius: 0.2 }, { kind: 'none' })).toEqual([]);
    expect(zoomEdgeDrawn({ centre: [0.5, 0.5], radius: 0.6 }, 'cut', null, 200)).toEqual({ kind: 'whole' });
  });

  it("reads a step's paper: a flat fold's faces as drawn, a References card's sheet and flaps, nothing of an upload", () => {
    const crane = craneStep('S.none');
    // The stored scene keeps its eight faces that show.
    expect(paperSilhouette(crane, {})).toHaveLength(8);
    // Read once per picture.
    expect(paperSilhouette(crane, {})).toBe(paperSilhouette({ ...crane, id: 'another' }, {}));
    const sheet = paperSilhouette(referencesStep('step-references'), {})!;
    expect(sheet[0]!.ring).toEqual([
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
    expect(paperSilhouette({ ...crane, picture: null }, {})).toBeNull();
  });

  it('walks a circle at a ring’s sides', () => {
    expect(zoomEdgeRing({ centre: [0, 0], radius: 1 })).toHaveLength(ZOOM_EDGE_SIDES);
  });
});
