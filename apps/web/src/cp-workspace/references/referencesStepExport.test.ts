import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PAGE, type PaperPage } from '../../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, pageMarginPt } from '../../lib/paper/paperSvg';
import type { StepDiagramModel, StepDiagramPrimitive } from './referenceFinderDiagramToPrimitives';
import { paperSceneToSvg } from '../../lib/paper/paperSvg';
import {
  REFERENCES_STEP_EXPORT_FALLBACK_SHEET_PX,
  referencesSheetCssPx,
  referencesSequenceSubject,
  referencesStepEntryName,
  referencesStepExportName,
  referencesStepPaintStyle,
  referencesStepScene,
  referencesStepsArchiveName,
  type ReferencesStepExportSubject,
} from './referencesStepExport';
import { DIAGRAM_PADDING } from './stepDiagramGeometry';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';
import { planFilmstrip } from './referencesFilmstrip';
import type { ReferencesPlanVariant } from './referencesResults';
import { decodePlanModel, planModelPoints, planStepScene } from './referencesPlanGeometry';
import type { ReferencesViewStep } from './referencesSequenceView';

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
  // The step through the scene and the painter, as the export dialog's
  // References target draws it (`referencesExportTarget`).
  const style = options.style ?? DEFAULT_PAPER_STYLE;
  const page = options.page ?? DEFAULT_PAPER_PAGE;
  const scene = referencesStepScene(diagram, {
    style,
    mirrored: options.mirrored ?? false,
    sheetCssPx: options.sheetCssPx ?? 512,
    lineWidth: 1,
    showAux: options.showAux ?? null,
    background: page.background,
  });
  return paperSceneToSvg(scene, referencesStepPaintStyle(style), page);
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

describe('a step’s page', () => {
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

  it('writes each line at its own pen’s width', () => {
    // Re-pinned with X14: the edge and valley pens used to be written at the
    // mountain pen's width, the one width a simulation drew every line at.
    // Every pen is its own now, as the cards draw them.
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#000001', width: 2 },
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, color: '#000002', width: 0.5 },
      valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, color: '#000003', width: 1.25 },
    };
    const valley: StepDiagramPrimitive = { ...MOUNTAIN, from: [200, 0], to: [200, 400], style: 'valley' };
    const { svg } = paint(model(MOUNTAIN, valley), { style });
    const widthsOf = (color: string) =>
      [...svg.matchAll(new RegExp(`stroke="${color}" stroke-width="([^"]+)"`, 'g'))].map((match) =>
        Number(match[1])
      );
    // The sheet's four sides in the edge pen, then one fold in each fold pen.
    expect(widthsOf('#000001')).toEqual([2, 2, 2, 2]);
    expect(widthsOf('#000002')).toEqual([0.5]);
    expect(widthsOf('#000003')).toEqual([1.25]);
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

describe('referencesStepEntryName', () => {
  const step = (number: number): ReferencesStepExportSubject => ({ kind: 'step', step: number - 1 });
  const turnOver = (after: number): ReferencesStepExportSubject => ({ kind: 'turn-over', after });

  it('leads with the card’s place, zero-padded to the set’s size, so a file browser sorts the strip', () => {
    const subjects = [
      step(1),
      turnOver(1),
      step(2),
      step(3),
      turnOver(3),
      step(4),
      step(5),
      turnOver(5),
      step(6),
      step(7),
    ];
    const names = subjects.map((subject, index) =>
      referencesStepEntryName(subject, index, subjects.length)
    );
    expect(names).toEqual([
      '01 step 1',
      '02 turn over after step 1',
      '03 step 2',
      '04 step 3',
      '05 turn over after step 3',
      '06 step 4',
      '07 step 5',
      '08 turn over after step 5',
      '09 step 6',
      '10 step 7',
    ]);
    expect([...names].sort()).toEqual(names);
  });

  it('pads only as wide as the count needs', () => {
    expect(referencesStepEntryName(step(1), 0, 9)).toBe('1 step 1');
    expect(referencesStepEntryName(step(1), 0, 10)).toBe('01 step 1');
    expect(referencesStepEntryName(step(12), 11, 100)).toBe('012 step 12');
  });

  it('names an opening turn-over without a step, and a candidate’s step by its number alone', () => {
    expect(referencesStepEntryName(turnOver(0), 0, 4)).toBe('1 turn over');
    // The archive is named for the candidate, so its entries need not be.
    expect(referencesStepEntryName({ kind: 'reference', candidate: 2, step: 1 }, 1, 4)).toBe(
      '2 step 2'
    );
  });
});

describe('referencesStepsArchiveName', () => {
  it('names the sequence’s archive for the workspace, whichever card is on show', () => {
    expect(referencesStepsArchiveName('Crane', { kind: 'step', step: 3 })).toBe('Crane steps');
    expect(referencesStepsArchiveName('Crane', { kind: 'turn-over', after: 2 })).toBe('Crane steps');
  });

  it('names a candidate’s archive for the candidate too', () => {
    expect(referencesStepsArchiveName('Crane', { kind: 'reference', candidate: 2, step: 0 })).toBe(
      'Crane reference 3 steps'
    );
  });

  it('names an untitled workspace’s archive as a file of one step is named', () => {
    expect(referencesStepsArchiveName('  ', { kind: 'step', step: 0 })).toBe('Untitled steps');
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
