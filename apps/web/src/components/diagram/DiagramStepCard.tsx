import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Lock } from 'lucide-react';
import { isLockedStep, type DiagramStep } from '../../diagram/document/diagramDocument';
import { Badge } from '../ui/Badge';
import styles from './DiagramStepCard.module.css';

/**
 * One step in the Steps grid: its number and kind, its picture, and its
 * instruction.
 *
 * An `option` of the grid's listbox rather than a button: the grid is one
 * control, navigated with the arrows, and a screen reader announces it as a
 * list to choose from rather than a row of unrelated buttons. The grid moves
 * focus between cards as the selection moves (a roving tab stop), which is
 * what lets a screen reader follow it.
 */
export const DiagramStepCard = forwardRef<
  HTMLDivElement,
  {
    step: DiagramStep;
    /** 1-based, as the page will print it. */
    number: number;
    selected: boolean;
    /** Whether this card is the grid's tab stop. */
    tabStop: boolean;
    onSelect: (stepId: string) => void;
  }
>(function DiagramStepCard({ step, number, selected, tabStop, onSelect }, ref) {
  const { t } = useTranslation();
  const locked = isLockedStep(step);
  const text = step.text.trim();

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      className={styles.card}
      data-selected={selected || undefined}
      data-step-id={step.id}
      onClick={() => onSelect(step.id)}
    >
      <div className={styles.header}>
        <span className={styles.number}>
          {t('panels:diagram.card.number', 'Step {{number}}', { number })}
        </span>
        <Badge tone="neutral">
          {locked
            ? t('panels:diagram.card.badgeNewer', 'Newer')
            : t('panels:diagram.card.badgeEmpty', 'Empty')}
        </Badge>
      </div>
      <div className={styles.well}>
        {locked ? (
          <span className={styles.placeholder}>
            <Lock size={18} aria-hidden="true" />
            {t('panels:diagram.card.locked', 'Made with a newer Ori Studio')}
          </span>
        ) : (
          <span className={styles.placeholder}>
            <ImagePlus size={18} aria-hidden="true" />
            {t('panels:diagram.card.noPicture', 'No picture yet')}
          </span>
        )}
      </div>
      <p className={styles.instruction} data-empty={text === '' || undefined}>
        {text === '' ? t('panels:diagram.card.noInstruction', 'No instruction') : text}
      </p>
    </div>
  );
});
