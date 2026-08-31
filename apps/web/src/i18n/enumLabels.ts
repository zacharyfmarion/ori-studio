import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldAngleDisplay,
  OristudioCpLineStyle,
} from '../lib/creasePatternViewport';
import type {
  OristudioCpDivideMode,
  OristudioCpLengthenColorMode,
} from '../lib/oristudioCpToolSettings';

/**
 * Render-time translations for small fixed enums whose English labels live in data modules.
 * Each helper uses literal `t()` keys (so they extract) with the data English as the
 * fallback, keyed by the stable enum value.
 */

export function cpLineStyleLabel(t: TFunction, style: OristudioCpLineStyle): string {
  switch (style) {
    case 'color':
      return t('tools:lineStyle.color', 'Color');
    case 'black-white':
      return t('tools:lineStyle.blackWhite', 'Black & white');
    case 'color-and-shape':
      return t('tools:lineStyle.colorAndShape', 'Color + shape');
    case 'black-one-dot':
      return t('tools:lineStyle.blackOneDot', 'Black one-dot');
    case 'black-two-dot':
      return t('tools:lineStyle.blackTwoDot', 'Black two-dot');
    default:
      return style;
  }
}

export function cpLengthenColorModeLabel(
  t: TFunction,
  mode: OristudioCpLengthenColorMode
): string {
  return mode === 'same'
    ? t('tools:lengthenColorMode.same', 'Same')
    : t('tools:lengthenColorMode.active', 'Active');
}

export function cpLengthenColorModeTitle(
  t: TFunction,
  mode: OristudioCpLengthenColorMode
): string {
  return mode === 'same'
    ? t('tools:lengthenColorMode.sameTitle', 'Extend each crease in its own line type')
    : t('tools:lengthenColorMode.activeTitle', 'Extend in the active line type');
}

export function cpDivideModeLabel(t: TFunction, mode: OristudioCpDivideMode): string {
  return mode === 'ratio'
    ? t('tools:divideMode.ratio', 'Ratio')
    : t('tools:divideMode.count', 'Count');
}

export function cpDivideModeTitle(t: TFunction, mode: OristudioCpDivideMode): string {
  return mode === 'ratio'
    ? t('tools:divideMode.ratioTitle', 'Divide the line at a ratio')
    : t('tools:divideMode.countTitle', 'Divide the line into equal parts');
}

export function cpFoldAngleDisplayLabel(
  t: TFunction,
  display: OristudioCpFoldAngleDisplay
): string {
  switch (display) {
    case 'color':
      return t('tools:foldAngleDisplay.color', 'Color');
    case 'opacity':
      return t('tools:foldAngleDisplay.opacity', 'Opacity');
    default:
      return display;
  }
}

