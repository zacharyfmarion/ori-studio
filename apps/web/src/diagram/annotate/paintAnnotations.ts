/**
 * Annotations painted onto a picture (D8): compiled at the size the picture
 * is painted at, placed on its frame by a uniform scale and a shift, and
 * drawn by the paper painter — its lines in the style's pens, its marks as
 * markup — exactly as a step's own lines and References' marks are.
 *
 * A card's picture opens at the size every picture does (`stepScenePage`),
 * so its annotations are drawn as if the frame were that size; a page's at
 * the size it prints at.
 *
 * Pure: no DOM, no store.
 */
import { DEFAULT_PAPER_SIZE_MM } from '../../lib/paper/paperPage';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { mmToCssPx, paperSceneSvgBody } from '../../lib/paper/paperSvg';
import { isKnownAnnotation, type DiagramAnnotation, type DiagramStyle } from '../document/diagramDocument';
import { diagramSurfaceStyle } from '../pictures/diagramPaperStyle';
import type { PaintedPicture, PictureBox } from '../pictures/paintDiagramStep';
import { SVG_NS } from '../upload/svgSanitize';
import { frameOf } from './annotationModel';
import { annotationDrawing, annotationReach, annotationScene } from './annotationPrimitives';

/**
 * The frame a card's annotations are drawn at, in CSS px: the size every
 * picture opens at, which a References step's sheet is painted at on a card.
 */
export const CARD_FRAME_PX = mmToCssPx(DEFAULT_PAPER_SIZE_MM);

/** Whether a step has an annotation this build draws. */
export function hasDrawnAnnotations(annotations: readonly DiagramAnnotation[]): boolean {
  return annotations.some(isKnownAnnotation);
}

export interface PaintedAnnotations {
  /** The elements, in the target's units: lines and marks, round-joined as a page's are. */
  markup: string;
  /** What they reach, in the target's units: past the frame where an arrow starts off it. */
  bounds: PictureBox;
}

/**
 * The annotations drawn on `box` — the picture's frame, in the target's own
 * units — compiled with the frame's longer side `framePx` CSS px across.
 * Null when they draw nothing.
 */
export function paintAnnotations(
  annotations: readonly DiagramAnnotation[],
  box: PictureBox,
  framePx: number,
  style: DiagramStyle
): PaintedAnnotations | null {
  const frame = frameOf(box.width, box.height);
  if (!frame || !(framePx > 0)) return null;
  const drawing = annotationDrawing(annotations, frame, framePx, style);
  const scene = annotationScene(drawing);
  if (!scene) return null;
  // Target units per drawing px: the frame's size there over its size here.
  const k = Math.max(box.width, box.height) / framePx;
  const body = paperSceneSvgBody(scene, diagramSurfaceStyle(style), {
    project: ([x, y]) => [box.x + x * k, box.y + y * k],
    unitsPerPt: k * PT_TO_CSS_PX,
    keepHiddenFaces: true,
  });
  const reach = annotationReach(drawing);
  return {
    markup: `<g stroke-linejoin="round">\n${body}\n</g>`,
    bounds: { x: box.x + reach.x * k, y: box.y + reach.y * k, width: reach.width * k, height: reach.height * k },
  };
}

/**
 * A painted picture with its annotations drawn over it, as one SVG document
 * the size the picture is, or the picture itself when they draw nothing.
 * `opacity` ghosts them, as Pose shows them (D8).
 */
export function annotatedPicture(
  painted: PaintedPicture,
  annotations: readonly DiagramAnnotation[],
  style: DiagramStyle,
  opacity = 1
): string {
  const drawn = paintAnnotations(annotations, painted.frame, CARD_FRAME_PX, style);
  if (!drawn) return painted.svg;
  const { widthPx: width, heightPx: height } = painted;
  const picture = painted.svg.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  const marks = opacity < 1 ? `<g opacity="${opacity}">${drawn.markup}</g>` : drawn.markup;
  return (
    `<svg xmlns="${SVG_NS}" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="0 0 ${num(width)} ${num(height)}">${picture}${marks}</svg>`
  );
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
