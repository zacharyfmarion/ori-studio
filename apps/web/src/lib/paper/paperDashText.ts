/**
 * A pen's dash as the Settings field shows it: run lengths in multiples of
 * the width, separated by spaces — `8 2 1 2` is the Diagram preset's
 * mountain, an empty field is solid. Written the way the Origami House
 * template states its dashes, so a value can be copied straight off a
 * printed style guide.
 */
import { parseDash } from './paperStyle';

/**
 * The field's text for a dash. Solid is the empty string.
 *
 * Runs are rounded to three decimals before they are written, because not
 * every dash in the app was typed by a person: the mono-dashed crease style
 * derives Oriedita's device-pixel runs as multiples of the pen's own width
 * (`ORIEDITA_MOUNTAIN_DASH_MULTIPLES`), which is `9.090909090909092`. Printed
 * in full that overruns the field and the trigger's label, and the reader
 * learns nothing from the tail; three decimals is finer than any dash a pen
 * can draw. A value that needs no rounding is untouched, so a typed `2.5`
 * stays `2.5` and round-trips through {@link parseDashText} unchanged.
 */
export function formatDashText(dash: number[] | null): string {
  return dash ? dash.map((run) => String(Math.round(run * 1000) / 1000)).join(' ') : '';
}

/**
 * A dash from the field's text, or undefined when it is not one. Runs may be
 * separated by spaces or commas (a stylesheet's `8, 2` pastes in unchanged);
 * an empty field is solid. The rules on the numbers are `parseDash`'s: finite,
 * non-negative, at least one positive.
 */
export function parseDashText(text: string): number[] | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const runs = trimmed.split(/[\s,]+/).map((token) => Number(token));
  return parseDash(runs);
}
