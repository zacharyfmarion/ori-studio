/**
 * A precrease step as a painted page, and the file it is saved as.
 *
 * The step the big view shows — a plan step, a turn-over, or a ReferenceFinder
 * step of the shown candidate — goes through `diagramToPaperScene` by the big
 * view's projector, and onto the export page through the shared painter, as
 * the simulator and the folded figures do. The style is the export style
 * through the `references` policy: the same reading of it the workspace root
 * carries and the cards draw with.
 *
 * The scene is built at the page's own scale, not the view's: its sheet is as
 * many CSS px as the page's sheet size is at 0.75 pt a px
 * ({@link referencesStepSheetCssPx}). The painter draws a line at its pen's pt
 * width whatever the sheet size, but places the diagram's marks — the arrows
 * and their heads, the rings, the letters and their halos, the turn-over
 * glyph — by scaling them with the paper. Built at the page's scale, that
 * scale is the screen's own, so every mark is the size it is on screen on a
 * page of any size, as every line is the width it is, and only the paper
 * grows or shrinks with the sheet size. Built at the view's size instead, a
 * 41 mm step shrank a 160 mm view's arrows to a quarter of their weight.
 *
 * One mark gives way to the paper: an arrowhead is held to a quarter of its
 * own arrow's chord (`arrowheadSize`), here as on screen, so that a short fold
 * gets a head rather than a blob. The chord is paper and shrinks with the
 * sheet, so a short fold on a small sheet has a smaller head than on a large
 * view — the head the view itself draws when it shows the sheet at the page's
 * size — while its stroke keeps the pen's weight. At the 41 mm a step opens
 * at and the default line width, that is a fold shorter than about a third of
 * the sheet. Giving the head its full size there instead would draw what the
 * cap exists to prevent: a head that is most of its arrow.
 *
 * The diagram handed here is the *page's* (`ReferencesPlanScene.pageDiagram`),
 * not the canvas's: the big view's picture is the overlay over the document's
 * own creases, and a file has nothing under it, so the build-up has to be in
 * the diagram — drawn as the card draws it, in the aux pen.
 *
 * Pure: the export dialog's References target (`referencesExportTarget`)
 * captures the face and the pen when the dialog opens and builds its scenes
 * here, one per sheet size, so a test can paint a step in Node and read the
 * page.
 */
import { DIAGRAM_STEP_SHEET_MM, type PaperPage, type PaperSheetSize } from '../../lib/paper/paperPage';
import type { PaperExportMarks } from '../../lib/paperExportSettings';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import type { PaperScene } from '../../lib/paper/paperScene';
import { mmToCssPx } from '../../lib/paper/paperSvg';
import { canvasDiagramInk, canvasDiagramPens } from './diagram/diagramInk';
import { diagramToPaperScene } from './diagramToPaperScene';
import type { StepDiagramModel, StepDiagramPrimitive } from './referenceFinderDiagramToPrimitives';
import { foldCardNumbers, type ReferencesViewStep } from './referencesSequenceView';
import { createOverlayProjector, sheetFrame } from './stepDiagramGeometry';

/**
 * The sheet's longer side on the page, in CSS px, for the page's sheet size:
 * the size a step's scene is built at, so the painter places it at the
 * screen's own ratio and its marks keep their on-screen size on a sheet of any
 * size. "As shown" is no size for a step — the dialog does not offer it
 * (`PaperExportTarget.defaultSheetMm`) — and reads as a printed diagram's.
 */
export function referencesStepSheetCssPx(sheet: PaperSheetSize): number {
  return mmToCssPx(sheet === 'as-shown' ? DIAGRAM_STEP_SHEET_MM : sheet.mm);
}

/** What the step's scene is built from. */
export interface ReferencesStepSceneOptions {
  /** The export style; the `references` policy is applied here. */
  style: PaperStyle;
  /** The picture is of the paper's back — the side the reader is on. */
  mirrored: boolean;
  /**
   * The sheet's longer side on the page, in CSS px: the scene's scale. The
   * export builds at the page's sheet size ({@link referencesStepSheetCssPx}).
   */
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
 * view's own affine is (`ReferencesCpView.modelToSvg`) — about the sheet's own
 * middle, so the back lands where the front does. One page is cropped to its
 * scene's bounds and would not care, but the pages of a set share one crop
 * (`paperScenesOnOneCrop`), and the sheet must sit in the same place on every
 * one. The ink is the view's (`canvasDiagramInk`), so a letter and a mark's
 * ring are the size they are on screen on a page painted at the screen's
 * ratio — which, at {@link referencesStepSheetCssPx}, is every page.
 */
export function referencesStepScene(
  diagram: StepDiagramModel,
  { style, mirrored, sheetCssPx, lineWidth, showAux = null, background }: ReferencesStepSceneOptions
): PaperScene {
  const longer = Math.max(diagram.sheet.width, diagram.sheet.height, Number.EPSILON);
  const scale = sheetCssPx / longer;
  const [middle] = sheetFrame(diagram.sheet).centre;
  const project = createOverlayProjector(
    { origin: [mirrored ? 2 * scale * middle : 0, 0], ex: [mirrored ? -scale : scale, 0], ey: [0, scale] },
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
 * The step's diagram with the marks the page leaves out taken out of it, so
 * the scene built from it has no trace of them — not even the room a letter
 * off the paper would have widened the page by. Letters are the diagram's
 * labels; line highlights are its lines and arcs in the highlight pen. A
 * point stays: it is where a fold lands, not a name for it.
 *
 * The diagram itself when every mark is shown.
 */
export function referencesStepDiagramMarks(
  diagram: StepDiagramModel,
  marks: PaperExportMarks
): StepDiagramModel {
  if (marks.letters && marks.highlights) return diagram;
  const kept = (primitive: StepDiagramPrimitive): boolean => {
    switch (primitive.kind) {
      case 'label':
        return marks.letters;
      case 'line':
      case 'arc':
        return marks.highlights || primitive.style !== 'highlight';
      default:
        return true;
    }
  };
  return { ...diagram, primitives: diagram.primitives.filter(kept) };
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
 * A step's name inside the ZIP of every step: its place in the set first,
 * zero-padded to the set's size, then the card as the strip names it — "01 step
 * 1", "02 turn over", "03 step 2". The place leads because a file browser sorts
 * by name, and the strip's own names would put every turn-over after every
 * step. The workspace's title is the archive's name, so it is not repeated.
 */
export function referencesStepEntryName(
  subject: ReferencesStepExportSubject,
  index: number,
  count: number
): string {
  const place = String(index + 1).padStart(String(count).length, '0');
  switch (subject.kind) {
    case 'step':
      return `${place} step ${subject.step + 1}`;
    case 'turn-over':
      return subject.after > 0 ? `${place} turn over after step ${subject.after}` : `${place} turn over`;
    case 'reference':
      return `${place} step ${subject.step + 1}`;
  }
}

/** The archive of every step: the sequence's, or one candidate's. */
export function referencesStepsArchiveName(
  title: string,
  subject: ReferencesStepExportSubject
): string {
  const base = title.trim() || 'Untitled';
  return subject.kind === 'reference'
    ? `${base} reference ${subject.candidate + 1} steps`
    : `${base} steps`;
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
