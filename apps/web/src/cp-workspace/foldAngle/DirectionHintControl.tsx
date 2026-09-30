/**
 * Fold-direction-hint control for the CP context panel.
 *
 * # Why this is a second group rather than more chips in the first
 *
 * The fold-angle group answers "how far does this fold", and it can only ask
 * that of a crease that has already been decided (`Red1`/`Blue2`). A hint
 * answers "which way *would* this fold, once something decides" — and it can
 * only be asked of a crease that has *not* been decided (`LineColor::None`).
 * The two act on disjoint sets of creases, and the kernel's gates say so.
 *
 * Folding them into one group would mean a single `enabled` covering both, and
 * then a selection of purely undecided creases would show the degree presets and
 * the Degrees input, all of which would silently do nothing. Two groups, each
 * self-hiding, keeps every visible control live. A selection holding both kinds
 * shows both, and each reports how many creases it actually reaches.
 *
 * Before this existed a hint could only be produced as a side effect of
 * unassigning a decided crease, so a crease that was drawn undecided — or
 * imported from a FOLD `U` edge — could never be hinted, and a hint once set
 * could never be changed or cleared.
 */
import { useTranslation } from 'react-i18next';

import {
  describeDirectionHintAffected,
  directionHintOptions,
  isDirectionHintActive,
  type DirectionHintChange,
} from './directionHintActions';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useDirectionHintSelection } from './useDirectionHintSelection';

export function DirectionHintControl() {
  const { t } = useTranslation();
  const { summary, enabled, setHint } = useDirectionHintSelection();

  if (!enabled) return null;

  const options = directionHintOptions(t);
  const title = t('tools:cpContext.foldDirection', 'Fold direction');
  return (
    <div className="cp-context-panel__group">
      <div className="cp-context-panel__group-title">{title}</div>
      {/* One answer among three, so one segmented control. Nothing is pressed
          on a mixed selection — the convention the fold-angle group uses when
          its creases disagree, rather than picking a winner to highlight. */}
      <SegmentedControl<DirectionHintChange>
        fill
        aria-label={title}
        value={
          options.find((option) => isDirectionHintActive(summary, option.change))?.change ?? null
        }
        options={options.map((option) => ({
          value: option.change,
          label: option.label,
          title: option.description,
        }))}
        onChange={(change) => void setHint(change)}
      />
      {/* The count stays visible when mixed rather than being replaced by it:
          "how many creases will this reach" is the question the readout is
          there to answer, and it is no less relevant because they disagree. */}
      <div className="cp-context-panel__readout">
        {describeDirectionHintAffected(t, summary)}
        {summary.mixed ? ` · ${t('tools:cpContext.foldDirectionMixed', 'Mixed')}` : ''}
      </div>
    </div>
  );
}
