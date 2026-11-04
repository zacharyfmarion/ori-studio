import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayerStatusText, LayerStatusView, LayerStepperWait } from '../../layer-order/model/layerOrderSelectors';
import type { LayerSide } from '../../layer-order/engine/layerOrderEngine';
import { Pager } from '../ui/Pager';
import type { LayerOrderCopy } from './layerOrderInspectorCopy';
import styles from './LayerOrderStatus.module.css';

export interface LayerOrderStatusProps {
  readonly status: LayerStatusView;
  readonly copy: LayerOrderCopy;
  /** The count runs (D7): "Counting solutions…" until it has a number. */
  readonly counting: boolean;
  /** The count has finished: exact, or stopped at its cap with a lower bound ("at least N"). */
  readonly countDone: boolean;
  readonly side: LayerSide;
  readonly onStep: (direction: 'previous' | 'next') => void;
}

/**
 * What the status says to a screen reader: the count once it has finished,
 * exact or a lower bound at its cap ("at least N"), and "Counting solutions…"
 * while it runs, so the running number, growing slice by slice, is never
 * queued up line after line.
 */
function spokenStatus(text: LayerStatusText, countDone: boolean): LayerStatusText {
  if ((text.key === 'solutions' || text.key === 'layer_orders') && !text.count.exact && !countDone) return { key: 'none' };
  if (text.key === 'pictures_and_orders' && !(text.pictures.exact && text.orders.exact) && !countDone) return { key: 'none' };
  return text;
}

/**
 * The inspector's first row (A3, `Round4-States`' counting states): how many
 * solutions fit, with the dot that turns to success once one order is
 * decided, and ‹ n of N › through them in a stable order. "At least N" and
 * ‹ Solution n › while the count runs, since until then n counts the
 * solutions found, not their rank (E9); with the count skipped (D7) the
 * status names the solution shown and the stepper has no total. With X-ray
 * on it counts and steps through every layer order (D5).
 *
 * The stepper is the shared `Pager` (Properties' ‹ › and Diagram's), not the
 * board's bordered buttons: one stepper control across the app, its ends and
 * busy state said the same way.
 *
 * Memoised by value: the model builds a new view each render, and a pane
 * hover changes none of it.
 */
export const LayerOrderStatus = memo(function LayerOrderStatus({
  status,
  copy,
  counting,
  countDone,
  side,
  onStep,
}: LayerOrderStatusProps) {
  const { t } = useTranslation();
  const { stepper } = status;
  // What a waiting ‹ or › says: why it waits (the model's), or, at no end it can name, its label alone.
  const waitHint = (wait: LayerStepperWait | null): { hint?: string } => {
    switch (wait) {
      case null:
        return {};
      case 'stepping':
        return { hint: t('dialogs:layerOrder.status.stepping', 'Finding the solution…') };
      case 'only':
        return {
          hint:
            side === 'back'
              ? t('dialogs:layerOrder.status.onlyBack', 'There is one solution from the back')
              : t('dialogs:layerOrder.status.onlyFront', 'There is one solution from the front'),
        };
      case 'first':
        return { hint: t('dialogs:layerOrder.status.first', 'This is the first solution') };
      case 'last':
        return { hint: t('dialogs:layerOrder.status.last', 'This is the last solution') };
    }
  };
  return (
    <section className={styles.status} aria-label={t('dialogs:layerOrder.status.label', 'Solutions')}>
      <p className={styles.line} title={copy.statusTitle(status)}>
        <span className={styles.dot} data-state={status.dot} aria-hidden="true" />
        <span aria-hidden="true" data-status-shown="">
          {copy.status(status.text, counting)}
        </span>
        <span className={styles.spoken} role="status">
          {copy.status(spokenStatus(status.text, countDone), counting && !countDone)}
        </span>
      </p>
      {stepper && (
        <Pager
          label={t('dialogs:layerOrder.status.stepper', 'Solution shown')}
          previous={{
            label: t('dialogs:layerOrder.status.previous', 'Previous solution'),
            disabled: !stepper.previous || stepper.busy,
            ...waitHint(stepper.waits.previous),
            run: () => {
              if (stepper.previous && !stepper.busy) onStep('previous');
            },
          }}
          next={{
            label: t('dialogs:layerOrder.status.next', 'Next solution'),
            disabled: !stepper.next || stepper.busy,
            ...waitHint(stepper.waits.next),
            run: () => {
              if (stepper.next && !stepper.busy) onStep('next');
            },
          }}
        >
          {copy.stepperCount(stepper)}
        </Pager>
      )}
    </section>
  );
}, sameStatusProps);

function sameStatusProps(a: LayerOrderStatusProps, b: LayerOrderStatusProps): boolean {
  return (
    a.copy === b.copy &&
    a.counting === b.counting &&
    a.countDone === b.countDone &&
    a.side === b.side &&
    a.onStep === b.onStep &&
    JSON.stringify(a.status) === JSON.stringify(b.status)
  );
}
