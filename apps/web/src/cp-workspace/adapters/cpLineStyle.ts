/**
 * Bind the ported Oriedita line-style rules (`lib/oristudioCpLineStyle`) to the
 * theme and the GPU scene: the rules say *which* ink a crease takes, this says
 * what that ink is in the current theme.
 */
import type { OristudioCpLineStyle } from '../../lib/creasePatternViewport';
import { cpLineStyleDashSlot, cpLineStyleInk } from '../../lib/oristudioCpLineStyle';
import { readCssVarColor } from '../renderer/cssColor';
import type { Rgba } from '../renderer/types';
import { resolveCpLineColor } from './cpLineColor';

/** How one crease is painted: its resolved stroke colour and dash slot. */
export interface CpLineAppearance {
  color: Rgba;
  dashSlot: number;
}

/** Ori Studio's black crease ink — the theme token `Black0` creases paint with. */
const INK_COLOR_VAR = '--fold-border';
const INK_FALLBACK: Rgba = [0.067, 0.078, 0.09, 1];
/** The theme's stand-in for Oriedita `GREY_10`: its ink, washed toward the canvas. */
const GREY_COLOR_VAR = '--fold-monochrome-valley';
const GREY_FALLBACK: Rgba = [0.635, 0.635, 0.635, 1];

/**
 * Build the per-crease appearance resolver for a line style, reading the ink and
 * grey off `styleRoot` (any element inheriting the theme) so the WebGL colours
 * stay tied to the same tokens the rest of the surface paints with.
 */
export function createCpLineAppearanceResolver(
  style: OristudioCpLineStyle,
  mode: 'mvf' | 'agrh',
  styleRoot: Element
): (color: string) => CpLineAppearance {
  const ink = readCssVarColor(styleRoot, INK_COLOR_VAR, INK_FALLBACK);
  const grey = readCssVarColor(styleRoot, GREY_COLOR_VAR, GREY_FALLBACK);
  return (color) => {
    const dashSlot = cpLineStyleDashSlot(style, color);
    switch (cpLineStyleInk(style, color)) {
      case 'black':
        return { color: ink, dashSlot };
      case 'grey':
        return { color: grey, dashSlot };
      case 'own':
        return { color: resolveCpLineColor(color, mode, styleRoot), dashSlot };
    }
  };
}
