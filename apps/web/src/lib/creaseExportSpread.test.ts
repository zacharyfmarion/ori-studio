/**
 * The folded figure's layers spread beside an exported pattern
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`, §2):
 * a Default spread's hidden anchor rings are never painted, so no face is
 * written twice; the figure is fitted by its flat extent, so Amount spreads it
 * rather than shrinking it; a figure too complex to clip is embedded as its
 * bitmap; and the PNG is that SVG, rasterized.
 */
import '../layer-spread/captureWorker.testSupport';
import { describe, expect, it, vi } from 'vitest';
import type { FoldDocument } from '../engine/types';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import { DEFAULT_CONNECTED_SPREAD } from '../cp-workspace/folded/layerSpreadSettings';
import type { PaperScene } from './paper/paperScene';

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
  buildCreaseExportArtwork,
  renderCreasePatternPng,
  serializeCreasePatternSvg,
} = await import('./creaseExport');
const { creaseExportSpreadFrame, creaseExportSpreadPicture, creaseExportSpreadScene } = await import(
  './creaseExportSpread'
);
const { settledSpreadPicture } = await import('../layer-spread/settledSpreadPicture');
const { segmentFoldDocument } = await import('./creasePatternSegmentation');
const { DEFAULT_PAPER_STYLE } = await import('./paper/paperStyle');

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

/** A 1 × 2 strip folded in half, as the kernel scenes it: face 0 over face 1. */
function stripScene(): OristudioCpFoldedPaperScene {
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
    sheet: 1,
    faces: [
      { outline: rectangle, points: [0, 1, 2, 3], front_up: false, edges: edges(['border', 'border', 'fold', 'border']) },
      { outline: rectangle, points: [4, 5, 2, 3], front_up: true, edges: edges(['border', 'border', 'fold', 'border']) },
    ],
    subfaces: [{ polygon: rectangle, faces_top_to_bottom: [0, 1] }],
    aux_lines: [],
  };
}

const fold = squareFold();
const segments = segmentFoldDocument(fold);
const options = {
  ...DEFAULT_CREASE_EXPORT_OPTIONS,
  includeFoldedFigure: true,
  foldedFigure: { ...DEFAULT_CREASE_EXPORT_FOLDED_FIGURE, spread: DEFAULT_CONNECTED_SPREAD },
};
const snapshot = { schema_version: 1, fixture: null, pass: null, primitives: [] } as never;
const flat = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
const pens = { style: DEFAULT_PAPER_STYLE, policy: 'folded-flat', mm: 100 } as const;

/** The folded figure's face paths, in the order they are painted. */
function facePaths(svg: string): string[] {
  const group = svg.slice(svg.indexOf('stroke-linejoin="round"'));
  return [...group.matchAll(/<path d="(M[^"]*Z)"[^>]*fill="#/g)].map((match) => match[1]!);
}

/** A path's points on the page. */
function pointsOf(path: string): Array<[number, number]> {
  return [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((match) => [Number(match[1]), Number(match[2])]);
}

function extent(points: Array<[number, number]>) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** A spread picture by hand: `faces` rectangles, in a frame whose flat figure is `flat`. */
function scenePicture(faces: Array<[number, number, number, number]>, hidden: boolean[] = []) {
  const items: PaperScene['items'] = faces.map(([x, y, w, h], face) => ({
    kind: 'face',
    face,
    side: 'front',
    rings: [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
    ],
    shade: 1,
    hidden: hidden[face] ?? false,
  }));
  const xs = faces.flatMap(([x, , w]) => [x, x + w]);
  const ys = faces.flatMap(([, y, , h]) => [y, y + h]);
  const bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  return { kind: 'scene', spread: 'connected', scene: { items, sheet: 200, bounds }, scale: 100, flat } as const;
}

describe('a Default spread beside its pattern', () => {
  it('paints each visible piece once, and none of the hidden anchor rings', async () => {
    const kernel = stripScene();
    const frame = creaseExportSpreadFrame(kernel);
    const settled = await settledSpreadPicture(kernel, DEFAULT_CONNECTED_SPREAD, {
      live: (prepared) => creaseExportSpreadScene(kernel, DEFAULT_CONNECTED_SPREAD, frame, prepared),
      raster: pens,
    });
    expect(settled.kind).toBe('scene');
    const picture = creaseExportSpreadPicture(settled, DEFAULT_CONNECTED_SPREAD, frame)!;
    if (picture.kind !== 'scene') throw new Error('a resolved scene');
    const anchors = picture.scene.items.filter((item) => item.kind === 'face' && item.hidden).length;
    const visible = picture.scene.items.filter((item) => item.kind === 'face' && !item.hidden).length;
    // One anchor ring per face, written ahead of the visible pieces.
    expect(anchors).toBe(kernel.faces.length);
    expect(visible).toBeGreaterThan(0);
    const svg = serializeCreasePatternSvg(fold, segments, options, {
      foldedFigure: snapshot,
      foldedFigureScene: kernel,
      foldedFigureSpread: picture,
    });
    expect(facePaths(svg)).toHaveLength(visible);
  });

  it('keeps a buried anchor out of the page however the scene marks it', () => {
    const picture = scenePicture(
      [
        [0, 0, 100, 50],
        [0, 0, 100, 50],
      ],
      [true, false]
    );
    const svg = serializeCreasePatternSvg(fold, segments, options, { foldedFigure: snapshot, foldedFigureSpread: picture });
    expect(facePaths(svg)).toHaveLength(1);
  });

  it('is fitted by the figure unspread, so more Amount spreads it apart and never shrinks it', () => {
    const near = scenePicture([[0, 0, 100, 50]]);
    // The same flat figure, its layers spread past it: down and to the right.
    const far = scenePicture([
      [0, 0, 100, 50],
      [20, 30, 100, 50],
    ]);
    const content = { foldedFigure: snapshot };
    const nearArt = buildCreaseExportArtwork(fold, segments, options, { ...content, foldedFigureSpread: near });
    const farArt = buildCreaseExportArtwork(fold, segments, options, { ...content, foldedFigureSpread: far });
    const nearFace = extent(pointsOf(facePaths(serializeCreasePatternSvg(fold, segments, options, { ...content, foldedFigureSpread: near }))[0]!));
    const farFace = extent(pointsOf(facePaths(serializeCreasePatternSvg(fold, segments, options, { ...content, foldedFigureSpread: far }))[0]!));
    // The flat face is the pattern's height in both, as an unspread figure is.
    expect(farFace.height).toBeCloseTo(nearFace.height, 1);
    expect(farFace.width).toBeCloseTo(nearFace.width, 1);
    // The box takes the spread in: wider by what the layers reach.
    expect(farArt.foldedBox!.width / nearArt.foldedBox!.width).toBeCloseTo(120 / 100, 2);
    expect(farArt.foldedBox!.height).toBeGreaterThan(nearArt.foldedBox!.height);
  });

  it('embeds a figure too complex to clip as its bitmap, at its frame', () => {
    const href = 'data:image/png;base64,iVBORw0KGgo=';
    const raster = {
      kind: 'raster',
      spread: 'connected',
      href,
      frame: [-2, -2, 104, 54],
      bounds: flat,
      scale: 100,
      flat,
    } as const;
    const art = buildCreaseExportArtwork(fold, segments, options, { foldedFigure: snapshot, foldedFigureSpread: raster });
    expect(art.folded).toContain(`href="${href}"`);
    const image = /<image x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(art.folded!)!;
    const [x, y, width, height] = image.slice(1).map(Number);
    // The frame's margin round the figure, the figure fitted to the pattern's height.
    expect(width! / height!).toBeCloseTo(104 / 54, 2);
    expect(x).toBeLessThan(0);
    expect(y! + height!).toBeGreaterThan(art.foldedBox!.height - 60);
    expect(art.folded).not.toContain('<path');
  });

  it('writes a PNG that is that SVG, rasterized', async () => {
    rasterized.length = 0;
    const content = { foldedFigure: snapshot, foldedFigureSpread: scenePicture([[0, 0, 100, 50]]) };
    await renderCreasePatternPng(fold, segments, options, content);
    expect(rasterized).toEqual([serializeCreasePatternSvg(fold, segments, options, content)]);
  });

  it('draws nothing of the spread when the figure is left out', () => {
    const art = buildCreaseExportArtwork(
      fold,
      segments,
      { ...options, includeFoldedFigure: false },
      { foldedFigure: snapshot, foldedFigureSpread: scenePicture([[0, 0, 100, 50]]) }
    );
    expect(art.folded).toBeNull();
  });
});

describe('Affine and Depth beside the pattern', () => {
  it('settle at once, every layer kept, in the figure’s frame', async () => {
    const kernel = stripScene();
    const depth = { kind: 'depth', amount: 0.1, toward: 'down' } as const;
    const frame = creaseExportSpreadFrame(kernel);
    const settled = await settledSpreadPicture(kernel, depth, {
      live: (prepared) => creaseExportSpreadScene(kernel, depth, frame, prepared),
      raster: pens,
    });
    const picture = creaseExportSpreadPicture(settled, depth, frame)!;
    expect(picture).toMatchObject({ kind: 'scene', spread: 'depth', scale: frame.scale, flat: frame.flat });
    if (picture.kind !== 'scene') throw new Error('a scene');
    expect(picture.scene.items.every((item) => !item.hidden)).toBe(true);
    // Stepped down: the spread reaches below the flat figure.
    expect(picture.scene.bounds.maxY).toBeGreaterThan(frame.flat.maxY);
  });
});

describe('a Default spread’s bitmap', () => {
  it('is drawn so its 300 dpi pens come out at the vector’s width on the page', async () => {
    const { creaseExportSpreadRasterMm } = await import('./creaseExportSpread');
    const { CREASE_EXPORT_FIGURE_UNITS_PER_PT } = await import('./creaseExport');
    const flat = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    const drawn = { minX: 0, minY: -10, maxX: 120, maxY: 60 };
    for (const figureHeight of [928, 464]) {
      const mm = creaseExportSpreadRasterMm(flat, drawn, figureHeight);
      // The raster worker: `mm` across the drawn scene's longer side, 300 px an inch, a pen 300/72 px a pt.
      const bitmapPxPerUnit = (mm * (300 / 25.4)) / 120;
      const pagePxPerUnit = figureHeight / 50;
      expect(((300 / 72) * pagePxPerUnit) / bitmapPxPerUnit).toBeCloseTo(CREASE_EXPORT_FIGURE_UNITS_PER_PT, 9);
    }
  });
});

describe('the frame a spread is built in', () => {
  it('is the figure turned as the dialog turned it, its sheet a fixed span', () => {
    const kernel = stripScene();
    const upright = creaseExportSpreadFrame(kernel);
    const turned = creaseExportSpreadFrame(kernel, 90);
    expect(upright.flat).toEqual({ minX: 0, minY: 0, maxX: 1000, maxY: 500 });
    // A quarter turn clockwise stands the strip up.
    expect(turned.flat.maxX - turned.flat.minX).toBeCloseTo(500, 6);
    expect(turned.flat.maxY - turned.flat.minY).toBeCloseTo(1000, 6);
  });
});
