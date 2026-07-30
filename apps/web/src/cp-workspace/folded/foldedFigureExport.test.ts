import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
} from '../../engine/oristudioCpTypes';
import { foldedFigureExportDocument, serializeFoldedFigureSvg } from './foldedFigureExport';

const solid = (r: number, g: number, b: number, a: number) =>
  ({ kind: 'color', color: { red: r, green: g, blue: b, alpha: a } }) as const;

function snapshot(
  primitives: OristudioCpFoldedRenderPrimitive[]
): OristudioCpFoldedRenderSnapshot {
  return {
    schema_version: 1,
    fixture: null,
    pass: null,
    primitives,
  } as unknown as OristudioCpFoldedRenderSnapshot;
}

/** A filled square, 10 model units on a side, offset well away from the origin. */
function square(size = 10, offset = 100): OristudioCpFoldedRenderPrimitive {
  return {
    sequence: 0,
    kind: 'fill_polygon',
    style: { paint: solid(255, 0, 0, 255), stroke: { kind: 'none' }, antialias: 'default' },
    geometry: {
      kind: 'polygon',
      points: [
        { x: offset, y: offset },
        { x: offset + size, y: offset },
        { x: offset + size, y: offset + size },
        { x: offset, y: offset + size },
      ],
    },
  } as unknown as OristudioCpFoldedRenderPrimitive;
}

/** A wide, short rectangle: 20 across, 5 tall. */
function wideRect(): OristudioCpFoldedRenderPrimitive {
  return {
    sequence: 0,
    kind: 'fill_polygon',
    style: { paint: solid(0, 0, 255, 255), stroke: { kind: 'none' }, antialias: 'default' },
    geometry: {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 5 },
        { x: 0, y: 5 },
      ],
    },
  } as unknown as OristudioCpFoldedRenderPrimitive;
}

describe('foldedFigureExportDocument', () => {
  it('is null for a figure that draws nothing', () => {
    expect(foldedFigureExportDocument(null)).toBeNull();
    expect(foldedFigureExportDocument(undefined)).toBeNull();
    expect(foldedFigureExportDocument(snapshot([]))).toBeNull();
  });

  it('is null for a degenerate figure with no extent', () => {
    expect(foldedFigureExportDocument(snapshot([square(0)]))).toBeNull();
  });

  it('crops to the figure, so its position on the canvas does not matter', () => {
    const near = foldedFigureExportDocument(snapshot([square(10, 0)]));
    const far = foldedFigureExportDocument(snapshot([square(10, 5000)]));
    expect(near?.width).toBe(far?.width);
    expect(near?.height).toBe(far?.height);
    expect(near?.svg).toBe(far?.svg);
  });

  it('keeps the figure’s aspect ratio', () => {
    const page = foldedFigureExportDocument(snapshot([wideRect()]));
    // 20x5 model units, padded equally on all sides.
    const padding = 1024 * 0.04;
    expect(page?.width).toBeCloseTo(1024 + padding * 2);
    expect(page?.height).toBeCloseTo(1024 / 4 + padding * 2);
  });

  it('sizes the viewBox to the page so the figure fills it', () => {
    const page = foldedFigureExportDocument(snapshot([square()]));
    expect(page?.svg).toContain(
      `viewBox="0 0 ${page!.width.toFixed(2)} ${page!.height.toFixed(2)}"`
    );
  });

  it('draws a background by default and omits it on request', () => {
    expect(serializeFoldedFigureSvg(snapshot([square()]))).toContain('<rect width="100%"');
    expect(
      serializeFoldedFigureSvg(snapshot([square()]), { showBackgroundColor: false })
    ).not.toContain('<rect width="100%"');
  });

  it('honours the export theme', () => {
    expect(serializeFoldedFigureSvg(snapshot([square()]), { theme: 'dark' })).toContain(
      '#101317'
    );
    expect(serializeFoldedFigureSvg(snapshot([square()]), { theme: 'light' })).toContain(
      '#ffffff'
    );
  });

  it('emits a standalone SVG document', () => {
    const svg = serializeFoldedFigureSvg(snapshot([square()])) ?? '';
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // The figure itself made it in, not just the page furniture.
    expect(svg).toContain('#ff0000');
  });
});
