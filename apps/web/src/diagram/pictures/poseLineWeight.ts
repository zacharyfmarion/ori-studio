/**
 * How heavy Pose's live views draw their lines (D5, D19). A step's captured
 * picture opens at a fixed size — its figure {@link DEFAULT_PAPER_SIZE_MM}
 * across, with its margin — and Pose scales it up to fill the stage, its
 * pens with it. The live 3D and simulated views take that same stage, so
 * their creases grow and shrink with their frame from that size
 * (`RenderSettings.creaseWidthGrows`) rather than keeping a constant weight
 * on screen, which drew them at a third of the picture's on a large stage.
 *
 * Pure: no DOM, no store.
 */
import { DEFAULT_PAPER_SIZE_MM } from '../../lib/paper/paperPage';
import { PT_PER_CSS_PX, PT_PER_MM } from '../../lib/paper/paperSvg';
import { STEP_CARD_PADDING_MM } from './paintDiagramStep';

/** The longer side, in CSS px, a step's scene picture opens at: its figure and the margin either side (`stepScenePage`). */
export const STEP_PICTURE_EDGE_CSS_PX = ((DEFAULT_PAPER_SIZE_MM + 2 * STEP_CARD_PADDING_MM) * PT_PER_MM) / PT_PER_CSS_PX;

/** The frame edge, in device px, at which a live view in Pose draws its pens at their stated weight. */
export function poseCreaseReferenceEdge(devicePixelRatio: number): number {
  return STEP_PICTURE_EDGE_CSS_PX * devicePixelRatio;
}
