import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { DEFAULT_PAPER_EXPORT_SETTINGS, type PaperExportSettings } from '../../lib/paperExportSettings';
import { paperPresetRows } from '../../lib/paperPresetRows';
import {
  createPaperExportSession,
  paintPaperExport,
  paperExportPage,
  paperExportSceneInput,
  paperExportStyle,
} from '../../paperExport/paperExportSession';
import { paperExportDraft } from '../../paperExport/usePaperExportDialog';
import golden from './__fixtures__/referencesStepExportGolden.json';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { referencesExportTarget, type ReferencesExportCapture } from './referencesExportTarget';
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

/** The page the dialog saves for these remembered options, exactly as the dialog reaches it. */
async function dialogPage(
  capture: Omit<ReferencesExportCapture, 'diagram' | 'title' | 'fileStem' | 'exportStyle'>,
  remembered: PaperExportSettings
) {
  const target = referencesExportTarget({
    ...capture,
    diagram: stepDiagram(),
    title: 'Export step 3',
    fileStem: 'Crane step 3',
    exportStyle: DEFAULT_PAPER_STYLE,
  });
  const rows = paperPresetRows([]);
  const draft = paperExportDraft(remembered, { format: null }, rows);
  const style = paperExportStyle(target, draft.style, rows);
  const scene = await createPaperExportSession(target).scene(
    paperExportSceneInput(target, style, draft)
  );
  return paintPaperExport(target, scene!, style, paperExportPage(target, draft));
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
});
