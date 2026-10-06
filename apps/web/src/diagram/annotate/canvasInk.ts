/**
 * The scale a step's marks are drawn at on a card and on the Annotate canvas:
 * the frame every picture opens at, and the ink a step's diagram is drawn in
 * there. Its own module, imported by the painters and the canvas alike, so a
 * shape the model derives from the drawing's sizes — a fold-and-unfold
 * arrow's return, as Edit Path shows its nodes — is the canvas's own.
 *
 * Pure: no DOM, no store.
 */
import { canvasDiagramInk } from '../../cp-workspace/references/diagram/diagramInk';
import { DEFAULT_ORISTUDIO_CP_LINE_WIDTH } from '../../lib/creasePatternViewport';
import { DEFAULT_PAPER_SIZE_MM } from '../../lib/paper/paperPage';
import { mmToCssPx } from '../../lib/paper/paperSvg';

/**
 * The crease width a step's marks are inked against: Edit's default, the
 * width References opens at. Fixed rather than the reader's own setting, so a
 * diagram's steps do not change weight with whoever sent them.
 */
export const STEP_DIAGRAM_LINE_WIDTH = DEFAULT_ORISTUDIO_CP_LINE_WIDTH;

/**
 * The frame a card's annotations are drawn at, in CSS px: the size every
 * picture opens at, which a References step's sheet is painted at on a card.
 */
export const CARD_FRAME_PX = mmToCssPx(DEFAULT_PAPER_SIZE_MM);

/** One ink in picture units, as the canvas draws: what an arrow's head and a push's width are measured in. */
export const INK_UNITS = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH) / CARD_FRAME_PX;

/**
 * One ink in mm as a mark prints — 1.25 CSS px, 0.331 mm — wherever it is
 * drawn: the canvas and a card draw the frame at its 50 mm, a page at the
 * size it prints. What a print length a mark stores (equal divisions'
 * offset, Revision 2) is turned into ink by.
 */
export const ANNOTATION_INK_MM = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH) / mmToCssPx(1);

/** A print length in mm, in picture units as the canvas and a card draw the frame. */
export function mmInPictureUnits(mm: number): number {
  return (mm / ANNOTATION_INK_MM) * INK_UNITS;
}

/**
 * The Annotate canvas's selection ink, for a picture painted as a document,
 * where no stylesheet reaches: Pose outlines an enlarged step's frame in it.
 * The canvas's own is its module's `--annotate-selection`
 * (`DiagramAnnotateCanvas.module.css`, which says why this blue), which a
 * component owns rather than a theme; a test holds the two equal.
 */
export const ANNOTATE_SELECTION_INK = '#4078f2';
