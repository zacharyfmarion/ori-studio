/**
 * The colours a solid line is drawn in (17a, RM2 of
 * `implementation-plans/diagram-references-annotations.md`): the style's
 * arrow ink — no colour stored, so a change of style recolours it — References'
 * magenta, five print colours, or one picked by hand (Custom…).
 *
 * The five are print colours, not Edit's text colours (`TEXT_COLORS`), which
 * are screen colours: Edit's orange and light blue print with too little
 * contrast on white. Their names are what the analytics events send — never a
 * colour's value.
 *
 * A leaf: the settings store reads it, so it imports nothing at run time.
 */

/** A colour of the palette, by name; `ink` is no colour stored. */
export type AnnotationPaletteName = 'ink' | 'reference' | 'red' | 'orange' | 'green' | 'blue' | 'purple';

/** A colour as the analytics events name it: one of the palette's, or one picked by hand. */
export type AnnotationColorName = AnnotationPaletteName | 'custom';

/**
 * References' magenta: the light theme's reference ink
 * (`REFERENCE_COLORS.light.input`), which a step's reference lines are drawn
 * in on a page.
 */
export const REFERENCE_LINE_COLOR = '#c91d87';

/** The palette's colours after Ink, in the order the select offers them. */
export const ANNOTATION_PALETTE: readonly { name: Exclude<AnnotationPaletteName, 'ink'>; color: string }[] = [
  { name: 'reference', color: REFERENCE_LINE_COLOR },
  { name: 'red', color: '#e03131' },
  { name: 'orange', color: '#e8590c' },
  { name: 'green', color: '#2f9e44' },
  { name: 'blue', color: '#1971c2' },
  { name: 'purple', color: '#7048e8' },
];

/** A colour as a mark stores it: `#rrggbb`. */
const HEX = /^#[0-9a-f]{6}$/i;

/** Whether `value` is a colour a mark can store: a `#rrggbb` string. */
export function isAnnotationColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/**
 * The palette's colour a stored one is, in either case — a file may write
 * `#1971C2`, which is Blue — or undefined for one picked by hand.
 */
export function paletteEntryOf(color: string): (typeof ANNOTATION_PALETTE)[number] | undefined {
  const lower = color.toLowerCase();
  return ANNOTATION_PALETTE.find((entry) => entry.color === lower);
}

/** A stored colour's name: Ink for none, the palette's name for one of its colours, else Custom. */
export function annotationColorName(color: string | undefined | null): AnnotationColorName {
  if (color === undefined || color === null) return 'ink';
  return paletteEntryOf(color)?.name ?? 'custom';
}
