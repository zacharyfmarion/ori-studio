import type { ReactNode } from 'react';
import { SegmentedControl } from '../SegmentedControl';
import { FieldRow } from './FieldRow';

export interface SegmentedRowOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

/**
 * A segmented control in a row. Hugs its options rather than stretching — a
 * stretched two-option control reads as a half-filled progress bar. `value:
 * null` renders no active option: the mixed state.
 */
export function SegmentedRow({
  label,
  value,
  options,
  disabled,
  title,
  onChange,
}: {
  label: string;
  value: string | null;
  options: readonly SegmentedRowOption[];
  disabled?: boolean;
  title?: string;
  onChange: (value: string) => void;
}) {
  return (
    <FieldRow label={label} kind="segmented" disabled={disabled} title={title}>
      <SegmentedControl
        aria-label={label}
        options={options.map((option) => ({
          value: option.id,
          label: option.label,
          icon: option.icon,
        }))}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </FieldRow>
  );
}
