import { useTranslation } from 'react-i18next';
import { diagramStepChoice, type DiagramStepAction } from '../../diagram/actions/diagramActions';
import { SegmentedControl } from '../ui/SegmentedControl';
import styles from './DiagramStepShowAs.module.css';

/**
 * How a linked step shows its pattern (D19) — Crease pattern, Folded or
 * Simulated — at the top of the Step pane, in Pose or not: the choice every
 * other control in the pane is about. The ways and what each does are the
 * step's action catalog's (`show-as`); nothing for a step that is not linked.
 */
export function DiagramStepShowAs({ actions }: { actions: readonly DiagramStepAction[] }) {
  const { t } = useTranslation();
  const showAs = diagramStepChoice(actions, 'show-as');
  if (!showAs) return null;
  const label = t('panels:diagram.picture.showAs', 'Show as');
  return (
    // The label over the control: the three ways are too wide to sit beside
    // it in a pane this narrow, and cut short they say nothing.
    <div className={styles.showAs} title={showAs.hint}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <SegmentedControl
        size="sm"
        fill
        aria-label={label}
        value={showAs.options.find((option) => option.checked)?.id ?? null}
        disabled={showAs.disabled}
        options={showAs.options.map((option) => ({ value: option.id, label: option.label }))}
        onChange={(way) => showAs.options.find((option) => option.id === way)?.run()}
      />
    </div>
  );
}
