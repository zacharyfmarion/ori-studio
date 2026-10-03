/**
 * A References step's picture (D6): the card's `StepDiagramModel`, built into
 * a paper scene at the size it is painted at, then painted in the diagram's
 * pens.
 *
 * Built at the target's own scale, as References builds its exports
 * (`referencesStepScene`): the painter draws every line at its pen's pt width
 * but scales the marks — arrows and their heads, rings, letters, the turn-over
 * glyph — with the paper, so a scene built at one size and painted at
 * another would carry its marks at the wrong weight. Built here at the
 * sheet's painted size, the painter's scale is one and every mark keeps its
 * pt size on a card, in a page's cell and in a file alike.
 *
 * The model is in the unit frame, y up (`stepDiagramGeometry.ts`), so the
 * projector flips y; a picture of the paper's back reflects x about the
 * sheet's middle, exactly as the card's own fit does, so the back lands where
 * the front does and its labels stay the right way round.
 *
 * Pure: no DOM, no store.
 */
import { canvasDiagramInk, canvasDiagramPens } from '../../cp-workspace/references/diagram/diagramInk';
import { diagramToPaperScene } from '../../cp-workspace/references/diagramToPaperScene';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { createOverlayProjector, sheetFrame } from '../../cp-workspace/references/stepDiagramGeometry';
import { DEFAULT_ORISTUDIO_CP_LINE_WIDTH } from '../../lib/creasePatternViewport';
import type { PaperPage } from '../../lib/paper/paperPage';
import type { PaperScene } from '../../lib/paper/paperScene';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, mmToCssPx, paperSceneToSvg } from '../../lib/paper/paperSvg';
import type { DiagramStyle } from '../document/diagramDocument';
import { diagramPaperStyle, diagramSurfaceStyle } from './diagramPaperStyle';

/**
 * The crease width a step's marks are inked against: Edit's default, the
 * width References opens at. Fixed rather than the reader's own setting, so a
 * diagram's steps do not change weight with whoever sent them.
 */
const STEP_DIAGRAM_LINE_WIDTH = DEFAULT_ORISTUDIO_CP_LINE_WIDTH;

/**
 * The step as a scene whose sheet's longer side is `sheetMm` on paper: the
 * scale it will be painted at, so the painter's own scale is one.
 */
export function stepDiagramScene(
  model: StepDiagramModel,
  mirrored: boolean,
  style: DiagramStyle,
  sheetMm: number
): PaperScene {
  const drawn = diagramPaperStyle(style);
  const longer = Math.max(model.sheet.width, model.sheet.height, Number.EPSILON);
  const scale = mmToCssPx(sheetMm) / longer;
  const [middleX, middleY] = sheetFrame(model.sheet).centre;
  const project = createOverlayProjector(
    {
      // y up to y down about the sheet's middle; x reflected about it on the back.
      origin: [mirrored ? 2 * scale * middleX : 0, 2 * scale * middleY],
      ex: [mirrored ? -scale : scale, 0],
      ey: [0, -scale],
    },
    canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH),
    canvasDiagramPens(STEP_DIAGRAM_LINE_WIDTH, drawn.arrows.width * PT_TO_CSS_PX)
  );
  // No ground: a diagram is printed, and a letter off the sheet stands on paper.
  return diagramToPaperScene(model, { style: drawn, project, mirrored });
}

/**
 * The style a step's scene is painted with: the diagram's, with its aux
 * switch on. The scene already holds exactly the aux-pen lines the step
 * shows — the creases earlier steps made always, the pattern's own aux lines
 * when the diagram's style says so — as References' own export does
 * (`referencesStepPaintStyle`).
 */
export function stepDiagramPaintStyle(style: DiagramStyle): PaperStyle {
  const painted = diagramSurfaceStyle(style);
  return { ...painted, auxCreases: { ...painted.auxCreases, visible: true } };
}

/**
 * The step painted on `page`, its sheet's longer side `page.sheet.mm` across.
 * Sizes in CSS px, as every painted picture reports them.
 */
export function paintStepDiagram(
  model: StepDiagramModel,
  mirrored: boolean,
  style: DiagramStyle,
  page: PaperPage
): { svg: string; widthPx: number; heightPx: number } {
  const scene = stepDiagramScene(model, mirrored, style, page.sheet.mm);
  const painted = paperSceneToSvg(scene, stepDiagramPaintStyle(style), page, 'sheet');
  return {
    svg: painted.svg,
    widthPx: painted.widthPt / PT_PER_CSS_PX,
    heightPx: painted.heightPt / PT_PER_CSS_PX,
  };
}
