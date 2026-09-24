/**
 * A precrease step as a painted page, and the file it is saved as.
 *
 * The step the big view shows — a plan step, a turn-over, or a ReferenceFinder
 * step of the shown candidate — goes through `diagramToPaperScene` at the size
 * the view draws its sheet, and onto the export page through the shared
 * painter, as the simulator and the folded figures do (D3: the default sheet
 * size is the on-screen size, which is exact WYSIWYG). The style is the export
 * style through the `references` policy: the same reading of it the workspace
 * root carries and the cards draw with.
 *
 * The diagram handed here is the *page's* (`ReferencesPlanScene.pageDiagram`),
 * not the canvas's: the big view's picture is the overlay over the document's
 * own creases, and a file has nothing under it, so the build-up has to be in
 * the diagram — drawn as the card draws it, in the aux pen.
 *
 * Pure: the export dialog's References target (`referencesExportTarget`)
 * captures the camera, the face and the pen when the dialog opens and builds
 * its scenes here, so a test can paint a step in Node and read the page.
 */
import type { PaperPage } from '../../lib/paper/paperPage';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import type { PaperScene } from '../../lib/paper/paperScene';
import { canvasDiagramInk, canvasDiagramPens } from './diagram/diagramInk';
import { diagramToPaperScene } from './diagramToPaperScene';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import type { ReferencesDiagramView } from './ReferencesCpView';
import { foldCardNumbers, type ReferencesViewStep } from './referencesSequenceView';
import { createOverlayProjector, type DiagramSheet } from './stepDiagramGeometry';

/**
 * The sheet's longer side on the page, in CSS px, when the big view is not
 * there to measure it against — the panel before its first frame, or a test.
 */
export const REFERENCES_STEP_EXPORT_FALLBACK_SHEET_PX = 512;

/**
 * The sheet's longer side as the big view draws it, in CSS px: the model
 * sheet through the camera's scale. The view's camera is a similarity with no
 * rotation, so one number is the whole of what the page needs from it.
 */
export function referencesSheetCssPx(
  sheet: Pick<DiagramSheet, 'width' | 'height'>,
  camera: ReferencesDiagramView | null
): number {
  if (!camera) return REFERENCES_STEP_EXPORT_FALLBACK_SHEET_PX;
  const { ex } = camera.view;
  const px = Math.max(sheet.width, sheet.height) * Math.hypot(ex[0], ex[1]);
  return px > 0 ? px : REFERENCES_STEP_EXPORT_FALLBACK_SHEET_PX;
}

/** What the step's scene is built from. */
export interface ReferencesStepSceneOptions {
  /** The export style; the `references` policy is applied here. */
  style: PaperStyle;
  /** The picture is of the paper's back — the side the reader is on. */
  mirrored: boolean;
  /** The sheet's longer side on the page, in CSS px ({@link referencesSheetCssPx}). */
  sheetCssPx: number;
  /** The reader's crease width, which is the diagram's pen on the big view. */
  lineWidth: number;
  /** The References "Show auxiliary creases" option; null follows the style. */
  showAux?: boolean | null;
  /** The page's background — what a letter off the paper is haloed in — or null for a transparent page. */
  background: PaperPage['background'];
}

/**
 * The step as a scene: the diagram through the big view's projector.
 *
 * The projector is the big view's, rebuilt from the sheet size alone: model
 * space to scene px at the scale that puts the sheet's longer side at
 * `sheetCssPx`, and reflected about x when the paper is on its back, as the
 * view's own affine is (`ReferencesCpView.modelToSvg`). Where the sheet lands
 * on the page does not matter — the painter crops to the scene's bounds — so
 * the origin is the model's. The ink is the view's (`canvasDiagramInk`), so a
 * letter and a mark's ring are the size they are on screen.
 */
export function referencesStepScene(
  diagram: StepDiagramModel,
  { style, mirrored, sheetCssPx, lineWidth, showAux = null, background }: ReferencesStepSceneOptions
): PaperScene {
  const longer = Math.max(diagram.sheet.width, diagram.sheet.height, Number.EPSILON);
  const scale = sheetCssPx / longer;
  const project = createOverlayProjector(
    { origin: [0, 0], ex: [mirrored ? -scale : scale, 0], ey: [0, scale] },
    canvasDiagramInk(lineWidth),
    canvasDiagramPens(lineWidth, style.arrows.width * PT_TO_CSS_PX)
  );
  return diagramToPaperScene(diagram, {
    style,
    project,
    mirrored,
    showAux,
    ...(background === null ? {} : { ground: background }),
  });
}

/**
 * The style the painter draws a step's scene with: the style as the view sees
 * it — the policy applied, and every crease in its own pen, as the other
 * surfaces hand theirs. Its aux switch stays on: the scene already holds
 * exactly the aux-pen lines the page carries, and the creases an earlier step
 * made are among them.
 */
export function referencesStepPaintStyle(style: PaperStyle): PaperStyle {
  const painted = surfacePaperStyle(style, PAPER_STYLE_POLICIES.references);
  return { ...painted, auxCreases: { ...painted.auxCreases, visible: true } };
}

/** Which diagram is being exported, for the file's name. */
export type ReferencesStepExportSubject =
  /**
   * A fold of the precreasing sequence; `step` is 0-based over the *folds*,
   * which is what the strip numbers — not the index into the view's steps,
   * which counts the turn-overs and the ending card too.
   */
  | { kind: 'step'; step: number }
  /** The turn-over card after `after` folds; 0 when the sequence opens with one. */
  | { kind: 'turn-over'; after: number }
  /** A step of a shown candidate in Find; both 0-based. */
  | { kind: 'reference'; candidate: number; step: number };

/**
 * The file's base name, before sanitising and the extension: the workspace's
 * title and the card's number as the strip shows it. A candidate's step names
 * the candidate too, or the four steps of one reference would all be one file.
 *
 * A turn-over has no number on the strip, so it does not borrow one: named by
 * a fold it is not, it would collide with that fold's own file.
 */
export function referencesStepExportName(title: string, subject: ReferencesStepExportSubject): string {
  const base = title.trim() || 'Untitled';
  switch (subject.kind) {
    case 'step':
      return `${base} step ${subject.step + 1}`;
    case 'turn-over':
      return subject.after > 0 ? `${base} turn over after step ${subject.after}` : `${base} turn over`;
    case 'reference':
      return `${base} reference ${subject.candidate + 1} step ${subject.step + 1}`;
  }
}

/**
 * The card at `index` of the sequence's view steps, as the strip names it.
 *
 * The panel's active step is an index into the view's steps, which include the
 * turn-overs and the ending; the strip numbers only the folds. Taking the
 * index for the number made every file after the first turn-over one ahead of
 * the card the reader is looking at.
 */
export function referencesSequenceSubject(
  viewSteps: readonly ReferencesViewStep[],
  index: number
): ReferencesStepExportSubject {
  const numbers = foldCardNumbers(viewSteps);
  const number = numbers[index];
  if (number !== null && number !== undefined) return { kind: 'step', step: number - 1 };
  // A turn-over, or the ending card, which has no diagram to export anyway:
  // the folds made by the time the reader reaches it.
  let after = 0;
  for (let i = 0; i < index; i += 1) after = numbers[i] ?? after;
  return { kind: 'turn-over', after };
}
