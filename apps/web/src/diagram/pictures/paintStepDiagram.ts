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
import { createOverlayProjector, sheetCorners, sheetFrame } from '../../cp-workspace/references/stepDiagramGeometry';
import { DEFAULT_ORISTUDIO_CP_LINE_WIDTH } from '../../lib/creasePatternViewport';
import type { PaperPage } from '../../lib/paper/paperPage';
import type { PaperScene } from '../../lib/paper/paperScene';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, mmToCssPx, pageMarginPt, pagePtPerPx, paperSceneToSvg } from '../../lib/paper/paperSvg';
import type { DiagramStyle } from '../document/diagramDocument';
import { diagramPaperStyle, diagramSurfaceStyle } from './diagramPaperStyle';

/**
 * The crease width a step's marks are inked against: Edit's default, the
 * width References opens at. Fixed rather than the reader's own setting, so a
 * diagram's steps do not change weight with whoever sent them.
 */
export const STEP_DIAGRAM_LINE_WIDTH = DEFAULT_ORISTUDIO_CP_LINE_WIDTH;

/** The sheet's units to scene px, the sheet's longer side `sheetMm` across: y down, x reflected on the back. */
function sheetToScene(model: StepDiagramModel, mirrored: boolean, sheetMm: number) {
  const longer = Math.max(model.sheet.width, model.sheet.height, Number.EPSILON);
  const scale = mmToCssPx(sheetMm) / longer;
  const [middleX, middleY] = sheetFrame(model.sheet).centre;
  return {
    // y up to y down about the sheet's middle; x reflected about it on the back.
    origin: [mirrored ? 2 * scale * middleX : 0, 2 * scale * middleY] as [number, number],
    ex: [mirrored ? -scale : scale, 0] as [number, number],
    ey: [0, -scale] as [number, number],
  };
}

/**
 * Where the sheet is in the step's scene ({@link stepDiagramScene}), in scene
 * px: the picture's frame (D8), whatever its letters reach past it.
 */
export function stepDiagramSheetBox(
  model: StepDiagramModel,
  mirrored: boolean,
  sheetMm: number
): { x: number; y: number; width: number; height: number } {
  const { origin, ex, ey } = sheetToScene(model, mirrored, sheetMm);
  const corners = sheetCorners(model.sheet).map(([u, v]) => [
    origin[0] + u * ex[0] + v * ey[0],
    origin[1] + u * ex[1] + v * ey[1],
  ]);
  const xs = corners.map(([x]) => x!);
  const ys = corners.map(([, y]) => y!);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * A point of the step's model in picture units (D8): the sheet's box the
 * frame, its longer side one, y down, and x reflected on the back — where the
 * point is drawn in the step's picture, through the one map that draws it.
 */
export function stepDiagramToPicture(
  model: StepDiagramModel,
  mirrored: boolean
): (point: readonly [number, number]) => [number, number] {
  // Any size will do: picture units are a share of the sheet's box.
  const { origin, ex, ey } = sheetToScene(model, mirrored, 1);
  const box = stepDiagramSheetBox(model, mirrored, 1);
  const longer = Math.max(box.width, box.height, Number.EPSILON);
  return ([u, v]) => [
    (origin[0] + u * ex[0] + v * ey[0] - box.x) / longer,
    (origin[1] + u * ex[1] + v * ey[1] - box.y) / longer,
  ];
}

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
  const project = createOverlayProjector(
    sheetToScene(model, mirrored, sheetMm),
    canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH),
    canvasDiagramPens(STEP_DIAGRAM_LINE_WIDTH, drawn.arrows.width * PT_TO_CSS_PX)
  );
  // No ground: a diagram is printed, and a letter off the sheet stands on paper.
  // Its bounds hold its marks too: the arrow's pen is the author's, and the sheet may be small.
  return diagramToPaperScene(model, { style: drawn, project, mirrored, marksInBounds: true });
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
 * The step painted on `page`, its sheet's longer side `page.sheet.mm` across,
 * and where its sheet is on it. Sizes in CSS px, as every painted picture
 * reports them.
 */
export function paintStepDiagram(
  model: StepDiagramModel,
  mirrored: boolean,
  style: DiagramStyle,
  page: PaperPage
): { svg: string; widthPx: number; heightPx: number; frame: { x: number; y: number; width: number; height: number } } {
  const scene = stepDiagramScene(model, mirrored, style, page.sheet.mm);
  const paintStyle = stepDiagramPaintStyle(style);
  const painted = paperSceneToSvg(scene, paintStyle, page, 'sheet');
  // Where the painter put the sheet: its box, shifted to the margin with the scene's bounds.
  const ptPerPx = pagePtPerPx(scene, page, 'sheet');
  const marginPt = pageMarginPt(paintStyle, page);
  const sheet = stepDiagramSheetBox(model, mirrored, page.sheet.mm);
  const toPx = (pt: number) => pt / PT_PER_CSS_PX;
  return {
    svg: painted.svg,
    widthPx: toPx(painted.widthPt),
    heightPx: toPx(painted.heightPt),
    frame: {
      x: toPx(marginPt + (sheet.x - scene.bounds.minX) * ptPerPx),
      y: toPx(marginPt + (sheet.y - scene.bounds.minY) * ptPerPx),
      width: toPx(sheet.width * ptPerPx),
      height: toPx(sheet.height * ptPerPx),
    },
  };
}
