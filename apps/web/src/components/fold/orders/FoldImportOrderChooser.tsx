import { useIsPhoneLayout } from '../../../platform/phoneLayout';
import { FoldOrderStacks } from './FoldOrderStacks';
import type { FoldOrderInspection } from '../../../fold/orders/useFoldOrderInspection';
import { useTranslation } from 'react-i18next';
import { STORAGE_KEYS } from '../../../lib/storage';
import { useFoldImportOrderUi } from '../../../fold/orders/foldImportOrderUi';
import { foldOrderChoiceKey } from '../../../fold/io/foldImportFlow';
import { useFoldImportUiStore } from '../../../fold/io/foldImportUiStore';
import { ToolHintWindow } from '../../ui/tools/ToolHintWindow';
import { Button } from '../../ui/Button';
import { FoldOrderChooser } from './FoldOrderChooser';
import styles from './FoldOrderChooser.module.css';

export function FoldImportOrderChooser({ container, inspection, onFrame }: { container: HTMLElement | null; inspection: FoldOrderInspection; onFrame?: (frame: HTMLElement | null) => void }) {
  const { t } = useTranslation();
  const phone = useIsPhoneLayout();
  const { choosing, flow } = useFoldImportOrderUi();
  if (!choosing || !flow) return null;
  const { opened, choice, component, confirmed, committing } = choosing;
  const part = opened.components[component];
  const preview = choosing.previews.get(foldOrderChoiceKey(choice));
  const parts = opened.components.map((c, i) => ({ ...c, i })).filter((c) => c.orders > 1 || c.truncated);
  const remaining = confirmed.filter((value, i) => !value && i !== component).length;
  const title = t('tools:fold.order.choose', 'Choose layer order');
  return <ToolHintWindow container={container} collapseKey={STORAGE_KEYS.foldToolHintCollapsed} title={title} meta="" ariaLabel={title} collapsible={false} height={phone ? 'capped' : 'default'} onFrame={onFrame}>
    {parts.length > 1 && <div className={styles.navigation} aria-label={t('tools:fold.order.regions', 'Independent regions')}>
      {parts.map((c, i) => <Button key={c.i} size="sm" disabled={committing} aria-pressed={c.i === component} onClick={() => flow.region(c.i)}>
        {t('tools:fold.order.region', 'Region {{number}}', { number: i + 1 })}{confirmed[c.i] ? ' ✓' : ''}
      </Button>)}
    </div>}
    <FoldOrderChooser index={choice[component] ?? 0} count={part?.orders ?? 1} exact={!part?.truncated && opened.count.exact}
      ready={preview?.status === 'ready' && !committing && !choosing.searching} waiting={preview?.status === 'working' || !preview || committing || choosing.searching === true}
      onStep={(delta) => {
        const count = part?.orders ?? 1;
        const index = (choice[component] ?? 0) + delta;
        flow.choose(component, part?.truncated ? Math.max(0, Math.min(count - 1, index)) : (index + count) % count);
      }} onBack={() => useFoldImportUiStore.getState().close()} onAccept={() => void flow.accept(component)}
      error={choosing.searchFailed || preview?.status === 'failed'}
      onSearch={!opened.count.exact && !choosing.searchLimited ? () => void flow.searchLonger() : undefined}
      acceptLabel={remaining === 0 ? choosing.request.kind === 'project-cp' && choosing.request.stepId
        ? t('tools:fold.order.acceptUpdate', 'Use orders and update step')
        : t('tools:fold.order.acceptAll', 'Use orders and add step') : undefined} />
    <FoldOrderStacks inspection={inspection} />
  </ToolHintWindow>;
}
