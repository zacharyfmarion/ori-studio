import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OristudioBpFlap, OristudioBpStretch } from '../../engine/oristudioBpTypes';
import { bpFlapLabelList, bpFlapLabels } from '../../lib/bpFlapLabel';
import { IconButton } from '../ui/IconButton';

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
    <div className="bp-packing-stretch-nav__stepper">
      <span className="bp-packing-stretch-nav__label">{label}</span>
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
      <span className="bp-packing-stretch-nav__count">{`${index + 1}/${count}`}</span>
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
  const configCount = stretch.configCount ?? 0;
  const patternCount = stretch.patternCount ?? 0;
  const hasChoice = configCount > 1 || patternCount > 1;
  return (
    <div
      className="bp-packing-stretch-nav"
      role="group"
      aria-label={t('panels:bpPacking.stretchNav', 'Stretch {{id}} pattern navigation', {
        id: name,
      })}
    >
      <span className="bp-packing-stretch-nav__title">
        {t('panels:bpPacking.stretch', 'Stretch {{id}}', { id: name })}
      </span>
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
        <span className="bp-packing-stretch-nav__warning">
          {t('panels:bpPacking.noValidPattern', 'No valid pattern')}
        </span>
      ) : (
        !hasChoice && (
          <span className="bp-packing-stretch-nav__note">
            {t('panels:bpPacking.onlyOnePattern', 'Only one pattern')}
          </span>
        )
      )}
    </div>
  );
}
