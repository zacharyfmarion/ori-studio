/**
 * What the Folded models controls offer, and what each option is called.
 *
 * These lived in `CreasePatternPanel` while exactly one component read them.
 * Two do now — the dropdown and the phone modal both render
 * `FoldedFigureControls` — so they move to where both can see them rather than
 * being re-exported from a panel, which is the direction AGENTS.md points a
 * panel's contents in anyway.
 *
 * Every label is a literal-key `t()` call: the i18n extractor only sees
 * literals, so a computed key would silently drop the string from the catalogue.
 */
import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpRgbColor,
} from '../../engine/oristudioCpTypes';
import type { FoldedFigureSide } from '../../lib/foldedFigureSides';

export const FOLDED_DISPLAY_STYLE_OPTIONS: OristudioCpFoldedFigureDisplayStyle[] = [
  'Paper5',
  'Transparent3',
  'Wire2',
];

export function foldedDisplayStyleLabel(
  t: TFunction,
  value: OristudioCpFoldedFigureDisplayStyle
): string {
  switch (value) {
    case 'Paper5':
      return t('panels:creasePattern.foldedStyle.paper', 'Paper');
    case 'Transparent3':
      return t('panels:creasePattern.foldedStyle.transparent', 'Transparent');
    case 'Wire2':
      return t('panels:creasePattern.foldedStyle.wire', 'Wire');
    case 'Development1':
      return t('panels:creasePattern.foldedStyle.dev1', 'Dev 1');
    case 'Development4':
      return t('panels:creasePattern.foldedStyle.dev4', 'Dev 4');
    case 'None0':
      return t('panels:creasePattern.foldedStyle.none', 'None');
    default:
      return value;
  }
}

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

// Named "… color" rather than "Front" / "Back", which the Side control directly
// above these rows already uses for the view.
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
