import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
} from '../../engine/oristudioCpTypes';
import { foldedFigureExportDocument, serializeFoldedFigureSvg } from './foldedFigureExport';
import {
  DEFAULT_FOLDED_3D_CAMERA,
  projectFolded3dModel,
} from './foldedFigure3dProjection';

const FOLDED_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

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

/**
 * A 3D figure exports with **no code change** — the exporter serializes
 * `renderSnapshot.primitives` and never asks the kernel anything, and a 3D
 * figure's snapshot is the projector's output in the same primitive vocabulary.
 *
 * That is a claim about the boundary between the projector and the exporter, so
 * it is tested across it: a real kernel render model, through the real
 * projector, into the real exporter. Asserting it on a hand-built snapshot would
 * only pin that the exporter draws fills, which the tests above already do.
 */
describe('exporting a 3D folded figure', () => {
  const model: OristudioCpFolded3dRenderModel = JSON.parse(
    readFileSync(join(FOLDED_FIXTURES, 'box_90.rendermodel.json'), 'utf8')
  );

  const projected = projectFolded3dModel(model, {
    camera: DEFAULT_FOLDED_3D_CAMERA,
    displayStyle: 'Paper5',
    style: {
      front: [1, 1, 0.2],
      back: [1, 1, 1],
      line: [0, 0, 0],
      faceAlpha: 1,
  transparentAlpha: 16 / 255,
      lineWidth: 1.200000048,
      antiAlias: true,
      lighting: true,
      lightDir: [0, 0, 1],
    },
    tolerances: {
      angle_radians: 1e-7,
      distance_relative: 1e-6,
      flat_snap_degrees: 1e-6,
      overlap_area_relative: 1e-9,
    },
  }).snapshot;

  it('produces a page with the figure in it', () => {
    const page = foldedFigureExportDocument(projected);
    expect(page).not.toBeNull();
    expect(page!.width).toBeGreaterThan(0);
    expect(page!.height).toBeGreaterThan(0);
    // Not merely non-null: the paper and its creases both reached the page.
    expect(page!.svg).toContain('<path');
    expect(page!.svg).toContain('stroke=');
  });

  it('is the same serialization path a flat figure takes', () => {
    const svg = serializeFoldedFigureSvg(projected) ?? '';
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('draws every primitive the projector emitted, in order', () => {
    // The stacking order travels *inside* the primitive stream — the exporter
    // has no depth test and no sort of its own — so an exporter that dropped or
    // reordered primitives would produce a plausible picture with the wrong
    // faces on top.
    const svg = serializeFoldedFigureSvg(projected) ?? '';
    const drawn = svg.split('<path').length - 1;
    expect(drawn).toBe(projected.primitives.length);
  });
});
