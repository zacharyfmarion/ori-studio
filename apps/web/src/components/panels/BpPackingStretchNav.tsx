import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OristudioBpFlap, OristudioBpStretch } from '../../engine/oristudioBpTypes';
import { bpFlapLabelList, bpFlapLabels } from '../../lib/bpFlapLabel';
import { IconButton } from '../ui/IconButton';
import { CanvasContextBar, CanvasContextBarLabel, CanvasContextBarTitle } from '../ui/CanvasContextBar';
import styles from './BpPackingStretchNav.module.css';

/**
 * One "pick which of these" control. Only rendered when there is more than one
 * to pick from — see {@link BpPackingStretchNav}.
 */
function StretchStepper({
  label,
  index,
  count,
  onStep,
}: {
  label: string;
  index: number;
  count: number;
  onStep: (delta: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.stepper} data-stretch-part="stepper">
      <CanvasContextBarLabel data-stretch-part="label">{label}</CanvasContextBarLabel>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:bpPacking.previousStepper', 'Previous {{label}}', {
          label: label.toLowerCase(),
        })}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={14} />
      </IconButton>
      <span className={styles.count} data-stretch-part="count">{`${index + 1}/${count}`}</span>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:bpPacking.nextStepper', 'Next {{label}}', { label: label.toLowerCase() })}
        onClick={() => onStep(1)}
      >
        <ChevronRight size={14} />
      </IconButton>
    </div>
  );
}

/**
 * Contextual control for cycling a stretch's GOPS configuration and pattern —
 * the "pick a valid crease pattern by hand" navigation. Mirrors BP Studio's
 * Stretch.switchConfig/switchPattern (±1 with wraparound).
 *
 * A stepper is shown only when it has something to step through, which is
 * upstream's rule: its `Store` gadget is `v-if="size > 1"`, and its stretch
 * panel replaces both steppers with a sentence when each has one option
 * (`app/vue/panel/stretch.vue`). Most stretches have exactly one configuration,
 * so a stepper that renders regardless reads as broken rather than as "nothing
 * to choose here" — and it is why the Config stepper looked like a second copy
 * of Pattern. It is a real, separate choice (a configuration is a way of
 * cutting the overlap up; a pattern is a way of creasing one cutting), just a
 * rare one.
 *
 * Upstream has no case for a stretch with no pattern at all — it deletes such a
 * stretch — so the empty state here is ours: say so, and show no picker.
 */
export function BpPackingStretchNav({
  stretch,
  flaps,
  onSwitchConfig,
  onSwitchPattern,
}: {
  stretch: OristudioBpStretch;
  flaps: OristudioBpFlap[];
  onSwitchConfig: (delta: number) => void;
  onSwitchPattern: (delta: number) => void;
}) {
  const { t } = useTranslation();
  // The flaps, not the raw `"10,12,14,22"` id: the id means nothing on a canvas
  // that labels its flaps with letters.
  const name = bpFlapLabelList(bpFlapLabels(stretch.flapIds, flaps), t);
  const title = t('panels:bpPacking.stretch', 'Stretch {{id}}', { id: name });
  const configCount = stretch.configCount ?? 0;
  const patternCount = stretch.patternCount ?? 0;
  const hasChoice = configCount > 1 || patternCount > 1;
  return (
    <CanvasContextBar
      aria-label={t('panels:bpPacking.stretchNav', 'Stretch {{id}} pattern navigation', {
        id: name,
      })}
    >
      {/* A flap can be named anything, so the title is ellipsized in CSS and the
          full text kept here — the group's accessible name carries it too. */}
      <CanvasContextBarTitle title={title} data-stretch-part="title">
        {title}
      </CanvasContextBarTitle>
      {configCount > 1 && (
        <StretchStepper
          label={t('panels:bpPacking.config', 'Config')}
          index={stretch.configIndex ?? 0}
          count={configCount}
          onStep={onSwitchConfig}
        />
      )}
      {patternCount > 1 && (
        <StretchStepper
          label={t('panels:bpPacking.pattern', 'Pattern')}
          index={stretch.patternIndex ?? 0}
          count={patternCount}
          onStep={onSwitchPattern}
        />
      )}
      {stretch.patternFound === false ? (
        <span className={styles.warning} data-stretch-part="warning">
          {t('panels:bpPacking.noValidPattern', 'No valid pattern')}
        </span>
      ) : (
        !hasChoice && (
          <span className={styles.note} data-stretch-part="note">
            {t('panels:bpPacking.onlyOnePattern', 'Only one pattern')}
          </span>
        )
      )}
    </CanvasContextBar>
  );
}
