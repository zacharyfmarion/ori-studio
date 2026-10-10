/**
 * Text's look (17b, §4 of `implementation-plans/diagram-references-annotations.md`):
 * the options a label has — a colour, Bold, a halo and a size in pt — as the
 * rail keeps the next label's and the Layers pane sets a selected one's, and
 * the sizes Size offers and a file reads.
 *
 * A leaf: the settings store reads it, so it imports nothing at run time but
 * the colours' leaf.
 */
import { isAnnotationColor } from './annotationColors';

/**
 * Text's look (17b), as the rail sets the next label's and the Layers pane a
 * selected one's: its colour (null the style's arrow ink), Bold, a halo, and
 * its size in pt (null: with the picture, `LABEL_SIZE` of the frame).
 * Today's label is {@link PLAIN_TEXT_STYLE}.
 */
export interface TextStyle {
  color: string | null;
  bold: boolean;
  halo: boolean;
  sizePt: number | null;
}

/** A label as every label was drawn before Text had options: the arrow ink, Regular, no halo, with the picture. */
export const PLAIN_TEXT_STYLE: Readonly<TextStyle> = { color: null, bold: false, halo: false, sizePt: null };

/**
 * The sizes Size offers, in pt, besides With the picture (17b): a References
 * letter is 9 pt, and a label at the 50 mm cards and the canvas draw is about
 * 7.
 */
export const TEXT_SIZES_PT: readonly number[] = [7, 9, 12, 16];

/** The sizes a label's `sizePt` may be, in pt: a file's past them is a newer build's. */
export const TEXT_SIZE_PT = { min: 4, max: 48 } as const;

/** How far a label's words may hang off its anchor along each axis, in pt: a file's past it is a newer build's. */
export const TEXT_OFFSET_PT_MAX = 200;

/**
 * A halo's width, in ems of its text: References' 3 ink halo on its 9.6 ink
 * letter (`DIAGRAM_LABEL_INK`), so a pulled letter's halo is today's. Half
 * of it reaches past the letters' ink.
 */
export const TEXT_HALO_EMS = 0.3125;

/** Whether `value` is a size a label can store, in pt: a finite number within {@link TEXT_SIZE_PT}. */
export function isTextSizePt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= TEXT_SIZE_PT.min && value <= TEXT_SIZE_PT.max;
}

/**
 * A text style as a preference keeps it: each option read on its own, and
 * one that is not what it should be — a hand-edited key, an older build's —
 * read as {@link PLAIN_TEXT_STYLE}'s.
 */
export function readTextStyle(value: unknown): TextStyle {
  const stored = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    color: isAnnotationColor(stored.color) ? stored.color : PLAIN_TEXT_STYLE.color,
    bold: stored.bold === true,
    halo: stored.halo === true,
    sizePt: isTextSizePt(stored.sizePt) ? stored.sizePt : PLAIN_TEXT_STYLE.sizePt,
  };
}

/** Whether two text styles are one. */
export function sameTextStyle(a: TextStyle, b: TextStyle): boolean {
  return a.color === b.color && a.bold === b.bold && a.halo === b.halo && a.sizePt === b.sizePt;
}
