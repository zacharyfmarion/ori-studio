import { useTranslation } from 'react-i18next';
import { spatialSpreadFromPercent, spatialSpreadPercent } from '../../cp-workspace/folded/spatialSpreadSettings';
import type { SpatialSpreadAmount } from '../../diagram/capture/useSpatialSpreadAmount';
import { SliderRow } from '../ui/fieldRows';

export function SpatialSpreadAmountRow({
  value,
}: {
  value: SpatialSpreadAmount;
}) {
  const { t, i18n } = useTranslation();
  const percent = (n: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(n / 100);
  return (
    <SliderRow
      label={t('panels:diagram.pose.spreadAmount', 'Amount')}
      ariaLabel={t('panels:diagram.pose.spreadAmountName', 'Spread amount')}
      value={Math.round(spatialSpreadPercent(value.amount))}
      min={0}
      max={100}
      step={1}
      format={percent}
      valueText={percent}
      disabled={value.disabled}
      onGestureStart={() => !value.disabled}
      onChange={(amount) => value.preview(spatialSpreadFromPercent(amount))}
      onGestureCommit={value.commit}
    />
  );
}
