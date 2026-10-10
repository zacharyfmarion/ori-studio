import { useTranslation } from 'react-i18next';
import { tooManyMarksHint, type CardMarksGate } from '../../diagram/actions/diagramActions';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import styles from './DiagramCardMarksNotice.module.css';

/**
 * Annotate's notice on a References step whose card's marks are still part of
 * its picture (17e, RM8): it says so, and Make Editable lifts them — held,
 * with the reason, where they and the step's own would be more than a step
 * holds. The Step pane shows it with the Snap switch, and the Layers pane over
 * its list, where the marks the picture holds are otherwise nowhere to be seen.
 */
export function DiagramCardMarksNotice({
  cardMarks,
  disabled,
  onMakeEditable,
}: {
  /** How many marks it would lift, how many the step would hold with them, and whether that fits. */
  cardMarks: CardMarksGate;
  /** The diagram cannot change. */
  disabled: boolean;
  onMakeEditable: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Notice>
      <p className={styles.text}>
        {t('panels:diagram.annotations.marksInPicture', 'This step’s marks are part of its picture.')}
      </p>
      {!cardMarks.fits && <p className={styles.text}>{tooManyMarksHint(cardMarks, t)}</p>}
      <Button size="sm" variant="ghost" disabled={disabled || !cardMarks.fits} onClick={onMakeEditable}>
        {t('panels:diagram.annotations.makeEditable', 'Make Editable')}
      </Button>
    </Notice>
  );
}
