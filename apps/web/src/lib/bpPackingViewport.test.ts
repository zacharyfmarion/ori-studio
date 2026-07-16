import { describe, expect, it } from 'vitest';
import type { OristudioBpSheet, OristudioBpSheetKind } from '../engine/oristudioBpTypes';
import {
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
