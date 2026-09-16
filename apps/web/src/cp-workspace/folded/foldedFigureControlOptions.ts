/**
 * The Style menu's model rows, and what each is called.
 *
 * Every label is a literal-key `t()` call: the i18n extractor only sees
 * literals, so a computed key would silently drop the string from the catalogue.
 */
import type { TFunction } from 'i18next';
import type { OristudioCpRgbColor } from '../../engine/oristudioCpTypes';
import type { FoldedFigureSide } from '../../lib/foldedFigureSides';

// Spelled out rather than initialled. Two options no longer need the abbreviation,
// and the word is its own tooltip.
export function foldedStateLabel(t: TFunction, value: FoldedFigureSide): string {
  switch (value) {
    case 'Front0':
      return t('panels:creasePattern.foldedState.front', 'Front');
    case 'Back1':
      return t('panels:creasePattern.foldedState.back', 'Back');
  }
}

// Front/back/line color pickers for a folded model (Oriedita's Front/Back/Line
// color actions). Fallbacks mirror the Rust FoldedFigureModel defaults.
export type FoldedColorKey = 'front_color' | 'back_color' | 'line_color';

export const FOLDED_COLOR_FIELDS: Array<{ key: FoldedColorKey; fallback: OristudioCpRgbColor }> = [
  { key: 'front_color', fallback: { red: 255, green: 255, blue: 50 } },
  { key: 'back_color', fallback: { red: 233, green: 233, blue: 233 } },
  { key: 'line_color', fallback: { red: 0, green: 0, blue: 0 } },
];

// Named "… color" rather than "Front" / "Back", which the Side rows above these
// already use for the view.
export function foldedColorLabel(t: TFunction, key: FoldedColorKey): string {
  switch (key) {
    case 'front_color':
      return t('panels:creasePattern.foldedColor.front', 'Front color');
    case 'back_color':
      return t('panels:creasePattern.foldedColor.back', 'Back color');
    case 'line_color':
      return t('panels:creasePattern.foldedColor.line', 'Line color');
    default:
      return key;
  }
}
