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
 * A close-up's inside (15f) is the picture painted again, larger: only a
 * surface has the picture, so each paints it (`CloseUpPicture`), and it is
 * drawn here under the marks, clipped to the close-up's ring.
 *
 * Pure: no DOM, no store.
 */
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { paperSceneSvgBody } from '../../lib/paper/paperSvg';
import { CARD_FRAME_PX } from './canvasInk';
import { isKnownAnnotation, type DiagramAnnotation, type DiagramStyle } from '../document/diagramDocument';
import { diagramSurfaceStyle } from '../pictures/diagramPaperStyle';
import type { PaintedPicture, PictureBox } from '../pictures/paintDiagramStep';
import { prefixIds } from '../pictures/prefixIds';
import { SVG_NS } from '../upload/svgSanitize';
import { frameOf } from './annotationModel';
import {
  annotationDrawing,
  annotationReach,
  annotationScene,
  closeUpMarks,
  type AnnotationDrawing,
  type AnnotationPaper,
} from './annotationPrimitives';
import type { PictureLayers } from './pictureGeometry';

// The frame a card's annotations are drawn at: `canvasInk.ts` owns it with the ink drawn there.
export { CARD_FRAME_PX };

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
 * What a surface paints inside a close-up (15f): its picture `scale` times
 * the size it paints it at — its pens at their print weight — its frame on
 * `frame`, in the target's units, every id it declares under `idPrefix`, so
 * the picture and its copy never share one. Null when it has nothing there.
 */
export type CloseUpPicture = (scale: number, frame: PictureBox, idPrefix: string) => string | null;

/** What a surface paints with the marks, beyond them. */
export interface AnnotationPaint {
  /**
   * The picture inside each close-up (15f). Without it a close-up is its
   * rings and the line between them, as Pose ghosts it over the picture it
   * is posing.
   */
  closeUpPicture?: CloseUpPicture | null;
  /** How the marks' text is set — a page's fonts — on every mark's markup, never on a picture's. */
  setText?: (markup: string) => string;
  /** A References picture's sheet (17b): a label's halo is filled with the face it stands on. */
  paper?: AnnotationPaper | null;
}

/**
 * The annotations drawn on `box` — the picture's frame, in the target's own
 * units — compiled with the frame's longer side `framePx` CSS px across, a
 * mark behind a flap dotted under it on a picture whose `layers` are given
 * (15e), and under them each close-up's inside, where `paint` paints the
 * picture (15f). Null when they draw nothing.
 */
export function paintAnnotations(
  annotations: readonly DiagramAnnotation[],
  box: PictureBox,
  framePx: number,
  style: DiagramStyle,
  layers: PictureLayers | null = null,
  paint: AnnotationPaint = {}
): PaintedAnnotations | null {
  const frame = frameOf(box.width, box.height);
  if (!frame || !(framePx > 0)) return null;
  const paper = paint.paper ?? null;
  const drawing = annotationDrawing(annotations, frame, framePx, style, layers, paper);
  const scene = annotationScene(drawing);
  if (!scene) return null;
  // Target units per drawing px: the frame's size there over its size here.
  const k = Math.max(box.width, box.height) / framePx;
  const setText = paint.setText ?? ((markup: string) => markup);
  const body = paperSceneSvgBody(scene, diagramSurfaceStyle(style), {
    project: ([x, y]) => [box.x + x * k, box.y + y * k],
    unitsPerPt: k * PT_TO_CSS_PX,
    keepHiddenFaces: true,
  });
  const insides = paint.closeUpPicture
    ? closeUpInsides(drawing, annotations, { box, framePx, k }, style, layers, paint.closeUpPicture, setText, paper)
    : '';
  const reach = annotationReach(drawing);
  return {
    markup: `<g stroke-linejoin="round">\n${insides}${setText(body)}\n</g>`,
    bounds: { x: box.x + reach.x * k, y: box.y + reach.y * k, width: reach.width * k, height: reach.height * k },
  };
}

/**
 * Each close-up's inside (15f), in the target's units, for the marks to be
 * drawn over: the page's white, the picture painted again by the surface,
 * and the step's other marks drawn with it, larger — their pens and heads
 * at their print weight — all clipped to the close-up's ring, whose pen the
 * marks draw over its edge.
 */
function closeUpInsides(
  drawing: AnnotationDrawing,
  annotations: readonly DiagramAnnotation[],
  { box, framePx, k }: { box: PictureBox; framePx: number; k: number },
  style: DiagramStyle,
  layers: PictureLayers | null,
  picture: CloseUpPicture,
  setText: (markup: string) => string,
  paper: AnnotationPaper | null
): string {
  if (drawing.closeUps.length === 0) return '';
  const others = closeUpMarks(annotations);
  return drawing.closeUps
    .map((closeUp, index) => {
      const id = `annotation-close-up-${index}`;
      const [x, y, r] = [box.x + closeUp.inset.x * k, box.y + closeUp.inset.y * k, closeUp.inset.r * k];
      const frame = {
        x: box.x + closeUp.frame.x * k,
        y: box.y + closeUp.frame.y * k,
        width: closeUp.frame.width * k,
        height: closeUp.frame.height * k,
      };
      // The marks at `scale` times the frame, in the same pens: a target unit per drawing px as here.
      const marks = paintAnnotations(others, frame, framePx * closeUp.scale, style, layers, { setText, paper });
      const ring = `cx="${num(x)}" cy="${num(y)}" r="${num(r)}"`;
      return (
        `<defs><clipPath id="${id}"><circle ${ring}/></clipPath></defs>` +
        `<g clip-path="url(#${id})"><circle ${ring} fill="${closeUp.ground}"/>` +
        `${picture(closeUp.scale, frame, `${id}-`) ?? ''}${marks ? prefixIds(marks.markup, `${id}-`) : ''}</g>\n`
      );
    })
    .join('');
}

/**
 * A painted picture with its annotations drawn over it, as one SVG document,
 * or the picture itself when they draw nothing. The document grows to hold
 * whatever reaches past the picture — an arrow that starts off it — as a
 * page and a step's file do: an `<img>` cannot paint outside its own box.
 * `opacity` ghosts them, as Pose shows them (D8); `layers`, the picture's,
 * dot a mark behind a flap (15e). `paintAt` paints the picture `scale` times
 * as large, for a close-up's inside (15f); without it, as ghosted in Pose,
 * a close-up is its rings. `paper`, a References picture's sheet, fills a
 * label's halo with the face it stands on (17b).
 */
export function annotatedPicture(
  painted: PaintedPicture,
  annotations: readonly DiagramAnnotation[],
  style: DiagramStyle,
  opacity = 1,
  layers: PictureLayers | null = null,
  paintAt: ((scale: number) => PaintedPicture | null) | null = null,
  paper: AnnotationPaper | null = null
): string {
  const closeUpPicture: CloseUpPicture | null =
    paintAt &&
    ((scale, frame, idPrefix) => {
      const larger = paintAt(scale);
      if (!larger || !(larger.frame.width > 0)) return null;
      // Nested whole, its frame on the close-up's: as large as it was painted, near enough exactly.
      const m = frame.width / larger.frame.width;
      const at = { x: frame.x - larger.frame.x * m, y: frame.y - larger.frame.y * m };
      const body = prefixIds(larger.svg.replace(/^\s*<\?xml[^>]*\?>\s*/, ''), idPrefix);
      return (
        `<svg x="${num(at.x)}" y="${num(at.y)}" width="${num(larger.widthPx * m)}" height="${num(larger.heightPx * m)}" ` +
        `viewBox="0 0 ${num(larger.widthPx)} ${num(larger.heightPx)}" overflow="visible">${body}</svg>`
      );
    });
  const drawn = paintAnnotations(annotations, painted.frame, CARD_FRAME_PX, style, layers, { closeUpPicture, paper });
  if (!drawn) return painted.svg;
  const { widthPx, heightPx, svg } = painted;
  const { bounds } = drawn;
  const x = Math.min(0, bounds.x);
  const y = Math.min(0, bounds.y);
  const width = Math.max(widthPx, bounds.x + bounds.width) - x;
  const height = Math.max(heightPx, bounds.y + bounds.height) - y;
  // Nested whole, at the origin, its own size: the box grows round it.
  const picture = svg.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  const marks = opacity < 1 ? `<g opacity="${opacity}">${drawn.markup}</g>` : drawn.markup;
  return (
    `<svg xmlns="${SVG_NS}" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="${num(x)} ${num(y)} ${num(width)} ${num(height)}">${picture}${marks}</svg>`
  );
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
