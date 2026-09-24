/**
 * A References step as the export dialog's target: the diagram the big view
 * shows, captured with the camera, face and pen it is drawn with at the moment
 * the dialog opens.
 *
 * The scene is cheap to build and reads the style (its markup inlines the
 * colours) and the page's background (a letter off the paper is haloed in it),
 * so its key is exactly those two; the margin and the sheet size only repaint.
 * A step is one sheet with nothing under it, so it has no buried faces to keep.
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

export interface ReferencesExportCapture
  extends Pick<ReferencesStepSceneOptions, 'mirrored' | 'sheetCssPx' | 'lineWidth' | 'showAux'> {
  /** The step as a page carries it: `ReferencesHighlights.pageDiagram`. */
  diagram: StepDiagramModel;
  title: string;
  fileStem: string;
  /** The Settings export style; a References step pins nothing of its own. */
  exportStyle: PaperStyle;
}

export function referencesExportTarget(capture: ReferencesExportCapture): PaperExportTarget {
  const { diagram, mirrored, sheetCssPx, lineWidth, showAux = null } = capture;
  return {
    surface: 'references',
    title: capture.title,
    fileStem: capture.fileStem,
    exportStyle: capture.exportStyle,
    pins: null,
    buriesFaces: false,
    sceneKey: ({ style, background }) =>
      `${JSON.stringify(applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references))}|${background ?? ''}`,
    buildScene: async ({ style, background }) =>
      referencesStepScene(diagram, { style, mirrored, sheetCssPx, lineWidth, showAux, background }),
    paintStyle: referencesStepPaintStyle,
    release: () => {},
  };
}
