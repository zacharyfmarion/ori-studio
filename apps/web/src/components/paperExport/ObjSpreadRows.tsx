/**
 * An OBJ's spread, as the export dialog sets it: Spread layers, and while on,
 * its Amount — the rows a figure's own Spread section shows, with the same
 * names, over the dialog's draft (`usePaperObjSpread`). A flat figure's is
 * Default's, the one flat spread with a 3D form, so there is no Spread by;
 * and the 3D preview turns the paper instead of shearing it, so no reveal.
 *
 * A spread that cannot be made says why under the switch, which then turns
 * it off but not on.
 */
import { useTranslation } from 'react-i18next';
import { objSpreadSlider } from '../../paperExport/objSpreadSlider';
import type { PaperObjSpreadBinding } from '../../paperExport/usePaperObjSpread';
import { SliderRow, ToggleRow } from '../ui/fieldRows';

export function ObjSpreadRows({ binding }: { binding: PaperObjSpreadBinding }) {
  const { t, i18n } = useTranslation();
  const { kind, value, set, preparation } = binding;
  const failed = preparation.status === 'failed' ? preparation.message : undefined;
  const slider = objSpreadSlider(kind, value.amount);
  const percent = (shown: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(shown / 100);
  return (
    <>
      <ToggleRow
        label={t('panels:diagram.pose.spreadLayersRow', 'Spread layers')}
        note={failed}
        checked={value.on}
        disabled={failed !== undefined && !value.on}
        title={failed}
        onChange={(on) => set({ ...value, on })}
      />
      {value.on && (
        <SliderRow
          label={t('panels:diagram.pose.spreadAmount', 'Amount')}
          ariaLabel={t('panels:diagram.pose.spreadAmountName', 'Spread amount')}
          value={slider.value}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          format={percent}
          valueText={percent}
          onChange={(shown) => set({ on: true, amount: slider.amountOf(shown) })}
          onReset={() => set({ on: true, amount: slider.reset })}
        />
      )}
    </>
  );
}
