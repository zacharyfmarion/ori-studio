/**
 * A References step as the export dialog's target: the diagram the big view
 * shows, captured with the face and pen it is drawn with at the moment the
 * dialog opens — and every other step the strip has, for an export of all of
 * them (X13).
 *
 * The scene is cheap to build and reads the style (its markup inlines the
 * colours), the page's background (a letter off the paper is haloed in it),
 * which of the diagram's marks the page carries — its letters and its line
 * highlights, which a reader drawing a diagram of their own may not want — and
 * the sheet size, since it is drawn at the page's own scale so that its marks
 * keep their on-screen size as its lines keep their widths
 * (`referencesStepSheetCssPx`). So its key is exactly those four and the page;
 * the margin alone only repaints. A step is one sheet with nothing under it,
 * so it has no buried faces to keep.
 *
 * None of that is References' own but the surface and the scene: any surface
 * whose pages are step diagrams exports them through
 * {@link stepDiagramExportTarget}, naming its policy and how a step becomes a
 * scene at a page. References names `references` and the big view's
 * projector (`referencesStepScene`).
 */
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { PaperScene } from '../../lib/paper/paperScene';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { DEFAULT_PAPER_EXPORT_MARKS, PAPER_EXPORT_MARKS } from '../../lib/paperExportSettings';
import type { PaperExportTarget } from '../../paperExport/paperExportTarget';
import { diagramScenePaintStyle } from './diagramToPaperScene';
import type { StepDiagramModel } from '../../lib/stepDiagram/stepDiagramModel';
import {
  referencesStepDiagramMarks,
  referencesStepScene,
  referencesStepSheetCssPx,
  type ReferencesStepSceneOptions,
  type StepDiagramPageInput,
} from './referencesStepExport';

/** One step, as the target keeps it: its picture, and its names as a page. */
export interface StepDiagramExportPage {
  /** The step as a page carries it: References' is `ReferencesHighlights.pageDiagram`. */
  diagram: StepDiagramModel;
  /** It is read on the paper's back. */
  mirrored: boolean;
  /** Its name in the dialog's pager. */
  label: string;
  /** Its file's stem inside the ZIP of every step. */
  entryStem: string;
}

/** One References step, as the target keeps it. */
export type ReferencesExportPageCapture = StepDiagramExportPage;

/** The steps a target exports and its names for them, whatever surface they are drawn for. */
interface StepDiagramExportPages {
  /** The strip's steps, in order; one when there is nothing else to export. */
  steps: readonly StepDiagramExportPage[];
  /** The step on show. */
  current: number;
  /** The dialog's title and the file's stem for the step on show. */
  title: string;
  fileStem: string;
  /** The dialog's title and the ZIP's stem for every step. */
  allTitle: string;
  zipStem: string;
  /** The Settings export style; a step pins nothing of its own. */
  exportStyle: PaperStyle;
}

export interface StepDiagramExportCapture extends StepDiagramExportPages {
  /**
   * Which surface the steps are: the analytics enum, and the policy their
   * style is read through — for the scene's key and the painter's style, as
   * for the scene itself.
   */
  surface: PaperExportTarget['surface'];
  /**
   * The marks the steps can be exported without — the letters and the
   * reference lines — which the dialog offers as switches. Absent offers both,
   * as References' steps carry them; a surface whose steps have neither (a
   * Fold sequence's crease pattern by step) offers none.
   */
  marks?: PaperExportTarget['marks'];
  /**
   * A step's scene at a page, from the diagram the page carries — the marks
   * it leaves out already taken out (`referencesStepDiagramMarks`). Whatever
   * else it reads is the capture's, fixed while the dialog is open, so the
   * page and `input` are all its key needs.
   */
  stepScene(diagram: StepDiagramModel, input: StepDiagramPageInput): PaperScene;
}

export interface ReferencesExportCapture
  extends StepDiagramExportPages,
    Pick<ReferencesStepSceneOptions, 'lineWidth' | 'showAux'> {}

export function stepDiagramExportTarget(capture: StepDiagramExportCapture): PaperExportTarget {
  const { surface, steps, stepScene } = capture;
  const policy = PAPER_STYLE_POLICIES[surface];
  return {
    surface,
    title: capture.title,
    fileStem: capture.fileStem,
    pages: {
      list: steps.map((step) => ({ label: step.label, fileStem: step.entryStem })),
      current: capture.current,
      title: capture.allTitle,
      zipStem: capture.zipStem,
    },
    exportStyle: capture.exportStyle,
    // A step is drawn on its sheet, the frame a diagram's steps share.
    sizeMeasures: 'sheet',
    pins: null,
    buriesFaces: false,
    marks: capture.marks ?? PAPER_EXPORT_MARKS,
    // Keyed by the size the scene is built at.
    sceneKey: ({ page, style, background, marks = DEFAULT_PAPER_EXPORT_MARKS, sheet }) =>
      [
        page,
        JSON.stringify(applyPaperStylePolicy(style, policy)),
        background ?? '',
        marks.letters,
        marks.highlights,
        referencesStepSheetCssPx(sheet),
      ].join('|'),
    buildScene: async ({
      page,
      style,
      background,
      marks = DEFAULT_PAPER_EXPORT_MARKS,
      sheet,
    }) => {
      const step = steps[page];
      if (!step) return null;
      return stepScene(referencesStepDiagramMarks(step.diagram, marks), {
        style,
        mirrored: step.mirrored,
        sheetCssPx: referencesStepSheetCssPx(sheet),
        background,
      });
    },
    paintStyle: (style) => diagramScenePaintStyle(style, surface),
    release: () => {},
  };
}

export function referencesExportTarget(capture: ReferencesExportCapture): PaperExportTarget {
  const { lineWidth, showAux = null, ...pages } = capture;
  return stepDiagramExportTarget({
    ...pages,
    surface: 'references',
    stepScene: (diagram, input) => referencesStepScene(diagram, { ...input, lineWidth, showAux }),
  });
}
