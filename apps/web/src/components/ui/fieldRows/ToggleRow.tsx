import { Toggle } from '../Toggle';
import { FieldRow } from './FieldRow';

export function ToggleRow({
  label,
  help,
  checked,
  disabled,
  nested,
  title,
  onChange,
  onReset,
}: {
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  nested?: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
  onReset?: () => void;
}) {
  return (
    <FieldRow
      label={label}
      help={help}
      kind="toggle"
      disabled={disabled}
      nested={nested}
      title={title}
      onReset={onReset}
    >
      <Toggle aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </FieldRow>
  );
}
