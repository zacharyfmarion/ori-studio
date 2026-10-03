import { useTranslation } from 'react-i18next';
import { BookOpen, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import styles from './DiagramEmptyState.module.css';

/**
 * A diagram with no steps yet. Useful with no crease pattern at all: a step can
 * be written before it has a picture, so the way in is simply to add one. The
 * diagram itself comes into being with that first step, never on open.
 */
export function DiagramEmptyState({
  readOnly,
  onAddStep,
}: {
  readOnly: boolean;
  onAddStep: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.state}>
      <div className={styles.icon} aria-hidden="true">
        <BookOpen size={22} />
      </div>
      <h2 className={styles.title}>{t('panels:diagram.empty.title', 'Start a diagram')}</h2>
      <p className={styles.message}>
        {t(
          'panels:diagram.empty.message',
          'A diagram is your folding sequence, one step at a time. Add a step, then give it a picture and an instruction.'
        )}
      </p>
      <Button variant="primary" disabled={readOnly} onClick={onAddStep}>
        <Plus size={15} aria-hidden="true" />
        {t('panels:diagram.empty.addStep', 'Add step')}
      </Button>
    </div>
  );
}
