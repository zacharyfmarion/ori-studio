import type { TFunction } from 'i18next';
import type { OristudioCpLineStyle } from '../lib/creasePatternViewport';

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

export type SimulatorAccuracy = 'fast' | 'accurate';

export function simulatorAccuracyLabel(t: TFunction, value: SimulatorAccuracy): string {
  switch (value) {
    case 'fast':
      return t('panels:simulator.accuracyFast', 'Fast');
    case 'accurate':
      return t('panels:simulator.accuracyAccurate', 'Accurate');
    default:
      return value;
  }
}

export function simulatorAccuracyTitle(t: TFunction, value: SimulatorAccuracy): string {
  switch (value) {
    case 'fast':
      return t('panels:simulator.accuracyFastTitle', 'Step preview with standard simulator work');
    case 'accurate':
      return t(
        'panels:simulator.accuracyAccurateTitle',
        'Step preview with smaller solver increments and more settling'
      );
    default:
      return value;
  }
}
