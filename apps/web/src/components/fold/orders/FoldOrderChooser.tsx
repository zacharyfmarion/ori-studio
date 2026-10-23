import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import styles from './FoldOrderChooser.module.css';

/**
 * Shared explicit acceptance controls. Display settings belong in the sidebar.
 * While a search for more orders runs (`searching`), the orders found so far
 * stay named and Stop ends it; once one has run (`searched`), an exact count
 * says so: there are no other orders.
 */
export function FoldOrderChooser({ index, count, exact, ready, waiting, onStep, onBack, onAccept, onSearch, onStop, acceptLabel, error = false, movingVaries = false, searching = false, searched = false }: {
  index: number; count: number; exact: boolean; ready: boolean; waiting: boolean;
  onStep: (delta: number) => void; onBack: () => void; onAccept: () => void;
  onSearch?: () => void; onStop?: () => void; acceptLabel?: string; error?: boolean; movingVaries?: boolean;
  searching?: boolean; searched?: boolean;
}) {
  const { t } = useTranslation();
  return <section className={styles.root} aria-label={t('tools:fold.order.choose', 'Choose layer order')}>
    <p className={styles.note}>{t('tools:fold.order.help', 'Preview the arrangements, then choose the order you want.')}</p>
    {movingVaries && <p className={styles.note} role="status">{t('tools:fold.order.movingVaries', 'These orders move different layers. Check the highlighted paper.')}</p>}
    <div className={styles.navigation}>
      <IconButton size="sm" aria-label={t('tools:fold.order.previous', 'Previous layer order')}
        disabled={waiting || count < 2 || (!exact && index === 0)} onClick={() => onStep(-1)}><ChevronLeft size={16} /></IconButton>
      <span role="status" aria-live="polite">{waiting && !searching ? t('tools:fold.order.loading', 'Loading order…') : count === 0 ? t('tools:fold.order.noneFound', 'No order found yet') : exact
        ? t('tools:fold.order.count', 'Order {{index}} of {{count}}', { index: index + 1, count })
        : t('tools:fold.order.found', 'Order {{index}} of {{count}} found', { index: index + 1, count })}</span>
      <IconButton size="sm" aria-label={t('tools:fold.order.next', 'Next layer order')}
        disabled={waiting || count < 2 || (!exact && index >= count - 1)} onClick={() => onStep(1)}><ChevronRight size={16} /></IconButton>
    </div>
    {error && <p role="alert" className={styles.note}>{t('tools:fold.order.failed', 'The order could not be loaded. Go back and try again, or choose another order.')}</p>}
    {searching
      ? <p className={styles.note} role="status">{t('tools:fold.order.searching', 'Searching for more orders…')}</p>
      : !exact
        ? <p className={styles.note}>{t('tools:fold.order.incomplete', 'Search incomplete. More orders may exist.')}</p>
        : searched && <p className={styles.note} role="status">{t('tools:fold.order.noOthers', 'Search finished. There are no other orders.')}</p>}
    {searching && onStop
      ? <Button size="sm" onClick={onStop}>{t('tools:fold.order.stop', 'Stop searching')}</Button>
      : onSearch && <Button size="sm" disabled={waiting} onClick={onSearch}>{t('tools:fold.order.search', 'Find more orders')}</Button>}
    <div className={styles.actions}>
      <Button size="sm" variant="secondary" onClick={onBack}>{t('tools:fold.order.back', 'Back')}</Button>
      <Button size="sm" variant="primary" disabled={!ready} onClick={onAccept} data-fold-order-accept="">
        {acceptLabel ?? t('tools:fold.order.accept', 'Use this order')}
      </Button>
    </div>
  </section>;
}
