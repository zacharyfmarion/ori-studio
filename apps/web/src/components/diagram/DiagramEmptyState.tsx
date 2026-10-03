import { useTranslation } from 'react-i18next';
import { BookOpen, Compass, Link2, PenTool, Plus, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import styles from './DiagramEmptyState.module.css';

/**
 * A diagram with no steps yet. Useful with no crease pattern at all: a step can
 * be written before it has a picture, or start from a drawing, so the ways in
 * are to add one or upload pictures — or drop them here — and, with a crease
 * pattern open, to link a step to one of its patterns or send steps from
 * References; with none open, Go to Edit stands in for those two (D12). The
 * diagram itself comes into being with that first step, never on open.
 */
export function DiagramEmptyState({
  readOnly,
  dropTarget,
  onAddStep,
  onUpload,
  patternOpen,
  onLink,
  onFromReferences,
  onGoToEdit,
}: {
  readOnly: boolean;
  /** Pictures are being dragged over it. */
  dropTarget: boolean;
  onAddStep: () => void;
  /** Pick pictures, each a step. Called from the click itself. */
  onUpload: () => void;
  /** A crease pattern is open to link a step to. */
  patternOpen: boolean;
  /** Add a step and choose its pattern. */
  onLink: () => void;
  /** Open the References browser: its cards become the first steps. */
  onFromReferences: () => void;
  /** Go to Edit, to open or draw the crease pattern a step links to. */
  onGoToEdit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.state} data-drop-target={dropTarget || undefined}>
      <div className={styles.icon} aria-hidden="true">
        <BookOpen size={22} />
      </div>
      <h2 className={styles.title}>{t('panels:diagram.empty.title', 'Start a diagram')}</h2>
      <p className={styles.message}>
        {t(
          'panels:diagram.empty.message',
          'A diagram is your folding sequence, one step at a time. Add a step, then give it a picture and an instruction — or upload your drawings, one step each.'
        )}
      </p>
      <div className={styles.actions}>
        <Button variant="primary" disabled={readOnly} onClick={onAddStep}>
          <Plus size={15} aria-hidden="true" />
          {t('panels:diagram.empty.addStep', 'Add step')}
        </Button>
        <Button variant="secondary" disabled={readOnly} onClick={onUpload}>
          <Upload size={15} aria-hidden="true" />
          {t('panels:diagram.empty.upload', 'Upload pictures…')}
        </Button>
        {patternOpen && (
          <Button variant="secondary" disabled={readOnly} onClick={onLink}>
            <Link2 size={15} aria-hidden="true" />
            {t('panels:diagram.empty.link', 'Link a pattern…')}
          </Button>
        )}
        {patternOpen && (
          <Button variant="secondary" disabled={readOnly} onClick={onFromReferences}>
            <Compass size={15} aria-hidden="true" />
            {t('panels:diagram.empty.fromReferences', 'From References…')}
          </Button>
        )}
        {!patternOpen && (
          <Button variant="ghost" onClick={onGoToEdit}>
            <PenTool size={15} aria-hidden="true" />
            {t('panels:diagram.empty.goToEdit', 'Go to Edit')}
          </Button>
        )}
      </div>
    </div>
  );
}
