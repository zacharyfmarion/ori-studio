import type { TFunction } from 'i18next';
import type { ConnectedSpread } from '@oristudio/layer-spread';
import type { SpatialSpread } from '../cp-workspace/folded/foldedFigureSpread';
import { clampSpreadAmount, SPREAD_AMOUNT_RANGE } from '../cp-workspace/folded/layerSpreadSettings';
import { clampSpatialSpreadAmount, MAX_SPATIAL_SPREAD_AMOUNT } from '../cp-workspace/folded/spatialSpreadSettings';
import type { PreparedConnectedSpread } from './connectedScene';
import { sharedOpeningAmount } from './equalOpening';

/** Convert only against the solution for the currently displayed model. */
export function spreadUpdate(
  spread: ConnectedSpread | SpatialSpread,
  perspective: boolean,
  prepared: PreparedConnectedSpread | null,
  spatialGain: number | null,
): { amount: number; capped: boolean } | null {
  if (spread.kind === 'spatial') {
    if (spread.version !== 1 || spatialGain === null) return null;
    const amount = spread.amount / spatialGain;
    return { amount: clampSpatialSpreadAmount(amount), capped: amount > MAX_SPATIAL_SPREAD_AMOUNT };
  }
  if (spread.version === 3 || !prepared) return null;
  const amount = sharedOpeningAmount(spread, prepared, perspective);
  return { amount: clampSpreadAmount('connected', amount), capped: amount > SPREAD_AMOUNT_RANGE.connected.max };
}

export function spacingUpdateText(t: TFunction, capped: boolean) {
  return capped
    ? t('panels:diagram.spread.cappedOpeningNotice', 'This view exceeds the new maximum. Update to use 100% and bring its layers closer together.')
    : t('panels:diagram.spread.equalOpeningNotice', 'This picture uses an older Amount scale. Update to keep the spacing in this view and use the new scale.');
}
