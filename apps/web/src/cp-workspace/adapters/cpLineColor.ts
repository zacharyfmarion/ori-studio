import { cpLineColorClass } from '../../lib/creasePatternViewport';
import { readCssVarColor } from '../renderer/cssColor';
import type { Rgba } from '../renderer/types';

/**
 * Resolve the CSS class produced by {@link cpLineColorClass} to the theme
 * variable that class paints with. This keeps the WebGL colours tied to the same
 * source of truth as the SVG renderer.
 *
 * Covers the default "color" line style in `mvf` mode. Returns `null` for cases
 * this step does not yet handle (e.g. `agrh` kind classes), so callers fall back.
 */
const CLASS_SUFFIX_TO_VAR: Record<string, string> = {
  mountain: '--fold-mountain',
  valley: '--fold-valley',
  border: '--fold-border',
  flat: '--fold-flat',
  unassigned: '--fold-unassigned',
  orange: '--cp-color-orange',
  magenta: '--cp-color-magenta',
  green: '--cp-color-green',
  yellow: '--cp-color-yellow',
  purple: '--cp-color-purple',
  other: '--cp-color-other',
};

/** The CSS variable a given line colour renders with, or `null` if unmapped. */
export function cpLineColorVar(color: string, mode: 'mvf' | 'agrh'): string | null {
  const tokens = cpLineColorClass(color, mode).split(/\s+/);
  const lineColorToken = tokens.find((t) => t.startsWith('crease--line-color-'));
  const foldToken = tokens.find((t) => t.startsWith('crease--fold-'));
  const suffix = lineColorToken
    ? lineColorToken.slice('crease--line-color-'.length)
    : foldToken
      ? foldToken.slice('crease--fold-'.length)
      : null;
  return suffix ? (CLASS_SUFFIX_TO_VAR[suffix] ?? null) : null;
}

/** Fallback stroke colour when a line colour cannot be resolved (neutral grey). */
const FALLBACK: Rgba = [0.6, 0.6, 0.64, 1];

/**
 * Resolve a line colour to its rendered RGBA by reading the mapped theme
 * variable off `styleRoot` (any element inheriting the theme, e.g. the canvas).
 */
export function resolveCpLineColor(
  color: string,
  mode: 'mvf' | 'agrh',
  styleRoot: Element
): Rgba {
  const varName = cpLineColorVar(color, mode);
  return varName ? readCssVarColor(styleRoot, varName, FALLBACK) : FALLBACK;
}
