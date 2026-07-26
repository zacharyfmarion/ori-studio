import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import { segmentFoldDocument } from './creasePatternSegmentation';
import type { OristudioCpFoldedRenderSnapshot } from '../engine/oristudioCpTypes';
import {
  buildCreaseExportArtwork,
  serializeCreasePatternSvg,
  layoutCreaseExport,
  wrapExportText,
  CREASE_EXPORT_PALETTES,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  type CreaseExportCaption,
  type CreaseExportOptions,
} from './creaseExport';

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

  it('draws every crease black in the black-white style', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      lineStyle: 'black-white',
    });

    expect(svg).toContain('stroke="#000000"');
    expect(svg).not.toContain('stroke="#ff4d5d"');
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
});
