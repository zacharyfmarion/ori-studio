import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { SplitButton } from '../ui/SplitButton';
import { DiagramHistoryButtons } from './DiagramHistoryButtons';
import { DiagramTitleField } from './DiagramTitleField';
import styles from './DiagramHeader.module.css';

/**
 * The Diagram workspace's header: the title and how many steps, then the verbs
 * that act on the whole diagram. It wears the shared `panel-toolbar` frame so
 * it meets the side pane's tab bar at the same height, and adds rules only for
 * what is its own: on a screen too narrow for both, the verbs wrap onto a row
 * of their own under the title rather than off the edge.
 */
export function DiagramHeader({
  title,
  stepCount,
  readOnly,
  onRename,
  onAddStep,
  onUpload,
  patternOpen,
  onLink,
  drawerSlot,
}: {
  title: string;
  stepCount: number;
  readOnly: boolean;
  onRename: (title: string) => void;
  onAddStep: () => void;
  /** Pick pictures, each a step. Called from the menu row itself. */
  onUpload: () => void;
  /** A crease pattern is open to link a step to. */
  patternOpen: boolean;
  /** Add a step and choose its pattern. */
  onLink: () => void;
  /** Where the touch layer seats the Step pane's pill (`viewDrawerSlot`). */
  drawerSlot: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  return (
    <div className={`panel-toolbar ${styles.header}`}>
      <div className={`panel-toolbar__group ${styles.title}`}>
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
      <div className={`panel-toolbar__group ${styles.actions}`}>
        <DiagramHistoryButtons />
        <SplitButton
          size="sm"
          variant="secondary"
          icon={<Plus size={14} aria-hidden="true" />}
          label={t('panels:diagram.header.addStep', 'Add step')}
          disabled={readOnly}
          onClick={onAddStep}
          menuLabel={t('panels:diagram.header.moreAdd', 'More ways to add steps')}
          actions={[
            {
              id: 'upload-pictures',
              label: t('panels:diagram.header.uploadPictures', 'Upload pictures…'),
              onSelect: onUpload,
            },
            {
              id: 'link-pattern',
              label: t('panels:diagram.header.linkPattern', 'Link pattern…'),
              disabled: !patternOpen,
              title: patternOpen
                ? undefined
                : t('panels:diagram.actions.noPatternHint', 'Open a crease pattern in Edit to link it'),
              onSelect: onLink,
            },
          ]}
        />
        <div className="panel-toolbar__pills" ref={drawerSlot} />
      </div>
    </div>
  );
}
