import { Toggle } from '../Toggle';
import { FieldRow } from './FieldRow';

export function ToggleRow({
  label,
  checked,
  disabled,
  title,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <FieldRow label={label} kind="toggle" disabled={disabled} title={title}>
      <Toggle aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </FieldRow>
  );
}
