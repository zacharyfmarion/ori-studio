import { useTranslation } from 'react-i18next';
import { ANGLE_MARK_TICKS } from '../../diagram/annotate/annotationModel';
import type { DiagramTicks } from '../../diagram/document/diagramDocument';
import { SegmentedRow } from '../ui/fieldRows';

/**
 * How many ticks an equality mark draws — across each half of an angle mark,
 * on each part of equal divisions (ED7) — as a row of the Layers pane: one,
 * two or three, a second set in a step told apart by two.
 */
export function DiagramTicksRow({
  value,
  disabled,
  onChange,
}: {
  value: DiagramTicks | undefined;
  disabled: boolean;
  onChange: (ticks: DiagramTicks) => void;
}) {
  const { t } = useTranslation();
  return (
    <SegmentedRow
      label={t('panels:diagram.annotations.ticks', 'Ticks')}
      value={String(value ?? 1)}
      disabled={disabled}
      options={ANGLE_MARK_TICKS.map((ticks) => ({ id: String(ticks), label: String(ticks) }))}
      onChange={(ticks) => onChange(Number(ticks) as DiagramTicks)}
    />
  );
}
