import { useTranslation } from 'react-i18next';
import { wrapDegrees } from '../../lib/angleUnits';
import { NumberRow } from '../ui/fieldRows';

/**
 * A boxed mark's Rotation row in the Layers pane (Revision 3, R3-33 A): its
 * turn in degrees clockwise, wrapped into (−180°, 180°] as an image's
 * Rotation is in the Edit canvas's Properties — the one way to set it back
 * to exactly 0 without Shift. One undo step, the transform box's own label.
 */
export function DiagramRotationRow({
  degrees,
  editable,
  onCommit,
}: {
  /** Its turn as its kind reads it (`boxedMarkOf`). */
  degrees: number;
  editable: boolean;
  onCommit: (degrees: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <NumberRow
      label={t('panels:diagram.annotations.rotation', 'Rotation')}
      // Two decimals, as the image's field reads, so a turn never shows as 29.999999.
      value={wrapDegrees(Math.round(degrees * 100) / 100)}
      step={1}
      suffix="°"
      disabled={!editable}
      normalize={wrapDegrees}
      onCommit={onCommit}
    />
  );
}
