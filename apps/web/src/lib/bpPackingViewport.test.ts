import { describe, expect, it } from 'vitest';
import type {
  OristudioBpArcPath,
  OristudioBpSheet,
  OristudioBpSheetKind,
} from '../engine/oristudioBpTypes';
import {
  bpArcPathNarrowness,
  bpArcPathToSvgPath,
  bpPackingGridLines,
  bpPackingPaperRect,
  bpPackingPointToSvg,
  bpPackingSheetBorderPoints,
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

describe('bpArcPathNarrowness', () => {
  it('is the anchor span over the endpoint span for a two-arc lens', () => {
    const path: OristudioBpArcPath = [
      { x: 0, y: 0, arc: { x: 1, y: 1 }, r: 1 },
      { x: 4, y: 0, arc: { x: 2, y: 1 }, r: 1 },
    ];
    // anchors are 1 apart, endpoints 4 apart
    expect(bpArcPathNarrowness(path)).toBeCloseTo(0.25);
  });

  it('has none for paths that are not a two-arc lens', () => {
    expect(
      bpArcPathNarrowness([
        { x: 0, y: 0, arc: { x: 1, y: 1 }, r: 1 },
        { x: 4, y: 0, arc: { x: 2, y: 1 }, r: 1 },
        { x: 4, y: 4 },
      ])
    ).toBeNull();
    expect(
      bpArcPathNarrowness([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ])
    ).toBeNull();
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
