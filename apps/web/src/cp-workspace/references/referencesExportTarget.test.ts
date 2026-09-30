import { describe, expect, it } from 'vitest';
import type { PaperScene } from '../../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, PT_PER_MM } from '../../lib/paper/paperSvg';
import {
  DEFAULT_PAPER_EXPORT_SETTINGS,
  paperExportKindDefaults,
  type PaperExportSettings,
} from '../../lib/paperExportSettings';
import { paperPresetRows } from '../../lib/paperPresetRows';
import {
  createPaperExportSession,
  paintPaperExport,
  paperExportPage,
  paperExportSceneInput,
  paperExportStyle,
  paperScenesOnOneCrop,
} from '../../paperExport/paperExportSession';
import { paperExportDraft } from '../../paperExport/usePaperExportDialog';
import golden from './__fixtures__/referencesStepExportGolden.json';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';
import {
  canvasDiagramInk,
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_LABEL_INK,
  DIAGRAM_MARK_INK,
} from './diagram/diagramInk';
import type { StepDiagramModel, StepDiagramPrimitive } from './referenceFinderDiagramToPrimitives';
import { referencesExportTarget } from './referencesExportTarget';
import { ARROWHEAD_MIN_STROKES } from './stepDiagramGeometry';
import { decodePlanModel, planModelPoints, planStepScene } from './referencesPlanGeometry';

/**
 * The page the export dialog writes for a References step, byte for byte,
 * through the dialog's own path: the draft, the style it resolves, the
 * session's scene, and the paint.
 *
 * The golden pages were first painted by the direct export the dialog
 * replaced — `referencesStepExportPage` and its hook, as they stood before
 * the dialog (197b46286) — and were repainted when a step's scene came to be
 * built at the page's scale, so that its marks keep their on-screen size on a
 * sheet of any size (`referencesStepSheetCssPx`). At a chosen sheet size the
 * sheet and every line on it stayed the direct export's to the byte; only the
 * marks, and the room a letter takes, changed. They were repainted again when
 * the arrowheads took a printed diagram's smaller, concave shape and came to
 * sit on their strokes' ends: only the return stroke's end and the head moved.
 * Then the rings shrank to four fifths and took the arrow's pen, and the
 * letters that keep clear of them drew in, so the crop round them tightened.
 * Then the letters shrank by a ninth, the accent over a step's lines took the
 * edge pen's weight, and the sheet's border moved over the step's lines.
 * The defaults page is a printed diagram's step, the size the dialog opens a
 * step at.
 */

function mapToModel(points: Float64Array): Float64Array {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = points[i]! * 400 - 200;
    out[i + 1] = 200 - points[i + 1]! * 400;
  }
  return out;
}

/** A plan step's page, with a letter off the paper, which is haloed in the page's ground. */
function stepDiagram(): StepDiagramModel {
  const sequence = plannerSequenceWithGridFixture();
  const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));
  const page = planStepScene(sequence, model, 2).pageDiagram!;
  return {
    ...page,
    primitives: [...page.primitives, { kind: 'label', at: [-230, 230], text: 'A', style: 'action' }],
  };
}

interface StepCapture {
  mirrored: boolean;
  lineWidth: number;
  showAux: boolean | null;
}

function target(capture: StepCapture, diagrams: readonly StepDiagramModel[] = [stepDiagram()]) {
  return referencesExportTarget({
    steps: diagrams.map((diagram, index) => ({
      diagram,
      mirrored: capture.mirrored,
      label: `Step ${index + 1}`,
      entryStem: `${index + 1} step ${index + 1}`,
    })),
    current: 0,
    lineWidth: capture.lineWidth,
    showAux: capture.showAux,
    title: 'Export step 3',
    fileStem: 'Crane step 3',
    allTitle: 'Export all steps',
    zipStem: 'Crane steps',
    exportStyle: DEFAULT_PAPER_STYLE,
  });
}

/** The page the dialog saves for these remembered options, exactly as the dialog reaches it. */
async function dialogPage(capture: StepCapture, remembered: PaperExportSettings) {
  const exported = target(capture);
  const rows = paperPresetRows([]);
  const draft = paperExportDraft(remembered, { format: null }, rows);
  const style = paperExportStyle(exported, draft.style, rows);
  const scene = await createPaperExportSession(exported).scene(
    paperExportSceneInput(exported, style, draft)
  );
  return paintPaperExport(exported, scene!, style, paperExportPage(exported, draft));
}

describe('referencesExportTarget', () => {
  it('writes a printed diagram’s step at the defaults', async () => {
    const page = await dialogPage(
      { mirrored: false, lineWidth: 1, showAux: null },
      paperExportKindDefaults().step
    );
    expect(page).toEqual(golden.defaults);
  });

  it('writes it for a picked preset, a coloured page, a set size and margin, the back, and aux lines shown', async () => {
    const page = await dialogPage(
      { mirrored: true, lineWidth: 1.5, showAux: true },
      {
        ...DEFAULT_PAPER_EXPORT_SETTINGS,
        style: 'builtin:diagram',
        sheet: { mm: 120 },
        paddingMm: 12,
        background: '#223344',
      }
    );
    expect(page).toEqual(golden.custom);
  });

  it('builds each page from its own step, and keys it by the page', async () => {
    const first = stepDiagram();
    const second: StepDiagramModel = { ...first, primitives: first.primitives.slice(0, 3) };
    const exported = target({ mirrored: false, lineWidth: 1, showAux: null }, [
      first,
      second,
    ]);
    expect(exported.pages).toMatchObject({
      current: 0,
      title: 'Export all steps',
      zipStem: 'Crane steps',
      list: [
        { label: 'Step 1', fileStem: '1 step 1' },
        { label: 'Step 2', fileStem: '2 step 2' },
      ],
    });
    const input = paperExportSceneInput(exported, DEFAULT_PAPER_STYLE, DEFAULT_PAPER_EXPORT_SETTINGS);
    expect(exported.sceneKey({ ...input, page: 1 })).not.toBe(exported.sceneKey(input));
    const [one, two] = await Promise.all([
      exported.buildScene(input),
      exported.buildScene({ ...input, page: 1 }),
    ]);
    expect(two!.items.length).toBeLessThan(one!.items.length);
    await expect(exported.buildScene({ ...input, page: 2 })).resolves.toBeNull();
  });

  it('sizes a step by its sheet, the frame a diagram’s steps share', () => {
    expect(target({ mirrored: false, lineWidth: 1, showAux: null }).sizeMeasures).toBe('sheet');
    expect(paperExportKindDefaults().step.sheet).toEqual({ mm: 41 });
  });

  it('offers both marks, keys its scene by them, and builds a page without the ones that are off', async () => {
    const exported = target({ mirrored: false, lineWidth: 1, showAux: null });
    expect(exported.marks).toEqual(['letters', 'highlights']);
    const input = paperExportSceneInput(exported, DEFAULT_PAPER_STYLE, DEFAULT_PAPER_EXPORT_SETTINGS);
    const keys = new Set(
      [
        { letters: true, highlights: true },
        { letters: false, highlights: true },
        { letters: true, highlights: false },
        { letters: false, highlights: false },
      ].map((marks) => exported.sceneKey({ ...input, marks }))
    );
    expect(keys.size).toBe(4);

    const lettered = await exported.buildScene(input);
    const bare = await exported.buildScene({ ...input, marks: { letters: false, highlights: true } });
    const style = paperExportStyle(exported, 'export-style', paperPresetRows([]));
    const page = (scene: PaperScene) =>
      paintPaperExport(exported, scene, style, paperExportPage(exported, DEFAULT_PAPER_EXPORT_SETTINGS)).svg;
    expect(page(lettered!)).toContain('>A<');
    expect(page(bare!)).not.toContain('>A<');
  });

  it('puts the sheet in the same place on a front page and a back page cropped alike', async () => {
    // A sheet away from the model's origin, as the canvas has it.
    const diagram: StepDiagramModel = {
      sheet: { width: 400, height: 400, centre: [200, 200], axes: { x: [1, 0], y: [0, 1] } },
      primitives: [
        { kind: 'sheet', width: 400, height: 400 },
        { kind: 'line', from: [0, 200], to: [400, 200], style: 'mountain' },
      ],
    };
    const exported = referencesExportTarget({
      steps: [
        { diagram, mirrored: false, label: 'Step 1', entryStem: '1 step 1' },
        { diagram, mirrored: true, label: 'Step 2', entryStem: '2 step 2' },
      ],
      current: 0,
      lineWidth: 1,
      showAux: null,
      title: 'Export step 1',
      fileStem: 'Crane step 1',
      allTitle: 'Export all steps',
      zipStem: 'Crane steps',
      exportStyle: DEFAULT_PAPER_STYLE,
    });
    const input = paperExportSceneInput(exported, DEFAULT_PAPER_STYLE, DEFAULT_PAPER_EXPORT_SETTINGS);
    const scenes = await Promise.all([exported.buildScene(input), exported.buildScene({ ...input, page: 1 })]);
    const page = paperExportPage(exported, DEFAULT_PAPER_EXPORT_SETTINGS);
    const alone = paintPaperExport(exported, scenes[0]!, DEFAULT_PAPER_STYLE, page);
    const set = paperScenesOnOneCrop(scenes as PaperScene[]).map((scene) =>
      paintPaperExport(exported, scene, DEFAULT_PAPER_STYLE, page)
    );
    const sheetCorners = (svg: string) =>
      svg.match(/<polygon points="([^"]+)"/)![1]!.split(' ').sort();
    for (const each of set) {
      expect(each.widthPt).toBeCloseTo(alone.widthPt, 6);
      expect(sheetCorners(each.svg)).toEqual(sheetCorners(alone.svg));
    }
  });
});

describe('a step’s marks on the page', () => {
  /** The arrow and the edge each in an ink nothing else on the page is drawn in. */
  const STYLE: PaperStyle = {
    ...DEFAULT_PAPER_STYLE,
    edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#0a0b0c' },
    arrows: { width: 1.2, color: '#1a2b3c', dash: null, cap: 'round' },
  };
  const LINE_WIDTH = 1;

  /** Every element of one tag in some markup, as its attribute map. */
  function elements(markup: string, tag: string): Record<string, string>[] {
    return [...markup.matchAll(new RegExp(`<${tag}\\s([^>]*?)/?>`, 'g'))].map((match) =>
      Object.fromEntries([...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]))
    );
  }

  /** A ring, at the sheet's centre. */
  const RING: StepDiagramPrimitive = { kind: 'point', at: [0, 0], style: 'highlight' };

  /**
   * The step — the plan's, with its letter off the paper, and `extra` after
   * it — on a page of `mm`, through the target and the painter as the dialog
   * paints it: the page's own lines and face, and its marks with the scale the
   * painter placed them at.
   */
  async function pageAt(mm: number, extra: readonly StepDiagramPrimitive[] = [RING]) {
    const diagram = stepDiagram();
    const extended: StepDiagramModel = { ...diagram, primitives: [...diagram.primitives, ...extra] };
    const exported = target({ mirrored: false, lineWidth: LINE_WIDTH, showAux: null }, [extended]);
    const options = { ...DEFAULT_PAPER_EXPORT_SETTINGS, sheet: { mm } };
    const scene = await exported.buildScene(paperExportSceneInput(exported, STYLE, options));
    const { svg } = paintPaperExport(exported, scene!, STYLE, paperExportPage(exported, options));
    const rows = svg.split('\n');
    const group = rows.find((row) => row.startsWith('  <g transform='))!;
    const placed = /^ {2}<g transform="translate\(\S+ \S+\) scale\(([^)]+)\)">(.*)<\/g>$/;
    const [, scale, markup] = placed.exec(group)!;
    return {
      /** The page outside the marks: the face and the lines, one element a row. */
      page: rows.filter((row) => row !== group).join('\n'),
      markup: markup!,
      /** Page pt per unit of the marks' own markup. */
      scale: Number(scale),
    };
  }

  it('keeps every mark its on-screen size at any sheet size, as the lines keep their widths', async () => {
    // What each mark is on screen, in pt: its CSS px in the big view's ink.
    const ink = canvasDiagramInk(LINE_WIDTH) * PT_PER_CSS_PX;
    for (const mm of [41, 120]) {
      const { page, markup, scale } = await pageAt(mm);
      // The paper alone takes the sheet size.
      const [sheet] = elements(page, 'polygon');
      const corners = sheet!.points!.split(' ').map((pair) => pair.split(',').map(Number));
      const xs = corners.map(([x]) => x!);
      const ys = corners.map(([, y]) => y!);
      expect(Math.max(...xs) - Math.min(...xs), `${mm} mm`).toBeCloseTo(mm * PT_PER_MM, 1);
      expect(Math.max(...ys) - Math.min(...ys), `${mm} mm`).toBeCloseTo(mm * PT_PER_MM, 1);
      // The edge is its pen's pt.
      const edges = elements(page, 'line').filter((line) => line.stroke === STYLE.edges.color);
      expect(edges).toHaveLength(4);
      for (const edge of edges) expect(Number(edge['stroke-width'])).toBe(STYLE.edges.width);
      // The marks are placed at the screen's own ratio, so each is its CSS size.
      expect(scale, `${mm} mm`).toBeCloseTo(PT_PER_CSS_PX, 9);
      // The arrow is its pen's pt, as a line is.
      const arrows = [...elements(markup, 'path'), ...elements(markup, 'line')].filter(
        (element) => element.stroke === STYLE.arrows.color
      );
      expect(arrows.length, `${mm} mm`).toBeGreaterThan(0);
      for (const arrow of arrows) {
        expect(Number(arrow['stroke-width']) * scale, `${mm} mm`).toBeCloseTo(STYLE.arrows.width, 6);
      }
      // A letter and its halo, and a ring, are what they are on screen; the
      // ring's stroke is the arrow's pen, which it shares with its arrow.
      const letters = elements(markup, 'text');
      expect(letters.length, `${mm} mm`).toBeGreaterThan(0);
      for (const letter of letters) {
        expect(Number(letter['font-size']) * scale).toBeCloseTo(DIAGRAM_LABEL_INK.size * ink, 6);
        expect(Number(letter['stroke-width']) * scale).toBeCloseTo(DIAGRAM_LABEL_INK.halo * ink, 6);
      }
      const rings = elements(markup, 'circle');
      expect(rings.length, `${mm} mm`).toBeGreaterThan(0);
      for (const ring of rings) {
        expect(Number(ring.r) * scale).toBeCloseTo(DIAGRAM_MARK_INK.radius * ink, 6);
        expect(Number(ring['stroke-width']) * scale).toBeCloseTo(STYLE.arrows.width, 6);
      }
    }
  });

  /**
   * An arrowhead's length, tip to the middle of the line through its barbs, in
   * its own units, from its path: `M tip L barb Q control barb Z`.
   */
  function headLength(d: string): number {
    const [tx, ty, ax, ay, , , bx, by] = d
      .split(' ')
      .filter((token) => !/[A-Z]/.test(token))
      .map(Number) as [number, number, number, number, number, number, number, number];
    return Math.hypot(tx - (ax + bx) / 2, ty - (ay + by) / 2);
  }

  it('gives an arrowhead its on-screen size, and a short fold’s a share of its chord but never under four strokes, as the view does', async () => {
    // A quarter-turn of a 40-unit circle: a chord of 57 units on the plan's
    // 400-unit sheet, where the plan's own fold spans 141.
    const short: StepDiagramPrimitive = {
      kind: 'fold-arrow',
      out: { center: [0, 0], radius: 40, from: 0, to: Math.PI / 2, ccw: true },
    };
    const chordPt = (mm: number) => (40 * Math.SQRT2 * mm * PT_PER_MM) / 400;
    const onScreen = DIAGRAM_ARROWHEAD_INK.length * canvasDiagramInk(LINE_WIDTH) * PT_PER_CSS_PX;
    /** Each arrow's head, and every arrow stroke's weight, in pt on the page. */
    const arrowsAt = async (mm: number) => {
      const { markup, scale } = await pageAt(mm, [short]);
      const paths = elements(markup, 'path');
      return {
        // A head is filled in the arrow's ink, a stroke stroked in it.
        heads: paths
          .filter((path) => path.fill === STYLE.arrows.color)
          .map((path) => headLength(path.d!) * scale),
        strokes: paths
          .filter((path) => path.stroke === STYLE.arrows.color)
          .map((path) => Number(path['stroke-width']) * scale),
      };
    };
    const small = await arrowsAt(41);
    const large = await arrowsAt(120);
    const [planned41, short41] = small.heads;
    const [planned120, short120] = large.heads;
    // A fold long enough for its head keeps the head's on-screen size.
    expect(planned41).toBeCloseTo(onScreen, 2);
    expect(planned120).toBeCloseTo(onScreen, 2);
    expect(short120).toBeCloseTo(onScreen, 2);
    // On a 41 mm sheet the short one's chord is 16 pt, and a full head would
    // be half of it: it is held to the share of its own chord the view holds
    // it to — which here would leave it no wider than its stroke, so it stops
    // at four strokes long — while every stroke keeps the pen's weight.
    const floor = ARROWHEAD_MIN_STROKES * STYLE.arrows.width;
    expect(DIAGRAM_ARROWHEAD_INK.ofChord * chordPt(41)).toBeLessThan(floor);
    expect(short41).toBeCloseTo(floor, 2);
    expect(short41).toBeLessThan(onScreen);
    for (const { strokes } of [small, large]) {
      expect(strokes).toHaveLength(4);
      for (const stroke of strokes) expect(stroke).toBeCloseTo(STYLE.arrows.width, 6);
    }
  });

  it('builds a scene per sheet size', () => {
    const exported = target({ mirrored: false, lineWidth: LINE_WIDTH, showAux: null });
    const key = (sheet: PaperExportSettings['sheet']) =>
      exported.sceneKey(
        paperExportSceneInput(exported, STYLE, { ...DEFAULT_PAPER_EXPORT_SETTINGS, sheet })
      );
    expect(key({ mm: 120 })).not.toBe(key({ mm: 41 }));
    expect(key({ mm: 41 })).toBe(key({ mm: 41 }));
  });
});
