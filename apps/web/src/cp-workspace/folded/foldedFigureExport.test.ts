import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
} from '../../engine/oristudioCpTypes';
import { foldedFigureExportDocument } from './foldedFigureExport';

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
    expect(foldedFigureExportDocument(snapshot([square()]))!.svg).toContain('<rect width="100%"');
    expect(
      foldedFigureExportDocument(snapshot([square()]), { showBackgroundColor: false })!.svg
    ).not.toContain('<rect width="100%"');
  });

  it('honours the export theme', () => {
    expect(foldedFigureExportDocument(snapshot([square()]), { theme: 'dark' })!.svg).toContain(
      '#101317'
    );
    expect(foldedFigureExportDocument(snapshot([square()]), { theme: 'light' })!.svg).toContain(
      '#ffffff'
    );
  });

  it('emits a standalone SVG document', () => {
    const svg = foldedFigureExportDocument(snapshot([square()]))!.svg;
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // The figure itself made it in, not just the page furniture.
    expect(svg).toContain('#ff0000');
  });
});

/**
 * The path a figure reopened from an older file still takes.
 *
 * A live figure exports its scene through the shared painter — the window's
 * for a 3D figure, the kernel's paper scene for a flat one — but a figure with
 * no handle has only the `renderSnapshot` its file carries, and that is
 * serialized here exactly as it always was. So what is worth pinning is the
 * one property the serializer adds nothing to: it draws **every** primitive,
 * in the order the stream states, because the stacking order travels inside
 * the stream and the exporter has no depth test and no sort of its own. An
 * exporter that dropped or reordered primitives would produce a plausible
 * picture with the wrong faces on top.
 */
describe('exporting a figure from its stored snapshot', () => {
  /** Two overlapping fills and the crease between them: paper, then ink. */
  const stored = snapshot([
    square(10, 0),
    { ...square(6, 2), style: { ...square().style, paint: solid(0, 0, 255, 255) } },
    {
      sequence: 0,
      kind: 'stroke_segment',
      style: {
        paint: solid(0, 0, 0, 255),
        stroke: { kind: 'basic', width: 1.2, end_cap: 0, line_join: 0, miter_limit: 10 },
        antialias: 'default',
      },
      geometry: { kind: 'segment', from: { x: 2, y: 2 }, to: { x: 8, y: 8 } },
    } as unknown as OristudioCpFoldedRenderPrimitive,
  ]);

  it('produces a page with the figure in it', () => {
    const page = foldedFigureExportDocument(stored);
    expect(page).not.toBeNull();
    expect(page!.width).toBeGreaterThan(0);
    expect(page!.height).toBeGreaterThan(0);
    // Not merely non-null: the paper and its creases both reached the page.
    expect(page!.svg).toContain('<polygon');
    expect(page!.svg).toContain('<line');
  });

  it('emits a standalone document, the same serialization a flat figure takes', () => {
    const svg = foldedFigureExportDocument(stored)!.svg;
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('draws every primitive the stream carries, in order', () => {
    const svg = foldedFigureExportDocument(stored)!.svg;
    // One drawn element per primitive; the page's own background `<rect>` is
    // the only other shape in the file.
    const drawn = svg.match(/<(?:path|polygon|line|ellipse)\b/g) ?? [];
    expect(drawn.length).toBe(stored.primitives.length);
    // Order, not just count: the blue fill is painted over the red one.
    expect(svg.indexOf('#0000ff')).toBeGreaterThan(svg.indexOf('#ff0000'));
  });
});
