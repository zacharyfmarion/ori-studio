import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_PAGE, type PaperPage } from '../../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, pageMarginPt, type PaperSvgResult } from '../../lib/paper/paperSvg';
import type { FileService } from '../../platform/fileService';
import type { StepDiagramModel, StepDiagramPrimitive } from './referenceFinderDiagramToPrimitives';
import {
  REFERENCES_STEP_EXPORT_FALLBACK_SHEET_PX,
  referencesSheetCssPx,
  referencesSequenceSubject,
  referencesStepExportName,
  referencesStepExportPage,
  saveReferencesStep,
} from './referencesStepExport';
import { DIAGRAM_PADDING } from './stepDiagramGeometry';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';
import { planFilmstrip } from './referencesFilmstrip';
import type { ReferencesPlanVariant } from './referencesResults';
import { decodePlanModel, planModelPoints, planStepScene } from './referencesPlanGeometry';
import type { ReferencesViewStep } from './referencesSequenceView';

const { paperSvgToPng } = vi.hoisted(() => ({
  paperSvgToPng: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock('../../lib/paper/paperPng', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/paper/paperPng')>()),
  paperSvgToPng,
}));

/**
 * A step on the canvas: the model frame's sheet is 400 units square with its
 * middle at (200, 200) and the frame's axes (`frame.rs`: y is screen "up").
 */
const SHEET = {
  width: 400,
  height: 400,
  centre: [200, 200] as const,
  axes: { x: [1, 0] as const, y: [0, -1] as const },
};

function model(...primitives: StepDiagramPrimitive[]): StepDiagramModel {
  return { sheet: SHEET, primitives };
}

const MOUNTAIN: StepDiagramPrimitive = {
  kind: 'line',
  from: [0, 200],
  to: [400, 200],
  style: 'mountain',
};
const LETTER: StepDiagramPrimitive = { kind: 'label', at: [0, 0], text: 'A', style: 'action' };

function paint(
  diagram: StepDiagramModel,
  options: {
    style?: PaperStyle;
    page?: PaperPage;
    mirrored?: boolean;
    sheetCssPx?: number;
    showAux?: boolean | null;
  } = {}
) {
  return referencesStepExportPage(diagram, {
    style: options.style ?? DEFAULT_PAPER_STYLE,
    page: options.page ?? DEFAULT_PAPER_PAGE,
    mirrored: options.mirrored ?? false,
    sheetCssPx: options.sheetCssPx ?? 512,
    lineWidth: 1,
    showAux: options.showAux ?? null,
  });
}

describe('referencesSheetCssPx', () => {
  it('is the sheet’s longer side through the camera’s scale', () => {
    const camera = { view: { origin: [10, 20] as const, ex: [2, 0] as const, ey: [0, 2] as const } };
    expect(referencesSheetCssPx({ width: 400, height: 300 }, camera)).toBe(800);
    // The mirrored view reflects x; the size is the same.
    const back = { view: { origin: [10, 20] as const, ex: [-2, 0] as const, ey: [0, 2] as const } };
    expect(referencesSheetCssPx({ width: 400, height: 300 }, back)).toBe(800);
  });

  it('takes a fixed size before the view has drawn a frame', () => {
    expect(referencesSheetCssPx({ width: 400, height: 400 }, null)).toBe(
      REFERENCES_STEP_EXPORT_FALLBACK_SHEET_PX
    );
    expect(REFERENCES_STEP_EXPORT_FALLBACK_SHEET_PX).toBe(512);
  });
});

describe('referencesStepExportPage', () => {
  it('puts the sheet on the page at its on-screen size, with the card’s band round it', () => {
    const page = paint(model(MOUNTAIN), { sheetCssPx: 512 });
    // The box is the sheet plus DIAGRAM_PADDING of the box each side.
    const boxPx = 512 / (1 - 2 * DIAGRAM_PADDING);
    const margin = pageMarginPt(DEFAULT_PAPER_STYLE, DEFAULT_PAPER_PAGE);
    expect(page.widthPt).toBeCloseTo(boxPx * PT_PER_CSS_PX + 2 * margin, 6);
    expect(page.heightPt).toBeCloseTo(boxPx * PT_PER_CSS_PX + 2 * margin, 6);
    // A bigger view is a bigger page: as shown.
    expect(paint(model(MOUNTAIN), { sheetCssPx: 1024 }).widthPt).toBeGreaterThan(page.widthPt);
  });

  it('paints with the style handed to it, through the references policy', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      paper: { ...DEFAULT_PAPER_STYLE.paper, front: '#ab12cd' },
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, color: '#123456' },
    };
    const { svg } = paint(model(MOUNTAIN), { style });
    expect(svg).toContain('fill="#ab12cd"');
    expect(svg).toContain('stroke="#123456"');
  });

  it('paints the page it is given', () => {
    const page: PaperPage = { ...DEFAULT_PAPER_PAGE, background: '#fafafa' };
    const { svg } = paint(model(MOUNTAIN), { page });
    expect(svg).toContain('fill="#fafafa"');
    // The page's ground is a letter's halo, as the workspace's ground is on screen.
    const lettered = paint(model(MOUNTAIN, LETTER), { page }).svg;
    expect(lettered).toContain('A');
    expect(lettered.split('#fafafa').length).toBeGreaterThan(2);
  });

  it('is the paper’s back, every fold named from that side, when the reader is', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      paper: { front: '#ffffff', back: '#00ff00' },
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, color: '#111111' },
      valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, color: '#222222' },
    };
    const front = paint(model(MOUNTAIN), { style }).svg;
    expect(front).toContain('fill="#ffffff"');
    expect(front).toContain('stroke="#111111"');
    // The model frame is left-handed, so the projector alone would read the
    // front as mirrored; the reader's side decides.
    const back = paint(model(MOUNTAIN), { style, mirrored: true }).svg;
    expect(back).toContain('fill="#00ff00"');
    expect(back).toContain('stroke="#222222"');
    expect(back).not.toContain('stroke="#111111"');
  });
});

describe('a sequence step on the page', () => {
  /** The planner's unit frame scaled and flipped, as `rfToModelMany` maps it. */
  function mapToModel(points: Float64Array): Float64Array {
    const out = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      out[i] = points[i]! * 400 - 200;
      out[i + 1] = 200 - points[i + 1]! * 400;
    }
    return out;
  }

  const AUX = '#abcdef';
  const style: PaperStyle = {
    ...DEFAULT_PAPER_STYLE,
    auxCreases: { visible: true, pen: { width: 0.3, color: AUX, dash: null, cap: 'butt' } },
  };
  const auxLines = (
    diagram: StepDiagramModel,
    options: { style?: PaperStyle; showAux?: boolean | null } = {}
  ) =>
    [
      ...paint(diagram, { style: options.style ?? style, showAux: options.showAux })
        .svg.matchAll(/<line\s([^>]*)\/>/g),
    ].filter((match) => match[1]!.includes(`stroke="${AUX}"`)).length;

  // The canvas has the document's own creases under the overlay, so the
  // diagram it draws leaves out every earlier crease the pattern holds; a
  // file has nothing under it. Painted from that one a step came out as the
  // current fold alone on bare paper.
  it('carries the creases made so far, which the big view draws underneath', () => {
    const sequence = plannerSequenceWithGridFixture();
    const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));
    const scene = planStepScene(sequence, model, 2);
    expect(auxLines(scene.pageDiagram!)).toBeGreaterThan(auxLines(scene.diagram!));
  });

  // The made creases are the paper as it stands, whatever the aux switch
  // says; the pattern's own aux lines are on the page as the References
  // option says, the export style's switch until it is set.
  it('keeps the made creases with the aux switch off, and the sheet’s aux lines as shown', () => {
    const sequence = plannerSequenceWithGridFixture();
    const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));
    const plain = planStepScene(sequence, model, 2).pageDiagram!;
    const guides = planStepScene(sequence, model, 2, undefined, [
      [
        { x: -200, y: 0 },
        { x: 200, y: 0 },
      ],
    ]).pageDiagram!;
    const off: PaperStyle = { ...style, auxCreases: { ...style.auxCreases, visible: false } };
    const made = auxLines(plain);
    expect(made).toBeGreaterThan(0);
    expect(auxLines(plain, { style: off })).toBe(made);
    expect(auxLines(guides)).toBe(made + 1);
    expect(auxLines(guides, { style: off })).toBe(made);
    expect(auxLines(guides, { style: off, showAux: true })).toBe(made + 1);
    expect(auxLines(guides, { showAux: false })).toBe(made);
  });
});

describe('referencesStepExportName', () => {
  it('names the card as the strip counts it', () => {
    expect(referencesStepExportName('Crane', { kind: 'step', step: 2 })).toBe('Crane step 3');
    expect(referencesStepExportName('  ', { kind: 'step', step: 0 })).toBe('Untitled step 1');
  });

  it('names a candidate’s step by the candidate too, so its steps are not one file', () => {
    expect(referencesStepExportName('Crane', { kind: 'reference', candidate: 1, step: 0 })).toBe(
      'Crane reference 2 step 1'
    );
  });

  it('names a turn-over by the folds before it, never by a step number it does not have', () => {
    expect(referencesStepExportName('Crane', { kind: 'turn-over', after: 2 })).toBe(
      'Crane turn over after step 2'
    );
    expect(referencesStepExportName('Crane', { kind: 'turn-over', after: 0 })).toBe(
      'Crane turn over'
    );
  });
});

describe('referencesSequenceSubject', () => {
  const fold = (step: number): ReferencesViewStep => ({
    kind: 'fold',
    side: 'front',
    component: 0,
    step,
  });
  const steps: ReferencesViewStep[] = [
    fold(0),
    fold(1),
    { kind: 'turn-over', side: 'front', component: 0, after: 1 },
    fold(2),
    { kind: 'done', side: 'front', component: 0 },
  ];

  // The active step is an index into the view's steps, which count the
  // turn-overs and the ending; the strip numbers only the folds. Taking the
  // index for the number made the third fold's file "step 4".
  it('takes the number the strip prints on the card, not the card’s place in the view', () => {
    expect(steps.map((_, index) => referencesSequenceSubject(steps, index))).toEqual([
      { kind: 'step', step: 0 },
      { kind: 'step', step: 1 },
      { kind: 'turn-over', after: 2 },
      { kind: 'step', step: 2 },
      { kind: 'turn-over', after: 3 },
    ]);
    expect(referencesStepExportName('Crane', referencesSequenceSubject(steps, 3))).toBe(
      'Crane step 3'
    );
  });

  it('agrees with the strip, card for card', () => {
    const numbers = planFilmstrip(
      ((key: string, fallback: string) => fallback) as unknown as TFunction,
      [{ sequence: plannerSequenceWithGridFixture() } as ReferencesPlanVariant],
      steps,
      []
    ).map((card) => card.number);
    expect(
      steps.map((_, index) => {
        const subject = referencesSequenceSubject(steps, index);
        return subject.kind === 'step' ? subject.step + 1 : null;
      })
    ).toEqual(numbers);
  });
});

describe('saveReferencesStep', () => {
  const PAGE: PaperSvgResult = { svg: '<svg/>', widthPt: 10, heightPt: 10 };

  function fileService() {
    return {
      saveTextFile: vi.fn(async (options: { suggestedName: string }) => ({
        name: options.suggestedName,
        path: null,
      })),
      saveBinaryFile: vi.fn(async (options: { suggestedName: string }) => ({
        name: options.suggestedName,
        path: null,
      })),
    } as unknown as FileService & {
      saveTextFile: ReturnType<typeof vi.fn>;
      saveBinaryFile: ReturnType<typeof vi.fn>;
    };
  }

  it('saves the SVG under the step’s name, through the one filename rule', async () => {
    const service = fileService();
    await expect(
      saveReferencesStep({ page: PAGE, format: 'svg', name: 'Crane step 3', fileService: service })
    ).resolves.toBe('Crane-step-3.svg');
    expect(service.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ contents: '<svg/>', extensions: ['svg'] })
    );
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
  });

  it('rasterises a PNG at the density asked for', async () => {
    paperSvgToPng.mockClear();
    const service = fileService();
    await expect(
      saveReferencesStep({
        page: PAGE,
        format: 'png',
        pngDpi: 300,
        name: 'Crane step 3',
        fileService: service,
      })
    ).resolves.toBe('Crane-step-3.png');
    expect(paperSvgToPng).toHaveBeenCalledWith(PAGE, 300);
    expect(service.saveBinaryFile).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
    );
  });

  it('answers null for a dismissed dialog', async () => {
    const service = fileService();
    service.saveTextFile.mockResolvedValueOnce(null);
    await expect(
      saveReferencesStep({ page: PAGE, format: 'svg', name: 'x', fileService: service })
    ).resolves.toBeNull();
  });
});
