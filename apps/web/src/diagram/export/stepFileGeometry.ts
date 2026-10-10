/**
 * Where a step's file puts things (`stepFiles.ts`), in mm from its canvas's
 * top-left corner: the number, the picture's box and the instruction's slot,
 * spaced as a page's cell spaces them. Apart from the composer so the
 * remembered export options can be held to it without loading it.
 *
 * Pure.
 */
import { STEP_TEXT_LEADING_MM } from '../pages/diagramPageLayout';

/** Clear space round everything a file draws. */
export const PAD_MM = 4;
/** The number's baseline, and the picture's box below it, from the canvas's top edge, as on a page. */
export const NUMBER_BASELINE_MM = 7;
export const PICTURE_TOP_MM = 8;
/** The instruction's first baseline below the picture's box, and the room under its last. */
export const TEXT_GAP_MM = 5;
const TEXT_DESCENT_MM = 1.5;
/** A same-size file's slot for the instruction, in lines. */
export const STEP_FILE_TEXT_LINES = 5;
/** The smallest picture box a canvas leaves. */
const MIN_PICTURE_MM = 12;
/** A cropped file sets its instruction at least this wide, however narrow its drawing. */
export const CROPPED_TEXT_MIN_WIDTH_MM = 50;
/** Above and below a line's baseline, in ems: room for accents and descenders. */
export const ASCENT_EM = 1;
export const DESCENT_EM = 0.3;

/** The canvas's sides, mm. */
export const STEP_FILE_MM_RANGE = { min: 2 * PAD_MM + MIN_PICTURE_MM, max: 500, step: 1 } as const;

export interface StepFileOptions {
  /** Each file prints its step's number. */
  number: boolean;
  /** Each file prints its step's instruction. */
  text: boolean;
  /** Every file is the canvas; off, each is cut to its drawing. */
  sameSize: boolean;
  widthMm: number;
  heightMm: number;
  /** No ground behind the drawing; off, the file is white, as the page is. */
  transparent: boolean;
}

/** The smallest canvas height that leaves the picture its box under the number and over the text. */
export function stepFileMinHeightMm(options: Pick<StepFileOptions, 'number' | 'text'>): number {
  return (
    2 * PAD_MM + (options.number ? PICTURE_TOP_MM : 0) + (options.text ? textSlotMm() : 0) + MIN_PICTURE_MM
  );
}

/** The instruction's slot under the picture's box: the gap, five lines, and room under the last. */
export function textSlotMm(): number {
  return TEXT_GAP_MM + (STEP_FILE_TEXT_LINES - 1) * STEP_TEXT_LEADING_MM + TEXT_DESCENT_MM;
}

/** The canvas's picture box: the square between the number and the text's slot, centred in what is left. */
export function pictureBoxOf(options: StepFileOptions): { x: number; y: number; size: number } {
  const top = PAD_MM + (options.number ? PICTURE_TOP_MM : 0);
  const bottom = options.heightMm - PAD_MM - (options.text ? textSlotMm() : 0);
  const room = Math.max(0, bottom - top);
  const size = Math.max(0, Math.min(options.widthMm - 2 * PAD_MM, room));
  return { x: (options.widthMm - size) / 2, y: top + (room - size) / 2, size };
}
