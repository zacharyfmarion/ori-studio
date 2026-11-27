import type { FoldCollapseTo } from '../../../fold/document/foldSequenceDocument';
import type { FoldCreaseCollapseControls as Controls } from '../../../fold/creaseCollapse/creaseCollapseToolWindow';
import { FieldRow } from '../../ui/fieldRows/FieldRow';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { FoldKindMark } from '../FoldKindMark';
import styles from './FoldCreaseCollapseControls.module.css';

/** Each letter by the mark the rest of Fold draws it with: an open crease is an existing crease, solid. */
const MARKS: Readonly<Record<FoldCollapseTo, 'valley' | 'mountain' | 'crease'>> = {
  valley: 'valley',
  mountain: 'mountain',
  open: 'crease',
};

/**
 * Collapse's controls in the Fold tool window
 * (`fold/creaseCollapse/creaseCollapseToolWindow`): the letter a click sets
 * a crease to, then how many creases are set and where they stand. The
 * status line keeps its room whether or not it has words, so a message that
 * comes and goes never moves the control above it.
 */
export function FoldCreaseCollapseControls({ controls }: { controls: Controls }) {
  const { letter } = controls;
  return (
    <div className={styles.root} data-fold-collapse="">
      <FieldRow label={letter.label} kind="segmented" divider={false} disabled={letter.disabled}>
        <SegmentedControl<FoldCollapseTo>
          size="sm"
          iconsOnly
          aria-label={letter.label}
          value={letter.value}
          disabled={letter.disabled}
          options={letter.options.map((option) => ({
            value: option.value,
            label: option.label,
            icon: <FoldKindMark kind={MARKS[option.value]} />,
            tooltip: option.label,
          }))}
          onChange={letter.set}
        />
      </FieldRow>
      <p className={styles.count} data-fold-collapse-count="">
        {controls.count}
      </p>
      <p className={styles.status} role="status" aria-live="polite" data-refused={controls.refused ? '' : undefined}>
        {controls.status ?? ''}
      </p>
    </div>
  );
}
