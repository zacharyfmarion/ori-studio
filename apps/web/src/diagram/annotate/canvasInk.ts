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
