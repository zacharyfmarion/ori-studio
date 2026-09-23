import { PT_TO_CSS_PX, type Pen, type PenCap } from './paperStyle';

/** A pen as the stroke attributes of an SVG element. */
export interface PenSvgStroke {
  stroke: string;
  /** CSS px. */
  strokeWidth: number;
  strokeLinecap: PenCap;
  /** CSS px runs; absent is solid. */
  strokeDasharray?: string;
}

/**
 * A pen at its on-screen weight: its width in points as CSS px, and its dash —
 * multiples of its width — as runs of that many px.
 *
 * For a picture that keeps a pen's weight whatever size it is drawn at, as a
 * zoomed canvas does: the Settings close-up of erode, and the pattern
 * thumbnails (drawn non-scaling, so their own box does not scale the pen).
 */
export function penSvgStroke(pen: Pen): PenSvgStroke {
  const width = pen.width * PT_TO_CSS_PX;
  return {
    stroke: pen.color,
    strokeWidth: width,
    strokeLinecap: pen.cap,
    ...(pen.dash ? { strokeDasharray: pen.dash.map((run) => round(run * width)).join(' ') } : {}),
  };
}

/** A thousandth of a pixel: nothing a screen shows, and no 4.3999999999999995 in the DOM. */
function round(px: number): number {
  return Math.round(px * 1000) / 1000;
}
