import { describe, expect, it } from 'vitest';
import type { PaperScene } from '../../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { DEFAULT_PAPER_EXPORT_SETTINGS, type PaperExportSettings } from '../../lib/paperExportSettings';
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
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { referencesExportTarget } from './referencesExportTarget';
import { decodePlanModel, planModelPoints, planStepScene } from './referencesPlanGeometry';

/**
 * The export dialog must write, for a References step, byte for byte the page
 * the direct export wrote before the dialog existed.
 *
 * The golden pages were painted by that export — `referencesStepExportPage`
 * and its hook, as they stood before the dialog (197b46286) — and are
 * compared here with the dialog's own path: the draft, the style it resolves,
 * the session's scene, and the paint. Comparing with today's
 * `referencesStepScene` instead would compare the code with itself.
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
  sheetCssPx: number;
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
    sheetCssPx: capture.sheetCssPx,
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
  it('writes the direct export’s page at the defaults', async () => {
    const page = await dialogPage(
      { mirrored: false, sheetCssPx: 800, lineWidth: 1, showAux: null },
      DEFAULT_PAPER_EXPORT_SETTINGS
    );
    expect(page).toEqual(golden.defaults);
  });

  it('writes it for a picked preset, a coloured page, a set size and margin, the back, and aux lines shown', async () => {
    const page = await dialogPage(
      { mirrored: true, sheetCssPx: 640, lineWidth: 1.5, showAux: true },
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
    const exported = target({ mirrored: false, sheetCssPx: 400, lineWidth: 1, showAux: null }, [
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

  it('offers both marks, keys its scene by them, and builds a page without the ones that are off', async () => {
    const exported = target({ mirrored: false, sheetCssPx: 400, lineWidth: 1, showAux: null });
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
      sheetCssPx: 400,
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
