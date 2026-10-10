import { useTranslation } from 'react-i18next';
import { usePathColorPick } from '../../diagram/pages/usePathColorPick';
import { ColorRow } from '../ui/fieldRows';

/**
 * The Page pane's Path color row. Its own component so that a pick's moves
 * re-render this row and the Pages view's band (`DiagramPageBand`), not the
 * whole pane; the bindings are `usePathColorPick`'s.
 */
export function DiagramPathColorRow() {
  const { t } = useTranslation();
  const color = usePathColorPick();
  return (
    <ColorRow
      label={t('panels:diagram.pagePane.pathColor', 'Path color')}
      value={color.value}
      disabled={color.readOnly}
      onChange={color.onPick}
      onCommit={color.onPickEnd}
      onClear={color.onReset}
    />
  );
}
