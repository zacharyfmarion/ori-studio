/**
 * A pen's dash as the Settings field shows it: run lengths in multiples of
 * the width, separated by spaces — `8 2 1 2` is the Origami House mountain,
 * an empty field is solid. Written the way the template states its dashes,
 * so a value can be copied straight off a printed style guide.
 */
import { parseDash } from './paperStyle';

/**
 * The field's text for a dash. Solid is the empty string; runs are written
 * with whatever precision they carry, so a `2.5` stays `2.5`.
 */
export function formatDashText(dash: number[] | null): string {
  return dash ? dash.map((run) => String(run)).join(' ') : '';
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
