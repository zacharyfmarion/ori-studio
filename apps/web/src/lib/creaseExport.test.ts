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
  cpLineStyleDashPatterns,
  ORIEDITA_DASH_ONE_DOT,
  ORIEDITA_DASH_TWO_DOT,
  ORIEDITA_DASH_VALLEY,
  ORISTUDIO_DASH_HINT,
  ORISTUDIO_DASH_UNASSIGNED,
  UNASSIGNED_DASH_SLOT,
} from './oristudioCpLineStyle';
import {
  ORISTUDIO_CP_LINE_STYLES,
  ORISTUDIO_CP_MAX_LINE_WIDTH,
  ORISTUDIO_CP_MIN_LINE_WIDTH,
} from './creasePatternViewport';

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
   * A dash array is not a picture.
   *
   * Every assertion above this point reads the runs the export *emits*, and that
   * is how an undecided crease came to export as a solid line while all of them
   * passed: the runs were right at every line width, and the file rasterized
   * with no gap in it from width 5 up. `stroke-linecap="round"` adds half the
   * stroke width past each end of each mark, so a dash's marks grow by the
   * stroke width and its gaps shrink by it — a cap is decoration on two ends of
   * a stroke until a dash gives the stroke 2n of them, and then it is the
   * pattern. The line-width slider reaches 8, where the stroke is 17.07 units
   * against the undecided dash's 9.96-unit gaps.
   *
   * So what is swept here is what a renderer paints, across the whole slider.
   * The model is the SVG cap rule and nothing else — painted mark = run +
   * extend, painted gap = gap - extend, extend = the stroke width under a round
   * cap and zero under butt — and it was checked against Chromium rasterizing
   * these very files at 1024 px: 100% ink at widths 5-8 under the round cap,
   * and 31.5% (the pattern's 30%, plus antialiasing) at every width under butt.
   */
  describe('what the export paints, not what it emits', () => {
    const LINE_WIDTHS = Array.from(
      { length: ORISTUDIO_CP_MAX_LINE_WIDTH - ORISTUDIO_CP_MIN_LINE_WIDTH + 1 },
      (_, index) => ORISTUDIO_CP_MIN_LINE_WIDTH + index
    );

    /** One of every dash the export can draw: mountain, valley, undecided, hint. */
    function everyDashFold(): FoldDocument {
      return {
        vertices_coords: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0.5, 0],
          [1, 0.5],
          [0.5, 1],
          [0, 0.5],
        ],
        edges_vertices: [
          [0, 4],
          [4, 1],
          [1, 5],
          [5, 2],
          [2, 6],
          [6, 3],
          [3, 7],
          [7, 0],
          [4, 6],
          [7, 5],
          [0, 2],
          [1, 3],
        ],
        edges_assignment: [
          ...['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B'],
          'M',
          'V',
          'U',
          'U',
        ],
        'oristudio:edges_fold_direction_hint': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
        faces_vertices: [[0, 4, 1, 5, 2, 6, 3, 7]],
      } as FoldDocument;
    }

    interface PaintedStroke {
      stroke: string;
      runs: number[];
      /** Smallest gap surviving between two marks once the caps have had theirs. */
      minGap: number;
      /** Fraction of the crease this stroke inks. */
      inkFraction: number;
      /** Length of the crease it is drawn on, and of one pattern repeat. */
      length: number;
      period: number;
    }

    function paintedStrokes(svg: string): PaintedStroke[] {
      return [...svg.matchAll(/<line ([^>]*)\/>/g)].flatMap(([, attrs]) => {
        const runs = /stroke-dasharray="([^"]+)"/
          .exec(attrs)?.[1]
          ?.split(' ')
          .map(Number);
        if (!runs) return [];
        const width = Number(/stroke-width="([\d.]+)"/.exec(attrs)?.[1]);
        const extend = /stroke-linecap="round"/.test(attrs) ? width : 0;
        const ends = /x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/.exec(attrs) ?? [];
        const [x1, y1, x2, y2] = ends.slice(1).map(Number) as number[];
        const period = runs.reduce((sum, run) => sum + run, 0);
        return [
          {
            stroke: /stroke="([^"]+)"/.exec(attrs)?.[1] ?? '',
            runs,
            minGap: Math.min(...runs.filter((_, i) => i % 2 === 1).map((gap) => gap - extend)),
            inkFraction:
              runs.filter((_, i) => i % 2 === 0).reduce((sum, run) => sum + run + extend, 0) /
              period,
            length: Math.hypot((x2 ?? 0) - (x1 ?? 0), (y2 ?? 0) - (y1 ?? 0)),
            period,
          },
        ];
      });
    }

    const svgAt = (lineStyle: CreaseExportOptions['lineStyle'], lineWidth: number) => {
      const fold = everyDashFold();
      return serializeCreasePatternSvg(fold, segmentFoldDocument(fold), {
        ...DEFAULT_CREASE_EXPORT_OPTIONS,
        lineStyle,
        lineWidth,
      });
    };

    it('leaves a gap in every dash it draws, at every width the slider offers', () => {
      // The one that would have caught it. An undecided crease that paints
      // solid is a shared picture claiming a crease the user has not decided;
      // the same closure takes the mountain chain from width 2, where a
      // mountain becomes indistinguishable from a paper edge.
      for (const lineStyle of ORISTUDIO_CP_LINE_STYLES) {
        for (const lineWidth of LINE_WIDTHS) {
          for (const painted of paintedStrokes(svgAt(lineStyle, lineWidth))) {
            const at = { lineStyle, lineWidth, runs: painted.runs };
            expect({ ...at, gapped: painted.minGap > 0 }).toEqual({ ...at, gapped: true });
          }
        }
      }
    });

    it('inks an undecided crease at the fraction the canvas inks it, at every width', () => {
      // Not merely "some gap survives": the whole argument for these runs is
      // that sparse ink reads as less than a crease (see
      // `ORISTUDIO_DASH_UNASSIGNED`), and a picture at 45% ink where the canvas
      // shows 30% has spent half of that. The hint's 15% goes the same way.
      const fraction = (pattern: readonly number[]) =>
        pattern.filter((_, i) => i % 2 === 0).reduce((sum, run) => sum + run, 0) /
        pattern.reduce((sum, run) => sum + run, 0);
      const { unassigned, valley } = CREASE_EXPORT_PALETTES.light;

      for (const lineWidth of LINE_WIDTHS) {
        const painted = paintedStrokes(svgAt('color', lineWidth));
        const inkOf = (stroke: string) =>
          Number(painted.find((entry) => entry.stroke === stroke)?.inkFraction.toFixed(2));
        expect({ lineWidth, base: inkOf(unassigned), hint: inkOf(valley) }).toEqual({
          lineWidth,
          base: Number(fraction(ORISTUDIO_DASH_UNASSIGNED).toFixed(2)),
          hint: Number(fraction(ORISTUDIO_DASH_HINT).toFixed(2)),
        });
      }
    });

    it('keeps the round cap where a cap is still decoration: on a solid crease', () => {
      // Butting every stroke would trade one defect for another. On a solid
      // crease the two half-discs are just its ends, and they fill the notch
      // where several creases meet a vertex — there is no pattern for them to
      // eat. The split is the fix; "no round caps anywhere" is not.
      const caps = (svg: string, stroke: string) =>
        [...svg.matchAll(/<line ([^>]*)\/>/g)]
          .map(([, attrs]) => attrs)
          .filter((attrs) => attrs.includes(`stroke="${stroke}"`))
          .map((attrs) => ({
            dashed: attrs.includes('stroke-dasharray'),
            cap: /stroke-linecap="([a-z]+)"/.exec(attrs)?.[1],
          }));
      const svg = svgAt('color', ORISTUDIO_CP_MAX_LINE_WIDTH);

      expect(caps(svg, CREASE_EXPORT_PALETTES.light.border)).toContainEqual({
        dashed: false,
        cap: 'round',
      });
      expect(caps(svg, CREASE_EXPORT_PALETTES.light.unassigned)).toContainEqual({
        dashed: true,
        cap: 'butt',
      });
    });

    it('dashes at a rate the document sets, which the canvas has no term for', () => {
      // Deliberate, not incidental — the reasoning is on `edgeAppearance`, and
      // this is here so the divergence is a decision on the record rather than
      // something a later reader discovers. The export fits the drawn
      // document's bounding box to the page, so widening that box shrinks
      // everything in it: the *same* crease, unchanged, carries a quarter of
      // the marks once a second pattern four times as wide shares the file.
      // Nothing on the canvas does this — `cpModelToSvg` is one fixed affine,
      // so that crease is the same length on screen either way.
      const diagonal = (extra: number[][], extraEdges: number[][]): FoldDocument =>
        ({
          vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], ...extra],
          edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], ...extraEdges],
          edges_assignment: ['B', 'B', 'B', 'B', 'U', ...extraEdges.map(() => 'B')],
          faces_vertices: [
            [0, 1, 2],
            [0, 2, 3],
          ],
        }) as FoldDocument;

      const alone = diagonal([], []);
      // A second square out at x = 3..4, which widens the bounding box 4x and
      // touches nothing else.
      const beside = diagonal(
        [
          [3, 0],
          [4, 0],
          [4, 1],
          [3, 1],
        ],
        [
          [4, 5],
          [5, 6],
          [6, 7],
          [7, 4],
        ]
      );
      const marks = (fold: FoldDocument) => {
        const painted = paintedStrokes(
          serializeCreasePatternSvg(fold, segmentFoldDocument(fold), {
            ...DEFAULT_CREASE_EXPORT_OPTIONS,
            lineStyle: 'color',
          })
        );
        const dash = painted[0]!;
        return dash.length / dash.period;
      };

      expect(marks(alone) / marks(beside)).toBeCloseTo(4, 1);
    });
  });

  /**
   * A hinted crease is the undecided dash with every other mark taken in the
   * direction's own colour. Where those marks land is swept over crease length
   * in `oristudioCpLineStyle.test.ts`; that sweep speaks for the export only
   * while the export hands SVG the same run list unaltered, so what is checked
   * here is that it does — the array verbatim, and no phase on top of it.
   */
  describe('a hinted undecided crease', () => {
    const scaled = (pattern: readonly number[]) =>
      pattern.map((run) => (run * (1024 / 720)).toFixed(2)).join(' ');

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
      expect(svg).toContain(`stroke-dasharray="${scaled(ORISTUDIO_DASH_HINT)}"`);
      expect(svg).toContain(`stroke="${CREASE_EXPORT_PALETTES.light.valley}"`);
    });

    it('starts both strokes at the crease, so a short crease keeps its direction', () => {
      // A phase here would be a hint that vanishes rather than a hint that
      // shifts: the export's dash is in paper units, so any crease shorter than
      // the offset would draw its grey and drop its colour. Nothing may wind
      // either stroke forward.
      expect(svgFor(1, 'color')).not.toContain('stroke-dashoffset');
      expect(scaled(ORISTUDIO_DASH_HINT).startsWith('0.00')).toBe(false);
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
      const plain = svgFor(0, 'color');
      expect(plain).toContain(`stroke-dasharray="${scaled(ORISTUDIO_DASH_UNASSIGNED)}"`);
      expect(plain).not.toContain(`stroke-dasharray="${scaled(ORISTUDIO_DASH_HINT)}"`);
      expect(plain).not.toContain(`stroke="${CREASE_EXPORT_PALETTES.light.mountain}"`);
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
