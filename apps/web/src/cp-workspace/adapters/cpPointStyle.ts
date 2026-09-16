import { readCssVarColor } from '../renderer/cssColor';
import type { Rgba } from '../renderer/types';
import type { CpPointStyle } from './cpPointsToScene';

/** `.cp-vertex` element opacity in the SVG. */
const VERTEX_OPACITY = 0.72;

const FALLBACK: Rgba = [0.6, 0.6, 0.64, 1];
/** `--status-warning` in the default theme, for a root that resolves nothing. */
const PINNED_FALLBACK: Rgba = [0xd7 / 255, 0xa8 / 255, 0x5c / 255, 1];

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * alpha];
}

/**
 * Resolve crease-point / vertex colours from theme CSS variables, matching the
 * SVG's `.cp-point` and `.cp-vertex` styles. `styleRoot` is any element
 * inheriting the theme (e.g. the canvas or document root).
 *
 * Approximations vs. the SVG (acceptable for now): the vertex's `color-mix`
 * stroke is treated as the base colour at the element opacity, and the element
 * opacity is folded into the fill/stroke alpha.
 */
export function resolveCpPointStyle(styleRoot: Element, pointSize: number): CpPointStyle {
  return {
    pointSize,
    pointFill: readCssVarColor(styleRoot, '--accent-primary', FALLBACK),
    pointStroke: readCssVarColor(styleRoot, '--bg-primary', FALLBACK),
    vertexFill: withAlpha(readCssVarColor(styleRoot, '--bg-paper', FALLBACK), VERTEX_OPACITY),
    vertexStroke: withAlpha(readCssVarColor(styleRoot, '--text-secondary', FALLBACK), VERTEX_OPACITY),
    circleStroke: readCssVarColor(styleRoot, '--accent-secondary', FALLBACK),
    // Fully opaque, unlike the ordinary vertex dot: a pin is a constraint the
    // user placed and has to be able to find again, so it does not wear the
    // 0.72 the derived-vertex marks wear to stay out of the way of the creases.
    pinnedFill: readCssVarColor(styleRoot, '--status-warning', PINNED_FALLBACK),
    pinnedStroke: readCssVarColor(styleRoot, '--bg-primary', FALLBACK),
  };
}
