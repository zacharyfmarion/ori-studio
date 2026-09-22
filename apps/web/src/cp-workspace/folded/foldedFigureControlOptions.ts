/**
 * The Style menu's model rows, and what each is called.
 *
 * Every label is a literal-key `t()` call: the i18n extractor only sees
 * literals, so a computed key would silently drop the string from the catalogue.
 */
import type { TFunction } from 'i18next';
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
// color actions), in the order the rows are offered. The values they show are
// the figure's effective paper style; the kernel model's colours mirror it.
export type FoldedColorKey = 'front_color' | 'back_color' | 'line_color';

export const FOLDED_COLOR_FIELDS: ReadonlyArray<{ key: FoldedColorKey }> = [
  { key: 'front_color' },
  { key: 'back_color' },
  { key: 'line_color' },
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
