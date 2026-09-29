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
 */
import { DIAGRAM_STEP_SHEET_MM } from '../../lib/paper/paperPage';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { DEFAULT_PAPER_EXPORT_MARKS, PAPER_EXPORT_MARKS } from '../../lib/paperExportSettings';
import type { PaperExportTarget } from '../../paperExport/paperExportTarget';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import {
  referencesStepDiagramMarks,
  referencesStepPaintStyle,
  referencesStepScene,
  referencesStepSheetCssPx,
  type ReferencesStepSceneOptions,
} from './referencesStepExport';

/** One step, as the target keeps it: its picture, and its names as a page. */
export interface ReferencesExportPageCapture {
  /** The step as a page carries it: `ReferencesHighlights.pageDiagram`. */
  diagram: StepDiagramModel;
  /** It is read on the paper's back. */
  mirrored: boolean;
  /** Its name in the dialog's pager. */
  label: string;
  /** Its file's stem inside the ZIP of every step. */
  entryStem: string;
}

export interface ReferencesExportCapture
  extends Pick<ReferencesStepSceneOptions, 'lineWidth' | 'showAux'> {
  /** The strip's steps, in order; one when there is nothing else to export. */
  steps: readonly ReferencesExportPageCapture[];
  /** The step on show. */
  current: number;
  /** The dialog's title and the file's stem for the step on show. */
  title: string;
  fileStem: string;
  /** The dialog's title and the ZIP's stem for every step. */
  allTitle: string;
  zipStem: string;
  /** The Settings export style; a References step pins nothing of its own. */
  exportStyle: PaperStyle;
}

export function referencesExportTarget(capture: ReferencesExportCapture): PaperExportTarget {
  const { steps, lineWidth, showAux = null } = capture;
  return {
    surface: 'references',
    title: capture.title,
    fileStem: capture.fileStem,
    pages: {
      list: steps.map((step) => ({ label: step.label, fileStem: step.entryStem })),
      current: capture.current,
      title: capture.allTitle,
      zipStem: capture.zipStem,
    },
    exportStyle: capture.exportStyle,
    defaultSheetMm: DIAGRAM_STEP_SHEET_MM,
    pins: null,
    buriesFaces: false,
    marks: PAPER_EXPORT_MARKS,
    // Keyed by the size the scene is built at, so "As shown" and the size it
    // reads as are one scene.
    sceneKey: ({ page, style, background, marks = DEFAULT_PAPER_EXPORT_MARKS, sheet = 'as-shown' }) =>
      [
        page,
        JSON.stringify(applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references)),
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
      sheet = 'as-shown',
    }) => {
      const step = steps[page];
      if (!step) return null;
      return referencesStepScene(referencesStepDiagramMarks(step.diagram, marks), {
        style,
        mirrored: step.mirrored,
        sheetCssPx: referencesStepSheetCssPx(sheet),
        lineWidth,
        showAux,
        background,
      });
    },
    paintStyle: referencesStepPaintStyle,
    release: () => {},
  };
}
