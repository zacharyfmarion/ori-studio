import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import { segmentFoldDocument } from './creasePatternSegmentation';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';
import {
  buildCreaseExportArtwork,
  creaseExportGridSource,
  foldProjector,
  serializeCreasePatternSvg,
  layoutCreaseExport,
  wrapExportText,
  CREASE_EXPORT_PALETTES,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  type CreaseExportCaption,
  type CreaseExportGridSource,
  type CreaseExportOptions,
} from './creaseExport';
import {
  ORIEDITA_DASH_ONE_DOT,
  ORIEDITA_DASH_TWO_DOT,
  ORIEDITA_DASH_VALLEY,
} from './oristudioCpLineStyle';

// A square (border) split by a mountain and a valley diagonal, plus a second
// disjoint square, so segmentation yields two crease patterns.
function twoPatternFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
      [3, 0],
      [4, 0],
      [4, 1],
      [3, 1],
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
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M', 'M', 'V', 'V', 'B', 'B', 'B', 'B'],
    faces_vertices: [
      [0, 1, 4],
      [1, 2, 4],
      [2, 3, 4],
      [3, 0, 4],
      [5, 6, 7, 8],
    ],
  };
}

describe('crease pattern export', () => {
  it('serializes a fold to SVG with lines and background facets', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, DEFAULT_CREASE_EXPORT_OPTIONS);

    expect(svg).toContain('<svg');
    expect(svg).toContain('<line');
    expect(svg).toContain('<polygon'); // background facets
  });

  it('colors creases by assignment in the color line style', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      lineStyle: 'color',
    });

    expect(svg).toContain('stroke="#ff4d5d"'); // mountain
    expect(svg).toContain('stroke="#60a5fa"'); // valley
    expect(svg).toContain('stroke="#111417"'); // border
  });

  it('draws mountains and edges black, valleys grey, in the black-white style', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      lineStyle: 'black-white',
    });

    // Oriedita's SvgExporter: BLACK_0/RED_1 -> black, BLUE_2 -> #A2A2A2, solid.
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain(`stroke="${CREASE_EXPORT_PALETTES.light.monochromeValley}"`);
    expect(svg).not.toContain('stroke="#ff4d5d"');
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('dashes mountains and valleys with the Oriedita patterns', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    // The export viewBox is scaled up from the editable canvas, so the dash runs
    // are the upstream device-px pattern times that same factor.
    const scaled = (pattern: readonly number[]) =>
      pattern.map((run) => (run * (1024 / 720)).toFixed(2)).join(' ');

    const oneDot = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      lineStyle: 'color-and-shape',
    });
    expect(oneDot).toContain(`stroke-dasharray="${scaled(ORIEDITA_DASH_ONE_DOT)}"`);
    expect(oneDot).toContain(`stroke-dasharray="${scaled(ORIEDITA_DASH_VALLEY)}"`);
    // "Color + shape" keeps every crease its own colour.
    expect(oneDot).toContain('stroke="#ff4d5d"');

    const twoDot = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      lineStyle: 'black-two-dot',
    });
    expect(twoDot).toContain(`stroke-dasharray="${scaled(ORIEDITA_DASH_TWO_DOT)}"`);
    expect(twoDot).not.toContain('stroke="#ff4d5d"');
  });

  it('exports a single segment when a segmentId is given', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const all = serializeCreasePatternSvg(fold, segments, DEFAULT_CREASE_EXPORT_OPTIONS);
    const one = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      segmentId: segments[0]!.id,
    });

    // The whole document has more lines than a single pattern.
    const countLines = (svg: string) => svg.match(/<line /g)?.length ?? 0;
    expect(segments).toHaveLength(2);
    expect(countLines(one)).toBeLessThan(countLines(all));
  });

  it('hides vertex points when point size is zero', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const withPoints = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      pointSize: 2,
    });
    const noPoints = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      pointSize: 0,
    });

    expect(withPoints).toContain('<circle');
    expect(noPoints).not.toContain('<circle');
  });
});

/**
 * A unit-square fold with the Oriedita grid behind it: `scale` and the offsets
 * are what `cpModelToFoldTransform` recovers when a document drawn on the
 * 400-unit Oriedita sheet has been rescaled into [0,1] by the import pipeline,
 * so the paper's corners land on the fold's.
 */
const GRID_SOURCE: CreaseExportGridSource = {
  metadata: {
    interval_grid_size: 4,
    grid_size: 8,
    grid_xa: 1,
    grid_xb: 0,
    grid_xc: 1,
    grid_ya: 1,
    grid_yb: 0,
    grid_yc: 1,
    grid_angle: 90,
    base_state: 'WithinPaper',
    vertical_scale_position: 0,
    horizontal_scale_position: 0,
    draw_diagonal_gridlines: false,
  },
  transform: { scale: 1 / 400, offsetX: 0.5, offsetY: 0.5 },
};

/** One sheet filling the [0,1] square the transform above places the grid on. */
function unitSquareFold(): FoldDocument {
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

/**
 * A regular hexagon on the Oriedita sheet, with the 60° triangular grid a
 * hexagonal tessellation is drawn on. Its bounding box is visibly larger than
 * the paper, which is what makes it the case a box clip gets wrong.
 */
function hexagonFold(): FoldDocument {
  const corners: [number, number][] = [
    [-200, 26.794919243112275],
    [-100, -146.41016151377545],
    [100, -146.41016151377545],
    [200, 26.794919243112275],
    [100, 200],
    [-100, 200],
  ];
  return {
    vertices_coords: [...corners, [0, 26.794919243112272]],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      [0, 6],
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'M', 'M', 'V', 'M', 'M', 'V'],
    faces_vertices: [
      [0, 6, 1],
      [1, 6, 2],
      [2, 6, 3],
      [3, 6, 4],
      [4, 6, 5],
      [5, 6, 0],
    ],
  };
}

const HEX_GRID_SOURCE: CreaseExportGridSource = {
  metadata: {
    ...GRID_SOURCE.metadata,
    interval_grid_size: 2,
    grid_angle: 60,
    draw_diagonal_gridlines: true,
  },
  // Already in the document's own coordinates.
  transform: { scale: 1, offsetX: 0, offsetY: 0 },
};

function gridSvg(
  patch: Partial<CreaseExportOptions> = {},
  content: { grid: CreaseExportGridSource | null } = { grid: GRID_SOURCE },
  fold: FoldDocument = unitSquareFold()
): string {
  return serializeCreasePatternSvg(
    fold,
    segmentFoldDocument(fold),
    { ...DEFAULT_CREASE_EXPORT_OPTIONS, showGrid: true, ...patch },
    { foldedFigure: null, ...content }
  );
}

function countStroke(svg: string, color: string): number {
  return svg.split(`stroke="${color}"`).length - 1;
}

/** The vertex loops of the grid's clip path, as projected page points. */
function clipLoops(svg: string): { x: number; y: number }[][] {
  const path = /<clipPath id="cp-export-grid-clip"><path d="([^"]+)"/.exec(svg);
  if (!path) return [];
  return path[1]!
    .split('M ')
    .filter(Boolean)
    .map((loop) =>
      loop
        .replace(/\s*Z\s*$/, '')
        .split(' L ')
        .map((pair) => {
          const [x, y] = pair.trim().split(',');
          return { x: Number(x), y: Number(y) };
        })
    );
}

describe('crease pattern export grid', () => {
  it('draws the document grid when asked', () => {
    const svg = gridSvg();

    // 8 divisions over the sheet is 9 lines each way.
    expect(countStroke(svg, CREASE_EXPORT_PALETTES.light.grid)).toBe(18);
  });

  it('draws one weight, so no grid line can be mistaken for a crease', () => {
    // `interval_grid_size: 4` marks every fourth line as an interval line, which
    // the canvas draws heavier. At export size that reads as a crease, so the
    // lattice is deliberately uniform: one stroke width, one colour.
    const pattern = new RegExp(
      `stroke="${CREASE_EXPORT_PALETTES.light.grid}" stroke-width="([\\d.]+)"`,
      'g'
    );
    const widths = new Set(Array.from(gridSvg().matchAll(pattern), (match) => match[1]));

    expect(widths.size).toBe(1);
  });

  it('draws nothing without the option, and nothing without a grid', () => {
    expect(gridSvg({ showGrid: false })).not.toContain(CREASE_EXPORT_PALETTES.light.grid);
    expect(gridSvg({}, { grid: null })).not.toContain(CREASE_EXPORT_PALETTES.light.grid);
  });

  it('is off by default, so an untouched export is what it always was', () => {
    expect(DEFAULT_CREASE_EXPORT_OPTIONS.showGrid).toBe(false);
    const fold = unitSquareFold();
    const segments = segmentFoldDocument(fold);
    expect(
      serializeCreasePatternSvg(fold, segments, DEFAULT_CREASE_EXPORT_OPTIONS, {
        foldedFigure: null,
        grid: GRID_SOURCE,
      })
    ).toBe(serializeCreasePatternSvg(fold, segments, DEFAULT_CREASE_EXPORT_OPTIONS));
  });

  it('takes its colours from the export theme', () => {
    const svg = gridSvg({ theme: 'dark' });

    expect(svg).toContain(`stroke="${CREASE_EXPORT_PALETTES.dark.grid}"`);
    expect(svg).not.toContain(`stroke="${CREASE_EXPORT_PALETTES.light.grid}"`);
  });

  it('draws under every crease, so the pattern still reads first', () => {
    const svg = gridSvg();

    expect(svg.indexOf(`stroke="${CREASE_EXPORT_PALETTES.light.grid}"`)).toBeLessThan(
      svg.indexOf(`stroke="${CREASE_EXPORT_PALETTES.light.mountain}"`)
    );
    // And over the paper, which would otherwise cover it.
    expect(svg.indexOf('<polygon')).toBeLessThan(
      svg.indexOf(`stroke="${CREASE_EXPORT_PALETTES.light.grid}"`)
    );
  });

  it('clips the lattice to the sheet, not to its box', () => {
    // A hexagon is the case a bounding box gets wrong: four corners of ruling
    // would float outside the paper with nothing under them.
    const loops = clipLoops(gridSvg({}, { grid: HEX_GRID_SOURCE }, hexagonFold()));

    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
  });

  it('follows the sheet on a square too, corner for corner', () => {
    const loops = clipLoops(gridSvg());
    const projector = foldProjector(unitSquareFold());

    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    // The projected sheet, so no ruling reaches the export's margin.
    expect(Math.min(...loops[0]!.map((point) => point.y))).toBeCloseTo(projector.contentTop, 1);
    expect(Math.max(...loops[0]!.map((point) => point.y))).toBeCloseTo(
      projector.contentTop + projector.contentHeight,
      1
    );
  });

  it('keeps disjoint patterns as separate loops', () => {
    // Two squares: one box around both would rule the empty gap between them.
    const svg = serializeCreasePatternSvg(
      twoPatternFold(),
      segmentFoldDocument(twoPatternFold()),
      { ...DEFAULT_CREASE_EXPORT_OPTIONS, showGrid: true },
      { foldedFigure: null, grid: GRID_SOURCE }
    );

    expect(clipLoops(svg)).toHaveLength(2);
  });

  it('falls back to the pattern box when the fold has no faces', () => {
    const faceless: FoldDocument = { ...unitSquareFold(), faces_vertices: [] };
    const svg = serializeCreasePatternSvg(
      faceless,
      segmentFoldDocument(faceless),
      { ...DEFAULT_CREASE_EXPORT_OPTIONS, showGrid: true },
      { foldedFigure: null, grid: GRID_SOURCE }
    );

    expect(svg).toContain(`<clipPath id="cp-export-grid-clip"><rect `);
  });

  it('draws a grid the document itself is hiding', () => {
    // Upstream keeps grid visibility in the same tri-state as its extent, so a
    // hidden document grid must not turn the export option into a dead switch.
    expect(
      gridSvg({}, { grid: { ...GRID_SOURCE, metadata: { ...GRID_SOURCE.metadata, base_state: 'Hidden' } } })
    ).toContain(`stroke="${CREASE_EXPORT_PALETTES.light.grid}"`);
  });
});

describe('creaseExportGridSource', () => {
  const document = {
    crease_pattern: {
      line_segments: [
        { a: { x: -200, y: -200 }, b: { x: 200, y: -200 }, color: 'Black0' },
        { a: { x: 200, y: -200 }, b: { x: 200, y: 200 }, color: 'Black0' },
        { a: { x: 200, y: 200 }, b: { x: -200, y: 200 }, color: 'Black0' },
        { a: { x: -200, y: 200 }, b: { x: -200, y: -200 }, color: 'Black0' },
      ],
      grid: GRID_SOURCE.metadata,
    },
  } as unknown as OristudioCpDocumentSnapshot;

  it('is null without a document to take a grid from', () => {
    expect(creaseExportGridSource(twoPatternFold(), null)).toBeNull();
  });

  it('carries the grid and the transform onto a rescaled fold', () => {
    const source = creaseExportGridSource(twoPatternFold(), document);

    expect(source?.metadata).toBe(GRID_SOURCE.metadata);
    // twoPatternFold spans 4 units wide against the document's 400, and its
    // centre sits at (2, 0.5) rather than the sheet's origin.
    expect(source?.transform.scale).toBeCloseTo(1 / 100, 6);
    expect(source?.transform.offsetX).toBeCloseTo(2, 6);
    expect(source?.transform.offsetY).toBeCloseTo(0.5, 6);
  });
});

describe('crease pattern export theme', () => {
  it('paints the page and creases from the dark palette', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      theme: 'dark',
    });

    expect(svg).toContain(`fill="${CREASE_EXPORT_PALETTES.dark.canvas}"`);
    expect(svg).toContain(`fill="${CREASE_EXPORT_PALETTES.dark.paper}"`);
    expect(svg).toContain(`stroke="${CREASE_EXPORT_PALETTES.dark.mountain}"`);
    expect(svg).not.toContain(`fill="${CREASE_EXPORT_PALETTES.light.canvas}"`);
  });

  it('inverts the monochrome styles so creases stay visible on a dark page', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      theme: 'dark',
      lineStyle: 'black-white',
    });

    expect(svg).toContain(`stroke="${CREASE_EXPORT_PALETTES.dark.monochromeInk}"`);
    expect(svg).not.toContain('stroke="#000000"');
  });
});

describe('crease pattern export captions', () => {
  const caption = (patch: Partial<CreaseExportCaption>): CreaseExportOptions => ({
    ...DEFAULT_CREASE_EXPORT_OPTIONS,
    caption: { title: '', subtitle: '', description: '', ...patch },
  });

  it('leaves an uncaptioned export at the bare content box', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, DEFAULT_CREASE_EXPORT_OPTIONS);

    expect(svg).toContain('viewBox="0 0 1024.00 1024.00"');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<g transform');
  });

  it('draws title, subtitle and description and grows the page', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(
      fold,
      segments,
      caption({ title: 'Crane', subtitle: 'Traditional', description: 'Folded from a square.' })
    );

    expect(svg).toContain('>Crane</text>');
    expect(svg).toContain('>Traditional</text>');
    expect(svg).toContain('>Folded from a square.</text>');
    // The crease pattern is pushed below the header block.
    expect(svg).toContain('<g transform="translate(0.00, ');
    expect(svg).not.toContain('viewBox="0 0 1024.00 1024.00"');
  });

  it('escapes caption text', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, caption({ title: 'Bird & <base>' }));

    expect(svg).toContain('>Bird &amp; &lt;base&gt;</text>');
    expect(svg).not.toContain('<base>');
  });
});

describe('folded figure placement', () => {
  /** A figure four times the height of the paper it was folded from. */
  function tallFigure(): OristudioCpFoldedRenderSnapshot {
    return {
      schema_version: 1,
      fixture: null,
      pass: null,
      primitives: [
        {
          sequence: 0,
          kind: 'fill_polygon',
          style: {
            paint: { kind: 'color', color: { red: 255, green: 255, blue: 255, alpha: 255 } },
            stroke: { kind: 'none' },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 4 },
              { x: 0, y: 4 },
            ],
          },
        },
      ],
    };
  }

  it('fits the figure between the top and bottom of the drawn pattern', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const artwork = buildCreaseExportArtwork(
      fold,
      segments,
      { ...DEFAULT_CREASE_EXPORT_OPTIONS, includeFoldedFigure: true },
      { foldedFigure: tallFigure() }
    );
    const layout = layoutCreaseExport(
      { title: '', subtitle: '', description: '' },
      artwork.palette,
      artwork.foldedBox,
      artwork.inset
    );

    // The figure's box ends exactly where the crease pattern's drawing does.
    expect(layout.folded!.height).toBe(layout.cp.height - artwork.inset.bottom);
    // Its aspect ratio survives the fit: four times as tall as it is wide.
    const drawnHeight = layout.folded!.height - artwork.inset.top;
    expect(artwork.foldedBox!.width).toBeCloseTo(drawnHeight / 4, 6);
  });
});

describe('export text wrapping', () => {
  it('wraps on words and keeps hard breaks', () => {
    const lines = wrapExportText('alpha beta\ngamma', 60, 20);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.at(-1)).toBe('gamma');
  });

  it('returns nothing for blank text', () => {
    expect(wrapExportText('   ', 500, 20)).toEqual([]);
  });

  it('splits a word wider than the line rather than overflowing', () => {
    const lines = wrapExportText('x'.repeat(60), 100, 20);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 60)).toBe(true);
  });
});

describe('export layout', () => {
  const emptyCaption = { title: '', subtitle: '', description: '' };
  const palette = CREASE_EXPORT_PALETTES.light;

  it('is exactly the content box with no caption and no folded figure', () => {
    const layout = layoutCreaseExport(emptyCaption, palette);

    expect(layout).toMatchObject({ width: 1024, height: 1024 });
    expect(layout.cp).toEqual({ x: 0, y: 0, width: 1024, height: 1024 });
    expect(layout.folded).toBeNull();
  });

  it('places the folded figure to the right of the crease pattern', () => {
    const layout = layoutCreaseExport(emptyCaption, palette, { width: 600, height: 800 });

    expect(layout.folded).not.toBeNull();
    // The figure starts where the crease pattern's box ends — that box's own
    // margin is the gap — and the page adds a matching margin on the outside.
    expect(layout.folded!.x).toBe(layout.cp.x + layout.cp.width);
    expect(layout.folded!.y).toBe(layout.cp.y);
    expect(layout.width).toBeGreaterThan(layout.cp.width + layout.folded!.width);
  });

  it('counts the pattern\'s own margin toward the gap under the caption', () => {
    const captioned = { ...emptyCaption, title: 'Crane' };
    const noInset = layoutCreaseExport(captioned, palette, null, { top: 0, bottom: 0 });
    const inset = layoutCreaseExport(captioned, palette, null, { top: 48, bottom: 48 });

    // The drawn pattern sits the same distance below the title either way — the
    // inset is absorbed, not added on top.
    expect(inset.cp.y + 48).toBe(noInset.cp.y);
  });

  it('grows the page when the folded figure is taller than the pattern', () => {
    const layout = layoutCreaseExport(emptyCaption, palette, { width: 600, height: 1400 });

    expect(layout.height).toBe(1400);
  });
  it('keeps exported images the same way up as the editor', () => {
    // FOLD coordinates are y-down: the CP editor's model space is y-down
    // (cpModelToSvg never flips) and the TreeMaker engine
    // converts its internal y-up vertices on the way out (to_fold_document emits
    // `paper_height - loc.y`). Projecting with a flip mirrored every export
    // relative to what the user drew.
    const projector = foldProjector({
      vertices_coords: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      edges_assignment: ['B', 'B', 'B', 'B'],
      faces_vertices: [[0, 1, 2, 3]],
    });

    const top = projector.projectPoint({ x: 0, y: 0 });
    const bottom = projector.projectPoint({ x: 0, y: 10 });
    // Smaller fold y must land at a smaller SVG y (nearer the top of the image).
    expect(top.y).toBeLessThan(bottom.y);
  });
});
