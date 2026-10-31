import type { TFunction } from 'i18next';
import type { LayerSpreadToggle } from '../../cp-workspace/folded/layerSpreadControls';
export function foldAdjustSpreadAction(
  active: boolean,
  available: boolean,
  t: TFunction,
): Omit<LayerSpreadToggle, 'run'> & { label: string } {
  return {
    label: t('panels:fold.canvas.adjustSpread', 'Adjust spread'),
    pressed: active,
    disabled: !available,
  };
}
