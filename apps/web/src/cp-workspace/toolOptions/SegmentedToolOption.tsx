import { SegmentedControl, type SegmentedOption } from '../../components/ui/SegmentedControl';

/**
 * A tool option that picks one of a few values: a segmented control on the
 * context panel's label-left / control-right row, the row every tool option
 * shares.
 *
 * A bare full-width control reads as a mode switch for the whole group rather
 * than as one option among several, and a label above it spends a second line
 * saying what the row beside it says in one. Sharing the field grid puts every
 * option on one column and makes the answer to "what does this choose?" the
 * text beside it. The control fills the column, as the numeric fields do, so
 * the two line up.
 *
 * A `div` rather than the `label` element a numeric field uses: a label points
 * at a single control, and this names a group of buttons. The group carries its
 * own `aria-label`, so the accessible name does not depend on the visible text.
 */
export function SegmentedToolOption<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="cp-context-panel__field">
      <span>{label}</span>
      <SegmentedControl
        fill
        aria-label={ariaLabel}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}
