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
 * Across a flow row's end, where it stands in the lane's bend, it is aimed at
 * the enlarged step it leads to instead ({@link LayoutArrowAim}), its bow on
 * the outside of the bend.
 *
 * Pure: no DOM, no store.
 */
import { isDiagramMark, markReach } from '../../cp-workspace/references/diagram/markReach';
import { mmToCssPx } from '../../lib/paper/paperSvg';
import { arcToPath } from '../annotate/annotationPath';
import { annotationDrawing } from '../annotate/annotationPrimitives';
import { paintAnnotations, type PaintedAnnotations } from '../annotate/paintAnnotations';
import { TURN_FRAME_MM } from '../annotate/turnGlyph';
import type { DiagramStyle, KnownDiagramAnnotation } from '../document/diagramDocument';
import type { LayoutArrowAim, LayoutZoomArea } from '../pages/diagramPageLayout';
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
 * right to left, so it points left with its bow still up; or, given an `aim`,
 * turned about the frame's middle to point that way.
 */
export function paintEnlargeArrowOnFrame(
  frame: PictureBox,
  style: DiagramStyle,
  { rightToLeft = false, aim = null, id }: { rightToLeft?: boolean; aim?: LayoutArrowAim | null; id?: string } = {}
): PaintedAnnotations | null {
  const arrow = paintAnnotations([enlargeArrowAnnotation(id)], frame, mmToCssPx(ENLARGE_ARROW_FRAME_MM), style);
  if (!arrow) return arrow;
  if (aim) {
    const [cx, cy] = [frame.x + frame.width / 2, frame.y + frame.height / 2];
    const turn = aimTurn(aim);
    const e = cx - turn.a * cx - turn.c * cy;
    const f = cy - turn.b * cx - turn.d * cy;
    const terms = [turn.a, turn.b, turn.c, turn.d, e, f].map((value) => Number(value.toFixed(6)));
    return { markup: `<g transform="matrix(${terms.join(' ')})">${arrow.markup}</g>`, bounds: turnedBounds(arrow.bounds, turn, cx, cy) };
  }
  if (!rightToLeft) return arrow;
  // x to 2m − x, m the frame's middle.
  const across = 2 * frame.x + frame.width;
  return {
    markup: `<g transform="matrix(-1 0 0 1 ${Number(across.toFixed(4))} 0)">${arrow.markup}</g>`,
    bounds: { ...arrow.bounds, x: across - arrow.bounds.x - arrow.bounds.width },
  };
}

/** The linear part of an aim: the arrow flipped about its chord when it says so, then turned by its angle. */
interface AimTurn {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * An aim as a turn of the arrow that points right with its bow up, about its
 * frame's middle: `(x, y)` to `(a x + c y, b x + d y)`, the page's y down.
 */
function aimTurn({ angle, flipped }: LayoutArrowAim): AimTurn {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const s = flipped ? -1 : 1;
  return { a: cos, b: sin, c: -sin * s, d: cos * s };
}

/** A box turned about `(cx, cy)`: the upright box round its four corners. */
function turnedBounds(box: PictureBox, turn: AimTurn, cx: number, cy: number): PictureBox {
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].map(([x, y]) => [cx + turn.a * (x! - cx) + turn.c * (y! - cy), cy + turn.b * (x! - cx) + turn.d * (y! - cy)] as const);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The arrow's printed box, mm, and where its middle is from its frame's: measured once a style, from the painted outline. */
interface ArrowMeasure {
  w: number;
  h: number;
  /** The box's middle less the frame's, mm, pointing right. */
  dx: number;
  dy: number;
}

/**
 * What the arrow's box is measured from, mm from its frame's middle, pointing
 * right: each point its outline reaches with its pen's half round it — what
 * an aimed arrow's box is measured from too, turned.
 */
interface ArrowReach extends ArrowMeasure {
  points: (readonly [number, number, number])[];
  /** The tallest an aimed box is, at any angle, either way flipped. */
  tallest?: number;
}

/** By the style, as JSON: its arrows' pen is what the box grows with. */
const measured = new Map<string, ArrowReach>();

/** Every how many radians the tallest aimed box is looked for: a degree. */
const TALLEST_STEP = Math.PI / 180;

function measure(style: DiagramStyle): ArrowReach {
  const key = JSON.stringify(style);
  const known = measured.get(key);
  if (known) return known;
  // Its outline as the page paints it, its pen's half round it — the reach a
  // mark's own ink has, without the frame a step's marks are measured with.
  const size = ENLARGE_ARROW_FRAME_MM;
  const framePx = mmToCssPx(size);
  const drawing = annotationDrawing([enlargeArrowAnnotation()], { width: 1, height: 1 }, framePx, style);
  const mm = size / framePx;
  const points: (readonly [number, number, number])[] = [];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const take = (x: number, y: number, pad: number) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
    points.push([x * mm - size / 2, y * mm - size / 2, pad * mm]);
  };
  for (const primitive of drawing.primitives) {
    if (isDiagramMark(primitive)) markReach(primitive, drawing.context.project, drawing.context.marks, take);
  }
  const box: ArrowReach =
    minX <= maxX && minY <= maxY
      ? {
          w: (maxX - minX) * mm,
          h: (maxY - minY) * mm,
          dx: ((minX + maxX) / 2) * mm - size / 2,
          dy: ((minY + maxY) / 2) * mm - size / 2,
          points,
        }
      : { w: 0, h: 0, dx: 0, dy: 0, points };
  measured.set(key, box);
  return box;
}

/** The arrow's box aimed so, mm, and its middle from its frame's: its reach turned as the aim turns it. */
function aimedMeasure(style: DiagramStyle, aim: LayoutArrowAim): ArrowMeasure {
  const { points } = measure(style);
  if (points.length === 0) return { w: 0, h: 0, dx: 0, dy: 0 };
  const { a, b, c, d } = aimTurn(aim);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y, pad] of points) {
    const [px, py] = [a * x + c * y, b * x + d * y];
    minX = Math.min(minX, px - pad);
    minY = Math.min(minY, py - pad);
    maxX = Math.max(maxX, px + pad);
    maxY = Math.max(maxY, py + pad);
  }
  return { w: maxX - minX, h: maxY - minY, dx: (minX + maxX) / 2, dy: (minY + maxY) / 2 };
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

/** The arrow's box aimed so ({@link LayoutArrowAim}), mm, as its outline paints it in `style`'s arrows pen. */
export function aimedEnlargeArrowMm(style: DiagramStyle, aim: LayoutArrowAim): { w: number; h: number } {
  const { w, h } = aimedMeasure(style, aim);
  return { w, h };
}

/**
 * The tallest the arrow's box is aimed any way, mm: the room the row above a
 * flow row's end keeps for it, before the layout knows where it will aim.
 */
export function tallestEnlargeArrowMm(style: DiagramStyle): number {
  const reach = measure(style);
  if (reach.tallest === undefined) {
    let tallest = reach.h;
    for (let angle = 0; angle < Math.PI; angle += TALLEST_STEP) {
      for (const flipped of [false, true]) tallest = Math.max(tallest, aimedMeasure(style, { angle, flipped }).h);
    }
    reach.tallest = tallest;
  }
  return reach.tallest;
}

/** What the layout is handed of the arrow's size in `style` ({@link LayoutZoomArea}): along a row, aimed, and its tallest. */
export function enlargeArrowSizes(style: DiagramStyle): Pick<LayoutZoomArea, 'box' | 'aimedBox' | 'tallest'> {
  return {
    box: enlargeArrowMm(style),
    aimedBox: (aim) => aimedEnlargeArrowMm(style, aim),
    tallest: tallestEnlargeArrowMm(style),
  };
}

/**
 * The arrow painted with its box centred on `at`, in a target whose units are
 * `unitsPerMm` to a millimetre (a page's pt): pointing right, or left on a
 * row read right to left, or the way its `aim` turns it.
 */
export function paintEnlargeArrow(
  at: { x: number; y: number },
  unitsPerMm: number,
  style: DiagramStyle,
  { rightToLeft = false, aim = null, id }: { rightToLeft?: boolean; aim?: LayoutArrowAim | null; id?: string } = {}
): PaintedAnnotations | null {
  const size = ENLARGE_ARROW_FRAME_MM * unitsPerMm;
  if (aim) {
    // The frame moved so the turned box's middle lands on `at`.
    const { dx, dy } = aimedMeasure(style, aim);
    const frame = { x: at.x - dx * unitsPerMm - size / 2, y: at.y - dy * unitsPerMm - size / 2, width: size, height: size };
    return paintEnlargeArrowOnFrame(frame, style, { aim, id });
  }
  const { dx, dy } = measure(style);
  // The frame moved so the box's middle lands on `at`; mirrored, the box's middle is the other side of the frame's.
  const x = at.x - (rightToLeft ? -dx : dx) * unitsPerMm - size / 2;
  const y = at.y - dy * unitsPerMm - size / 2;
  return paintEnlargeArrowOnFrame({ x, y, width: size, height: size }, style, { rightToLeft, id });
}
