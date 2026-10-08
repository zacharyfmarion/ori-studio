import { useTranslation } from 'react-i18next';
import { useStepAnnotations } from '../../diagram/annotate/useStepAnnotations';
import { primaryModifierLabel } from '../../lib/platform';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
import { Button } from '../ui/Button';
import { ToggleRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { DiagramCardMarksNotice } from './DiagramCardMarksNotice';
import styles from './DiagramStepAnnotations.module.css';

/**
 * The Step pane's annotations (D13).
 *
 * Out of Annotate, how many the step has — or, on a References step whose
 * card's marks are part of its picture and that has none of its own, that
 * they are there (17e) — and the way in. In Annotate — where
 * the tool in hand says what it does in the tool window over the canvas
 * (`DiagramAnnotateToolWindow`), and the list and the selected one's controls
 * are the Layers pane's (`DiagramLayers`) — what is about the step and drawing
 * on it: the Snap switch (for a finger, which has no ⌘ to hold), a notice on
 * a References step whose card's marks are still part of its picture, with
 * Make Editable to lift them (17e) — disabled, with the reason, where they and
 * the step's own would be more than it holds — and a notice when they were
 * drawn on another picture.
 */
export function DiagramStepAnnotations({ step }: { step: DiagramStep }) {
  const { t } = useTranslation();
  const annotations = useStepAnnotations(step);
  const { annotating, editable } = annotations;

  if (!annotating) {
    if (step.picture === null && step.annotations.length === 0) return null;
    return (
      <div className={styles.summary}>
        <span>
          {step.annotations.length === 0
            ? annotations.cardMarks
              ? t('panels:diagram.annotations.noneMarksInPicture', 'Its marks are part of its picture')
              : t('panels:diagram.annotations.none', 'No annotations')
            : t('panels:diagram.annotations.count', '{{count}} annotations', {
                count: step.annotations.length,
                defaultValue_one: '{{count}} annotation',
              })}
        </span>
        <Button size="sm" variant="secondary" disabled={!editable} onClick={annotations.annotate}>
          {t('panels:diagram.annotations.annotate', 'Annotate')}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.annotations}>
      <ToggleRow
        label={t('panels:diagram.annotations.snap', 'Snap to Picture')}
        help={t(
          'panels:diagram.annotations.snapHelp',
          'Circles, right angles’ corners, callouts’ points, the dots labels hang from and the ends of lines snap to the picture’s points and to other annotations nearby. Hold {{modifier}} to put one down anywhere. Arrows go where they are drawn.',
          { modifier: primaryModifierLabel() }
        )}
        checked={annotations.snap}
        onChange={annotations.setSnap}
      />
      {annotations.cardMarks && (
        <div className={styles.notice}>
          <DiagramCardMarksNotice
            cardMarks={annotations.cardMarks}
            disabled={!editable}
            onMakeEditable={() => annotations.makeMarksEditable('annotate_notice')}
          />
        </div>
      )}
      {annotations.outOfStep && (
        <div className={styles.notice}>
          <Notice tone="warning">
            <p className={styles.noticeText}>
              {t('panels:diagram.annotations.pictureChanged', 'The picture changed since these annotations were drawn.')}
            </p>
            <Button size="sm" variant="ghost" disabled={!editable} onClick={annotations.keep}>
              {t('panels:diagram.annotations.keep', 'Keep Them Here')}
            </Button>
          </Notice>
        </div>
      )}
    </div>
  );
}
