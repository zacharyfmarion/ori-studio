import { useTranslation } from 'react-i18next';
import { stepsOf } from '../../diagram/document/diagramDocument';
import { resetPagePlacements } from '../../diagram/pages/placementActions';
import { usePrintedLayout } from '../../diagram/pages/printedFrames';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Button } from '../ui/Button';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import styles from './DiagramPagePlacements.module.css';

export function DiagramPagePlacements() {
  const { t } = useTranslation();
  const document = useWorkspaceStore((state) => state.diagram);
  const selected = useWorkspaceStore((state) => state.diagramSelectedStepId);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const { pages } = usePrintedLayout();
  const count = document ? stepsOf(document).filter((step) => step.place || step.placeNewer).length : 0;
  const pageIndex = pages?.layout.pages.findIndex((each) => each.cells.some((cell) => cell.stepId === selected));
  if (!count) return null;
  return (
    <CollapsibleSection title={t('panels:diagram.placement.title', 'On the page')}>
      <p className={styles.note}>{t('panels:diagram.placement.count', 'Steps placed by hand: {{count}}', { count })}</p>
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={readOnly || !count || pageIndex === undefined || pageIndex < 0}
          onClick={() => pageIndex !== undefined && resetPagePlacements(pageIndex)}
        >
          {t('panels:diagram.placement.resetPage', 'Reset This Page')}
        </Button>
        <Button size="sm" disabled={readOnly || !count} onClick={() => resetPagePlacements(null)}>
          {t('panels:diagram.placement.resetAll', 'Reset All')}
        </Button>
      </div>
    </CollapsibleSection>
  );
}
