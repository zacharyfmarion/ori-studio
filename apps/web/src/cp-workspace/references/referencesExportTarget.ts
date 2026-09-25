/**
 * A References step as the export dialog's target: the diagram the big view
 * shows, captured with the camera, face and pen it is drawn with at the moment
 * the dialog opens — and every other step the strip has, for an export of all
 * of them (X13).
 *
 * The scene is cheap to build and reads the style (its markup inlines the
 * colours) and the page's background (a letter off the paper is haloed in it),
 * so its key is exactly those two and the page; the margin and the sheet size
 * only repaint. A step is one sheet with nothing under it, so it has no buried
 * faces to keep.
 */
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { PaperExportTarget } from '../../paperExport/paperExportTarget';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import {
  referencesStepPaintStyle,
  referencesStepScene,
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
  extends Pick<ReferencesStepSceneOptions, 'sheetCssPx' | 'lineWidth' | 'showAux'> {
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
  const { steps, sheetCssPx, lineWidth, showAux = null } = capture;
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
    pins: null,
    buriesFaces: false,
    sceneKey: ({ page, style, background }) =>
      `${page}|${JSON.stringify(applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references))}|${background ?? ''}`,
    buildScene: async ({ page, style, background }) => {
      const step = steps[page];
      if (!step) return null;
      return referencesStepScene(step.diagram, {
        style,
        mirrored: step.mirrored,
        sheetCssPx,
        lineWidth,
        showAux,
        background,
      });
    },
    paintStyle: referencesStepPaintStyle,
    release: () => {},
  };
}
