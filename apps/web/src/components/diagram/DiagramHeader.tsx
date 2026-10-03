import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { DiagramHistoryButtons } from './DiagramHistoryButtons';
import { DiagramTitleField } from './DiagramTitleField';
import styles from './DiagramHeader.module.css';

/**
 * The Diagram workspace's header: the title and how many steps, then the verbs
 * that act on the whole diagram. It wears the shared `panel-toolbar` frame so
 * it meets the side pane's tab bar at the same height, and adds rules only for
 * what is its own.
 */
export function DiagramHeader({
  title,
  stepCount,
  readOnly,
  onRename,
  onAddStep,
  drawerSlot,
}: {
  title: string;
  stepCount: number;
  readOnly: boolean;
  onRename: (title: string) => void;
  onAddStep: () => void;
  /** Where the touch layer seats the Step pane's pill (`viewDrawerSlot`). */
  drawerSlot: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  return (
    <div className="panel-toolbar">
      <div className="panel-toolbar__group">
        <DiagramTitleField title={title} disabled={readOnly} onRename={onRename} />
        {stepCount > 0 && (
          <span className={styles.count}>
            {t('panels:diagram.header.stepCount', {
              count: stepCount,
              defaultValue_one: '1 step',
              defaultValue_other: '{{count}} steps',
            })}
          </span>
        )}
      </div>
      <div className="panel-toolbar__group">
        <DiagramHistoryButtons />
        <Button size="sm" variant="secondary" disabled={readOnly} onClick={onAddStep}>
          <Plus size={14} aria-hidden="true" />
          {t('panels:diagram.header.addStep', 'Add step')}
        </Button>
        <div className="panel-toolbar__pills" ref={drawerSlot} />
      </div>
    </div>
  );
}
