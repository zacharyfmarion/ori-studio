import { ColorField } from '../ColorField';

/**
 * A colour swatch in a row — `ColorField`'s `row` layout already is one, so
 * this is the kit's name for it rather than a second implementation.
 * `onChange` fires per pointer move while the picker is open; `onCommit` once
 * on blur, which is the caller's commit point for one undo entry per pick.
 */
export function ColorRow({
  label,
  value,
  disabled,
  title,
  onChange,
  onCommit,
  onClear,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  /** Why the row is disabled, shown on hover. */
  title?: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  onClear?: () => void;
}) {
  return (
    <ColorField
      label={label}
      layout="row"
      value={value}
      disabled={disabled}
      title={title}
      onChange={onChange}
      onCommit={onCommit}
      onClear={onClear}
    />
  );
}
