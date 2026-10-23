import { useTranslation } from 'react-i18next';
import { useFoldCollapse } from '../../../fold/collapse/useFoldCollapse';
import { useFoldImportUiStore } from '../../../fold/io/foldImportUiStore';
import { useLayoutStore } from '../../../store/layoutStore';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import styles from './FoldCollapse.module.css';

export function FoldCollapseControls() {
  const collapse = useFoldCollapse();
  const { t } = useTranslation();
  if (!collapse) return null;
  return <div className={styles.controls}>
    <Notice>{!collapse.available
      ? t('panels:fold.collapse.unavailable', 'Source CP unavailable. The saved snapshot still replays.')
      : collapse.changed
        ? t('panels:fold.collapse.changed', 'Update available. This step still uses its saved CP revision.')
        : t('panels:fold.collapse.saved', 'Using the saved CP revision. Source edits are applied only when you update.')}</Notice>
    <Button size="sm" disabled={!collapse.available} onClick={() => useLayoutStore.getState().activateWorkspace('edit')}>
      {t('panels:fold.collapse.openSource', 'Open source CP')}
    </Button>
    <Button size="sm" disabled={!collapse.available || collapse.readOnly}
      onClick={() => useFoldImportUiStore.getState().open({ kind: 'project-cp', stepId: collapse.node.id })}>
      {t('panels:fold.collapse.update', 'Update from CP')}
    </Button>
    <p className={styles.note}>{t('panels:fold.collapse.replay', 'Updating replays later folds. Check the timeline for Changed or Broken steps before continuing.')}</p>
  </div>;
}
