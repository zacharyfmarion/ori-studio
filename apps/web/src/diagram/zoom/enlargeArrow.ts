/**
 * The enlarge arrow (Revision 2, "The enlarge arrow"): the hollow arrow with
 * a pointed tail that prints between a step showing an enlarge area and the
 * enlarged step after it — Zach's "genie coming out of a bottle". It is never
 * stored: the layout computes where one prints (`zoomIndex`, `placeTurns`),
 * and the page paints it as it paints a turn's glyph (`turnGlyph.ts`), a
 * synthetic annotation on a frame of its own, so it prints in the arrows'
 * pen and ink at its own size whatever the page's scale.
 *
 * - A white arrow of the regular width, its tail tapered to a point (the
 *   template's `path4649`), filled white and outlined in the arrows' pen.
 * - Two path nodes on an {@link ENLARGE_ARROW_CHORD_MM} chord, bowed up by
 *   {@link ENLARGE_ARROW_BEND} of it: long enough that the arrow keeps its
 *   whole head and shaft (`whiteArrowOutline` shrinks one under 9.3 mm).
 * - Its box measured from the painted outline, once a style
 *   ({@link enlargeArrowMm}), not typed: a typed box too small for its 7.94 mm
 *   head is what two earlier proposals had.
 *
 * On a row read right to left it is mirrored, pointing left, the bow kept up.
 *
 * Pure: no DOM, no store.
 */
import { markReach } from '../../cp-workspace/references/diagram/markReach';
import { mmToCssPx } from '../../lib/paper/paperSvg';
import { arcToPath } from '../annotate/annotationPath';
import { annotationDrawing } from '../annotate/annotationPrimitives';
import { paintAnnotations, type PaintedAnnotations } from '../annotate/paintAnnotations';
import { TURN_FRAME_MM } from '../annotate/turnGlyph';
import type { DiagramStyle, KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PictureBox } from './zoomModel';

/** The chord between the arrow's two nodes, mm: above the 9.3 mm under which a white arrow is drawn shorter. */
export const ENLARGE_ARROW_CHORD_MM = 11;

/** How far the arrow bows up from its chord, as a share of it (a fold arrow's `bend`). */
export const ENLARGE_ARROW_BEND = 0.18;

/** The frame the arrow is drawn on, mm: a turn glyph's, which prints at its own size centred on it. */
export const ENLARGE_ARROW_FRAME_MM = TURN_FRAME_MM;

/**
 * The arrow as the annotation that draws it, on a frame
 * {@link ENLARGE_ARROW_FRAME_MM} across, its chord level through the frame's
 * middle, pointing right and bowing up.
 */
export function enlargeArrowAnnotation(id = 'enlarge-arrow'): KnownDiagramAnnotation {
  const half = ENLARGE_ARROW_CHORD_MM / 2 / ENLARGE_ARROW_FRAME_MM;
  const from: [number, number] = [0.5 - half, 0.5];
  const to: [number, number] = [0.5 + half, 0.5];
  // The arc a fold arrow with this bend draws, as the path a white arrow needs (a positive bend bows up, left of its travel).
  const { path } = arcToPath({ id, kind: 'valley-arrow', from, to, bend: ENLARGE_ARROW_BEND });
  return { id, kind: 'white-arrow', from, to, path: path!, width: 'regular', tail: 'pointed' };
}

/**
 * The arrow painted on `frame`, a box {@link ENLARGE_ARROW_FRAME_MM} across
 * in the target's own units; mirrored about the frame's middle on a row read
 * right to left, so it points left with its bow still up.
 */
export function paintEnlargeArrowOnFrame(
  frame: PictureBox,
  style: DiagramStyle,
  { rightToLeft = false, id }: { rightToLeft?: boolean; id?: string } = {}
): PaintedAnnotations | null {
  const arrow = paintAnnotations([enlargeArrowAnnotation(id)], frame, mmToCssPx(ENLARGE_ARROW_FRAME_MM), style);
  if (!arrow || !rightToLeft) return arrow;
  // x to 2m − x, m the frame's middle.
  const across = 2 * frame.x + frame.width;
  return {
    markup: `<g transform="matrix(-1 0 0 1 ${Number(across.toFixed(4))} 0)">${arrow.markup}</g>`,
    bounds: { ...arrow.bounds, x: across - arrow.bounds.x - arrow.bounds.width },
  };
}

/** The arrow's printed box, mm, and where its middle is from its frame's: measured once a style, from the painted outline. */
interface ArrowMeasure {
  w: number;
  h: number;
  /** The box's middle less the frame's, mm, pointing right. */
  dx: number;
  dy: number;
}

/** By the style, as JSON: its arrows' pen is what the box grows with. */
const measured = new Map<string, ArrowMeasure>();

function measure(style: DiagramStyle): ArrowMeasure {
  const key = JSON.stringify(style);
  const known = measured.get(key);
  if (known) return known;
  // Its outline as the page paints it, its pen's half round it — the reach a
  // mark's own ink has, without the frame a step's marks are measured with.
  const size = ENLARGE_ARROW_FRAME_MM;
  const framePx = mmToCssPx(size);
  const drawing = annotationDrawing([enlargeArrowAnnotation()], { width: 1, height: 1 }, framePx, style);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const take = (x: number, y: number, pad: number) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  };
  for (const primitive of drawing.primitives) markReach(primitive, drawing.context.project, drawing.context.marks, take);
  const mm = size / framePx;
  const box: ArrowMeasure =
    minX <= maxX && minY <= maxY
      ? {
          w: (maxX - minX) * mm,
          h: (maxY - minY) * mm,
          dx: ((minX + maxX) / 2) * mm - size / 2,
          dy: ((minY + maxY) / 2) * mm - size / 2,
        }
      : { w: 0, h: 0, dx: 0, dy: 0 };
  measured.set(key, box);
  return box;
}

/**
 * The box the arrow prints in, mm, as its outline paints it in `style`'s
 * arrows pen: about 11.6 × 7.9 in the Diagram preset, larger with a heavier
 * pen. What the layout places, stacks and keeps clear of the pictures and the
 * paper's edge.
 */
export function enlargeArrowMm(style: DiagramStyle): { w: number; h: number } {
  const { w, h } = measure(style);
  return { w, h };
}

/**
 * The arrow painted with its box centred on `at`, in a target whose units are
 * `unitsPerMm` to a millimetre (a page's pt): pointing right, or left on a
 * row read right to left.
 */
export function paintEnlargeArrow(
  at: { x: number; y: number },
  unitsPerMm: number,
  style: DiagramStyle,
  { rightToLeft = false, id }: { rightToLeft?: boolean; id?: string } = {}
): PaintedAnnotations | null {
  const { dx, dy } = measure(style);
  const size = ENLARGE_ARROW_FRAME_MM * unitsPerMm;
  // The frame moved so the box's middle lands on `at`; mirrored, the box's middle is the other side of the frame's.
  const x = at.x - (rightToLeft ? -dx : dx) * unitsPerMm - size / 2;
  const y = at.y - dy * unitsPerMm - size / 2;
  return paintEnlargeArrowOnFrame({ x, y, width: size, height: size }, style, { rightToLeft, id });
}
