/**
 * Exports with the kernel's own layer order are byte-for-byte what they were
 * before the Layer order dialog could choose one
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * "Byte-identical when unused"). The goldens beside this file were written by
 * the painter as it stood before a figure could be turned or carry a chosen
 * order; a figure with no turn and the default order must still match them.
 *
 * The PNG is that SVG rasterized, so it is held to the same bytes by holding
 * what the rasterizer is handed.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FoldDocument } from '../engine/types';
import type { OristudioCpFoldedPaperScene, OristudioCpFoldedRenderSnapshot } from '../engine/oristudioCpTypes';

const rasterized: string[] = [];
vi.mock('./svgToPng', () => ({
  svgToPng: vi.fn(async (svg: string) => {
    rasterized.push(svg);
    return new Uint8Array([137, 80, 78, 71]);
  }),
}));

const {
  DEFAULT_CREASE_EXPORT_FOLDED_FIGURE,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  EMPTY_CREASE_EXPORT_CAPTION,
  buildCreaseExportArtwork,
  composeCreaseExportSvg,
  renderCreasePatternPng,
  serializeCreasePatternSvg,
} = await import('./creaseExport');
const { segmentFoldDocument } = await import('./creasePatternSegmentation');

/** One square, split by a mountain and a valley diagonal. */
function squareFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 4],
      [4, 2],
      [1, 4],
      [4, 3],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M', 'M', 'V', 'V'],
    faces_vertices: [
      [0, 1, 4],
      [1, 2, 4],
      [2, 3, 4],
      [3, 0, 4],
    ],
  };
}

/** A two-face fold as the kernel scenes one: a 1 × 2 strip folded in half, face 1 buried. */
function foldedScene(): OristudioCpFoldedPaperScene {
  const rectangle = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 0.5 },
    { x: 0, y: 0.5 },
  ];
  const edges = (kinds: Array<'border' | 'fold'>) =>
    rectangle.map((from, index) => ({ from, to: rectangle[(index + 1) % 4]!, kind: kinds[index]! }));
  return {
    schema_version: 2,
    sheet_points: [],
    flipped: false,
    sheet: 4,
    faces: [
      { outline: rectangle, points: [0, 1, 2, 3], front_up: false, edges: edges(['border', 'border', 'fold', 'border']) },
      { outline: rectangle, points: [4, 5, 2, 3], front_up: true, edges: edges(['border', 'border', 'fold', 'border']) },
    ],
    subfaces: [{ polygon: rectangle, faces_top_to_bottom: [0, 1] }],
    aux_lines: [],
  };
}

/** The same figure as the kernel's drawing primitives, for a fold with no paper scene. */
function foldedSnapshot(): OristudioCpFoldedRenderSnapshot {
  return {
    schema_version: 1,
    fixture: null,
    pass: null,
    primitives: [
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: {
          paint: { kind: 'color', color: { red: 255, green: 255, blue: 50, alpha: 255 } },
          stroke: { kind: 'none' },
          antialias: 'default',
        },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0.4, y: 0.7 },
          ],
        },
      },
    ],
  };
}

const fold = squareFold();
const segments = segmentFoldDocument(fold);
const options = {
  ...DEFAULT_CREASE_EXPORT_OPTIONS,
  includeFoldedFigure: true,
  foldedFigure: DEFAULT_CREASE_EXPORT_FOLDED_FIGURE,
};

describe('an export in the kernel’s own layer order', () => {
  it('paints the folded figure’s paper scene as it did before', async () => {
    const svg = serializeCreasePatternSvg(fold, segments, options, {
      foldedFigure: foldedSnapshot(),
      foldedFigureScene: foldedScene(),
    });
    await expect(svg).toMatchFileSnapshot('./__snapshots__/creaseExportDefaultOrder.scene.svg');
  });

  it('paints a figure with no paper scene from its drawing as it did before', async () => {
    const svg = serializeCreasePatternSvg(fold, segments, options, { foldedFigure: foldedSnapshot() });
    await expect(svg).toMatchFileSnapshot('./__snapshots__/creaseExportDefaultOrder.snapshot.svg');
  });

  it('rasterizes exactly that SVG for the PNG', async () => {
    rasterized.length = 0;
    const content = { foldedFigure: foldedSnapshot(), foldedFigureScene: foldedScene() };
    await renderCreasePatternPng(fold, segments, options, content);
    expect(rasterized).toEqual([serializeCreasePatternSvg(fold, segments, options, content)]);
  });

  it('draws the share card’s figure as it did before', async () => {
    const page = composeCreaseExportSvg(
      buildCreaseExportArtwork(fold, segments, options, {
        foldedFigure: foldedSnapshot(),
        foldedFigureScene: foldedScene(),
      }),
      EMPTY_CREASE_EXPORT_CAPTION
    );
    await expect(page.svg).toMatchFileSnapshot('./__snapshots__/creaseExportDefaultOrder.scene.svg');
  });
});
