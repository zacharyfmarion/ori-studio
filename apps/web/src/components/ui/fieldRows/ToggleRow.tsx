import { useId } from 'react';
import { Toggle } from '../Toggle';
import { FieldRow } from './FieldRow';

export function ToggleRow({
  label,
  help,
  checked,
  inherited,
  disabled,
  nested,
  title,
  divider,
  onChange,
  onReset,
}: {
  label: string;
  help?: string;
  checked: boolean;
  /**
   * The value the row would show once reset — what it follows while nothing
   * is set. A toggle has no reset button (see `FieldRow`), so while `onReset`
   * is passed, switching to this value runs `onReset` instead of `onChange`:
   * flipping an override back is how it stops being one. Passing it also
   * marks the row as one that can be overridden, which keeps a line for the
   * note whether it is showing or not (`FieldRow.overridable`).
   */
  inherited?: boolean;
  disabled?: boolean;
  nested?: boolean;
  title?: string;
  /** The rule under the row (`FieldRow.divider`). */
  divider?: boolean;
  onChange: (checked: boolean) => void;
  /** Passed while the value is overridden; the row says so under its label. */
  onReset?: () => void;
}) {
  const noteId = useId();
  const change = (next: boolean) => {
    if (onReset && next === inherited) onReset();
    else onChange(next);
  };
  return (
    <FieldRow
      label={label}
      help={help}
      noteId={noteId}
      overridable={inherited !== undefined}
      kind="toggle"
      disabled={disabled}
      nested={nested}
      title={title}
      divider={divider}
      onReset={onReset}
    >
      <Toggle
        aria-label={label}
        aria-describedby={onReset ? noteId : undefined}
        checked={checked}
        disabled={disabled}
        onChange={change}
      />
    </FieldRow>
  );
}
