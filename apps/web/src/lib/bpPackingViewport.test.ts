import { describe, expect, it } from 'vitest';
import type {
  OristudioBpArcPath,
  OristudioBpSheet,
  OristudioBpSheetKind,
} from '../engine/oristudioBpTypes';
import {
  bpArcPathThickness,
  bpArcPathToSvgPath,
  bpPackingCanResizeFlap,
  bpPackingFlapClearanceRect,
  bpPackingGridLines,
  bpPackingPaperRect,
  bpPackingPointToSvg,
  bpPackingSheetBorderPoints,
  bpPackingSheetContains,
  bpPackingSheetFrame,
  bpPackingSvgToPoint,
} from './bpPackingViewport';

function sheet(kind: OristudioBpSheetKind, width: number, height = width): OristudioBpSheet {
  return {
    kind,
    width,
    height,
    grid: { kind, interval: 1, snap: true },
  };
}

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('bpPackingSheetFrame', () => {
  it('spans [0,width]×[0,height] for a rectangular sheet', () => {
    expect(bpPackingSheetFrame(sheet('rectangular', 8, 12))).toEqual({
      originX: 0,
      originY: 0,
      spanX: 8,
      spanY: 12,
    });
  });

  it('uses the render box for an even diagonal sheet (no shift)', () => {
    expect(bpPackingSheetFrame(sheet('diagonal', 16))).toEqual({
      originX: 0,
      originY: 0,
      spanX: 16,
      spanY: 16,
    });
  });

  it('shifts the origin a half cell for an odd diagonal sheet', () => {
    // renderWidth = size + 1, origin shifted -1/2 on each axis.
    expect(bpPackingSheetFrame(sheet('diagonal', 15))).toEqual({
      originX: -0.5,
      originY: -0.5,
      spanX: 16,
      spanY: 16,
    });
  });
});

describe('bpPackingSheetBorderPoints', () => {
  it('returns the four paper-rect corners for a rectangular sheet', () => {
    const s = sheet('rectangular', 10);
    const rect = bpPackingPaperRect(s);
    const pts = bpPackingSheetBorderPoints(s, rect);
    expect(pts).toEqual([
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ]);
  });

  it('returns a diamond inscribed in the paper rect for an even diagonal sheet', () => {
    const s = sheet('diagonal', 16);
    const rect = bpPackingPaperRect(s);
    const pts = bpPackingSheetBorderPoints(s, rect);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    // Its four vertices land on the edge midpoints of the paper rect — the square
    // rotated 45°. Order-independent so we don't couple to the Y-flip winding.
    const midpoints = [
      { x: cx, y: rect.y },
      { x: rect.x + rect.width, y: cy },
      { x: cx, y: rect.y + rect.height },
      { x: rect.x, y: cy },
    ];
    expect(pts).toHaveLength(4);
    for (const mid of midpoints) {
      expect(pts.some((p) => approx(p.x, mid.x) && approx(p.y, mid.y))).toBe(true);
    }
  });
});

describe('bpPackingGridLines (diagonal)', () => {
  it('emits only clipped horizontal/vertical lines — no overlay diagonals', () => {
    const s = sheet('diagonal', 16);
    const lines = bpPackingGridLines(s);
    expect(lines.length).toBeGreaterThan(0);
    // The diamond grid keeps orthogonal lines (clipped to the diamond); none carry
    // the legacy 'diagonal' kind that the old overlay used.
    expect(lines.every((line) => line.kind !== 'diagonal')).toBe(true);
  });

  it('tapers line spans toward the corners (widest across the middle)', () => {
    const s = sheet('diagonal', 16);
    const rect = bpPackingPaperRect(s);
    const lines = bpPackingGridLines(s, rect);
    const spanOf = (id: string) => {
      const line = lines.find((l) => l.id === id)!;
      return Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y);
    };
    // The middle horizontal line (y=8) spans the full diamond width; an edge line
    // (y=1) is much shorter.
    expect(spanOf('dh:8')).toBeGreaterThan(spanOf('dh:1'));
  });
});

describe('bpPackingFlapClearanceRect', () => {
  const s = sheet('rectangular', 16);
  const unit = bpPackingPaperRect(s).width / 16;

  it('grows a zero-size flap into a circle of its radius', () => {
    const clearance = bpPackingFlapClearanceRect(
      { anchor: { x: 8, y: 8 }, width: 0, height: 0, radius: 3 },
      s
    );
    expect(approx(clearance.width, 6 * unit)).toBe(true);
    expect(approx(clearance.height, 6 * unit)).toBe(true);
    // A full circle: the corner radius is half of each side.
    expect(approx(clearance.radius, clearance.width / 2)).toBe(true);
  });

  it('grows a sized flap on every side, keeping the corner radius', () => {
    const clearance = bpPackingFlapClearanceRect(
      { anchor: { x: 4, y: 4 }, width: 2, height: 2, radius: 3 },
      s
    );
    const rect = bpPackingPaperRect(s);
    // Grid (1,1)..(9,9) — the flap rect grown by 3 on each side.
    expect(approx(clearance.x, bpPackingPointToSvg({ x: 1, y: 1 }, s, rect).x)).toBe(true);
    expect(approx(clearance.y, bpPackingPointToSvg({ x: 1, y: 9 }, s, rect).y)).toBe(true);
    expect(approx(clearance.width, 8 * unit)).toBe(true);
    expect(approx(clearance.height, 8 * unit)).toBe(true);
    expect(approx(clearance.radius, 3 * unit)).toBe(true);
  });
});

describe('bpArcPathToSvgPath', () => {
  const s = sheet('rectangular', 8);
  const lens: OristudioBpArcPath = [
    { x: 2, y: 2, arc: { x: 1, y: 3 }, r: 1 },
    { x: 3, y: 3, arc: { x: 4, y: 2 }, r: 1 },
  ];

  it('draws a two-arc lens as two arcs, including the closing one', () => {
    const d = bpArcPathToSvgPath(lens, s);
    expect(d.startsWith('M')).toBe(true);
    expect(d.match(/A/g)).toHaveLength(2);
    expect(d).not.toContain('L');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('scales the arc radius into SVG units', () => {
    const rect = bpPackingPaperRect(s);
    const unit = rect.width / 8;
    const d = bpArcPathToSvgPath(lens, s, rect);
    const radius = Number(d.slice(d.indexOf('A') + 1).split(',')[0]);
    expect(approx(radius, Math.round(unit * 1000) / 1000, 1e-3)).toBe(true);
  });

  it('draws points without arcs as straight segments', () => {
    const d = bpArcPathToSvgPath(
      [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
      ],
      s
    );
    expect(d).not.toContain('A');
    expect(d.match(/L/g)).toHaveLength(2);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('flips the sweep flag when the outline is mirrored', () => {
    const mirrored = lens.map((point) => ({
      ...point,
      y: -point.y,
      arc: point.arc ? { x: point.arc.x, y: -point.arc.y } : point.arc,
    }));
    const sweeps = (d: string) =>
      [...d.matchAll(/A([^AZL]*)/g)].map((match) => match[1].split(',')[4]);
    expect(sweeps(bpArcPathToSvgPath(lens, s))).toEqual(['0', '0']);
    expect(sweeps(bpArcPathToSvgPath(mirrored, s))).toEqual(['1', '1']);
  });

  it('turns every arc the same way, since a junction region is convex', () => {
    // The region is an intersection of two rounded rects, so its boundary can
    // only curve one way. A per-corner decision flips on a near-collinear corner
    // and bulges that arc outward — drawing the conflict outside the flap.
    const nearlyCollinear = [
      { x: 2, y: 2, arc: { x: 2.5, y: 2.0001 }, r: 1 },
      { x: 3, y: 2.0002, arc: { x: 3.5, y: 2.0003 }, r: 1 },
      { x: 4, y: 2.0001, arc: { x: 3, y: 3 }, r: 1 },
    ];
    const sweeps = (d: string) =>
      [...d.matchAll(/A([^AZL]*)/g)].map((match) => match[1].split(',')[4]);
    const flags = sweeps(bpArcPathToSvgPath(nearlyCollinear, s));
    expect(flags.length).toBeGreaterThan(1);
    expect(new Set(flags).size).toBe(1);
  });

  it('returns nothing for an empty path', () => {
    expect(bpArcPathToSvgPath([], s)).toBe('');
  });
});

describe('bpPackingSvgToPoint', () => {
  it('inverts bpPackingPointToSvg for rectangular and diagonal sheets', () => {
    for (const s of [sheet('rectangular', 8, 12), sheet('diagonal', 16), sheet('diagonal', 15)]) {
      const rect = bpPackingPaperRect(s);
      for (const grid of [
        { x: 0, y: 0 },
        { x: 3, y: 5 },
        { x: 7.5, y: 2.5 },
      ]) {
        const back = bpPackingSvgToPoint(bpPackingPointToSvg(grid, s, rect), s, rect);
        expect(approx(back.x, grid.x)).toBe(true);
        expect(approx(back.y, grid.y)).toBe(true);
      }
    }
  });
});

describe('bpArcPathThickness', () => {
  it('measures the lens across its middle, as the sum of both sagittas', () => {
    // The real conflict from minimal_repro_circle_issue.osf: a sliver ~0.17
    // grid units thick. The outline stroke must not dwarf it.
    const path = [
      { x: 9.9557, y: 7.7057, arc: { x: 9.8, y: 7.2 }, r: 1 },
      { x: 9.2943, y: 7.0443, arc: { x: 9.5454545, y: 7.4545455 }, r: 2 },
    ];
    const thickness = bpArcPathThickness(path);
    expect(thickness).not.toBeNull();
    // r=1 sagitta 0.116 + r=2 sagitta 0.055
    expect(thickness!).toBeGreaterThan(0.15);
    expect(thickness!).toBeLessThan(0.19);
  });

  it('is null for paths that are not two arcs', () => {
    expect(bpArcPathThickness([{ x: 0, y: 0 }])).toBeNull();
    expect(
      bpArcPathThickness([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ])
    ).toBeNull();
  });

  it('handles a degenerate arc whose radius cannot span the chord', () => {
    expect(
      bpArcPathThickness([
        { x: 0, y: 0, arc: { x: 0, y: 1 }, r: 0.1 },
        { x: 10, y: 0, arc: { x: 10, y: 1 }, r: 0.1 },
      ])
    ).toBe(0.2);
  });
});

describe('bpPackingSheetContains', () => {
  const s = sheet('rectangular', 8, 12);

  it('accepts points on and inside the rectangular sheet, including corners', () => {
    expect(bpPackingSheetContains({ x: 0, y: 0 }, s)).toBe(true);
    expect(bpPackingSheetContains({ x: 8, y: 12 }, s)).toBe(true);
    expect(bpPackingSheetContains({ x: 4, y: 6 }, s)).toBe(true);
  });

  it('rejects points outside the rectangular sheet', () => {
    expect(bpPackingSheetContains({ x: -1, y: 4 }, s)).toBe(false);
    expect(bpPackingSheetContains({ x: 9, y: 4 }, s)).toBe(false);
    expect(bpPackingSheetContains({ x: 4, y: 13 }, s)).toBe(false);
  });

  it('respects the diagonal diamond region', () => {
    const d = sheet('diagonal', 16);
    // The diamond spans the grid but its tips clip the square corners.
    expect(bpPackingSheetContains({ x: 8, y: 8 }, d)).toBe(true);
    expect(bpPackingSheetContains({ x: 0, y: 0 }, d)).toBe(false);
  });
});

describe('bpPackingCanResizeFlap', () => {
  const s = sheet('rectangular', 10, 10);

  it('allows a footprint fully inside the sheet', () => {
    expect(bpPackingCanResizeFlap({ x: 2, y: 2 }, 4, 4, s)).toBe(true);
  });

  it('allows a point flap (0x0) anywhere inside', () => {
    expect(bpPackingCanResizeFlap({ x: 0, y: 0 }, 0, 0, s)).toBe(true);
  });

  it('rejects a footprint with more than one corner off the sheet', () => {
    // A tall footprint pushes both top corners past the top edge.
    expect(bpPackingCanResizeFlap({ x: 4, y: 8 }, 2, 4, s)).toBe(false);
  });

  it('allows a single corner tip past a diagonal sheet edge (the <=1 rule)', () => {
    // On the diamond (x+y<=24 along the upper-right facet), a 4x4 footprint at
    // (10,10) pushes only its top-right corner (14,14) past the edge; the other
    // three corners sit on or inside it.
    const d = sheet('diagonal', 16);
    expect(bpPackingCanResizeFlap({ x: 10, y: 10 }, 4, 4, d)).toBe(true);
    // Growing it to 5x5 pushes three corners off, which is rejected.
    expect(bpPackingCanResizeFlap({ x: 10, y: 10 }, 5, 5, d)).toBe(false);
  });
});
