import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import { segmentFoldDocument } from './creasePatternSegmentation';
import type { OristudioCpFoldedRenderSnapshot } from '../engine/oristudioCpTypes';
import {
  buildCreaseExportArtwork,
  foldProjector,
  serializeCreasePatternSvg,
  layoutCreaseExport,
  wrapExportText,
  CREASE_EXPORT_PALETTES,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  type CreaseExportCaption,
  type CreaseExportOptions,
} from './creaseExport';
import {
  alternateDashSvg,
  cpLineStyleDashPatterns,
  ORIEDITA_DASH_ONE_DOT,
  ORIEDITA_DASH_TWO_DOT,
  ORIEDITA_DASH_VALLEY,
  ORISTUDIO_DASH_UNASSIGNED,
  UNASSIGNED_DASH_SLOT,
} from './oristudioCpLineStyle';
import { ORISTUDIO_CP_LINE_STYLES } from './creasePatternViewport';

const countLines = (svg: string) => svg.match(/<line /g)?.length ?? 0;

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

  it('dots an undecided crease under every line style, as the canvas does', () => {
    // One square with a diagonal nobody has assigned yet — the state the whole
    // "never report silence" work exists for. The export has to look like the
    // canvas here or the picture a user shares claims a pattern is finished when
    // the app they exported it from does not.
    const fold: FoldDocument = {
      vertices_coords: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 2],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'U'],
      faces_vertices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    };
    const segments = segmentFoldDocument(fold);
    const scaled = (pattern: readonly number[]) =>
      pattern.map((run) => (run * (1024 / 720)).toFixed(2)).join(' ');

    for (const lineStyle of ORISTUDIO_CP_LINE_STYLES) {
      const svg = serializeCreasePatternSvg(fold, segments, {
        ...DEFAULT_CREASE_EXPORT_OPTIONS,
        lineStyle,
      });
      expect(svg).toContain(`stroke-dasharray="${scaled(ORISTUDIO_DASH_UNASSIGNED)}"`);
      // The four borders around it stay solid under the solid styles, so the
      // dash is the undecided crease's and not something the style did.
      if (lineStyle === 'color' || lineStyle === 'black-white') {
        expect(svg.match(/stroke-dasharray/g)).toHaveLength(1);
      }
    }
  });

  /**
   * A hinted crease is the undecided dash with every other mark taken in the
   * direction's own colour. The export reaches that through SVG's dash phase and
   * the canvas through a shifted run list, so what is checked here is the marks
   * and the ink — the two encodings are pinned against each other in
   * `oristudioCpLineStyle.test.ts`.
   */
  describe('a hinted undecided crease', () => {
    const scaled = (pattern: readonly number[]) =>
      pattern.map((run) => (run * (1024 / 720)).toFixed(2)).join(' ');
    const alternate = alternateDashSvg(ORISTUDIO_DASH_UNASSIGNED);

    function hintedFold(hint: number): FoldDocument {
      return {
        vertices_coords: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        edges_vertices: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          [0, 2],
        ],
        edges_assignment: ['B', 'B', 'B', 'B', 'U'],
        'oristudio:edges_fold_direction_hint': [0, 0, 0, 0, hint],
        faces_vertices: [
          [0, 1, 2],
          [0, 2, 3],
        ],
      } as FoldDocument;
    }

    const svgFor = (hint: number, lineStyle: CreaseExportOptions['lineStyle']) => {
      const fold = hintedFold(hint);
      return serializeCreasePatternSvg(fold, segmentFoldDocument(fold), {
        ...DEFAULT_CREASE_EXPORT_OPTIONS,
        lineStyle,
      });
    };

    it('draws the direction at full strength, not washed toward the grey', () => {
      // The wash this replaced put the stroke somewhere between the two, which
      // read as faded. Nothing between them may appear.
      const svg = svgFor(1, 'color');
      expect(svg).toContain(`stroke="${CREASE_EXPORT_PALETTES.light.mountain}"`);
      expect(svg).toContain(`stroke="${CREASE_EXPORT_PALETTES.light.unassigned}"`);
    });

    it('takes the alternate marks of the dash the crease already has', () => {
      const svg = svgFor(2, 'color');
      expect(svg).toContain(`stroke-dasharray="${scaled(ORISTUDIO_DASH_UNASSIGNED)}"`);
      expect(svg).toContain(
        `stroke-dasharray="${scaled(alternate.array)}" stroke-dashoffset="${(
          alternate.offset *
          (1024 / 720)
        ).toFixed(2)}"`
      );
      expect(svg).toContain(`stroke="${CREASE_EXPORT_PALETTES.light.valley}"`);
    });

    it('is a second line over the first, not a line beside it', () => {
      const hinted = svgFor(1, 'color');
      const plain = svgFor(0, 'color');
      expect(countLines(hinted)).toBe(countLines(plain) + 1);
      // Same endpoints: whatever the two strokes say, they say it about one
      // crease. Both lines carry the diagonal's coordinates.
      const diagonal = /x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g;
      const ends = [...hinted.matchAll(diagonal)].map((m) => m[0]);
      expect(new Set(ends).size).toBe(ends.length - 1);
    });

    it('says nothing under the styles that ink every crease the same', () => {
      // The black-dot styles paint mountain, valley and undecided as one ink, so
      // an overlay would repaint the crease in its own colour. The canvas
      // declines for exactly this reason; see `appendDirectionHintDash`.
      for (const lineStyle of ['black-one-dot', 'black-two-dot'] as const) {
        expect(countLines(svgFor(1, lineStyle))).toBe(countLines(svgFor(0, lineStyle)));
      }
    });

    it('leaves an unhinted undecided crease exactly as it was', () => {
      expect(svgFor(0, 'color')).not.toContain('stroke-dashoffset');
    });
  });

  it('takes the undecided dots from the same slot the canvas reads', () => {
    // The canvas resolves a slot index into this table; the export resolves the
    // pattern directly. They agree only while the slot the export's colour maps
    // to holds the pattern the export draws.
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      expect(cpLineStyleDashPatterns(style)[UNASSIGNED_DASH_SLOT - 1]).toBe(
        ORISTUDIO_DASH_UNASSIGNED
      );
    }
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
