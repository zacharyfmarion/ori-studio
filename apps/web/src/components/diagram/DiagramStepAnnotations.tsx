import { useTranslation } from 'react-i18next';
import { useStepAnnotations } from '../../diagram/annotate/useStepAnnotations';
import { primaryModifierLabel } from '../../lib/platform';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
import { Button } from '../ui/Button';
import { ToggleRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import styles from './DiagramStepAnnotations.module.css';

/**
 * The Step pane's annotations (D13).
 *
 * Out of Annotate, how many the step has and the way in. In Annotate — where
 * the tool in hand says what it does in the tool window over the canvas
 * (`DiagramAnnotateToolWindow`), and the list and the selected one's controls
 * are the Layers pane's (`DiagramLayers`) — what is about the step and drawing
 * on it: the Snap switch (for a finger, which has no ⌘ to hold), and a notice
 * when they were drawn on another picture.
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
            ? t('panels:diagram.annotations.none', 'No annotations')
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
