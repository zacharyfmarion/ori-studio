import { useTranslation } from 'react-i18next';
import { cpActionRailLabel } from '../../i18n/cpVocab';
import type { OristudioCpLineTypeActionDefinition } from '../../lib/oristudioCpActions';
import styles from './CpLineTypeMark.module.css';

/**
 * A line type's letter in the ink of the creases it draws — the icon of each
 * option in the rail's line-type control and the phone tool sheet's.
 *
 * Localized: `M V E A` are initials of Mountain, Valley, Edge and Auxiliary,
 * and a locale whose words start with other letters gets other initials.
 */
export function CpLineTypeMark({
  action,
  size = 'md',
}: {
  action: OristudioCpLineTypeActionDefinition;
  /** `lg` in the phone tool sheet, whose pills are sized for a thumb. */
  size?: 'md' | 'lg';
}) {
  const { t } = useTranslation();
  return (
    <span
      className={styles.mark}
      data-line-color={action.lineColor}
      data-size={size}
      aria-hidden="true"
    >
      {cpActionRailLabel(t, action)}
    </span>
  );
}
