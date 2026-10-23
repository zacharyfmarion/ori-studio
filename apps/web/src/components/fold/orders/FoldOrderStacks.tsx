import { useTranslation } from 'react-i18next';
import type { FoldOrderInspection } from '../../../fold/orders/useFoldOrderInspection';
import { Button } from '../../ui/Button';
import styles from './FoldOrderChooser.module.css';

export function FoldOrderStacks({ inspection }: { inspection: FoldOrderInspection }) {
  const { t } = useTranslation();
  if (!inspection.rows.length) return null;
  return <details className={styles.stacks}>
    <summary>{t('tools:fold.order.inspect', 'Inspect layer stacks')}</summary>
    <p className={styles.note}>{t('tools:fold.order.stackHelp', 'Select a region to highlight it. Layers are listed from front to back; highlighted differences are relative to the first preview.')}</p>
    {inspection.rows.map((cell) => <Button key={cell.index} size="sm" variant="ghost" aria-pressed={inspection.selected === cell.index}
      onClick={() => inspection.select(inspection.selected === cell.index ? null : cell.index)}>
      {t('tools:fold.order.stack', 'Region {{number}}: {{layers}}', { number: cell.index + 1, layers: cell.faces_top_to_bottom.map((id) => id + 1).join(' → ') })}
      {cell.changed ? ' •' : ''}
    </Button>)}
  </details>;
}
