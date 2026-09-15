import type { ReactNode } from 'react';
import { SegmentedControl } from '../SegmentedControl';
import { FieldRow } from './FieldRow';

export interface SegmentedRowOption {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Show the icon alone; the label stays the accessible name and the tooltip. */
  iconOnly?: boolean;
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
  onReset,
}: {
  label: string;
  value: string | null;
  options: readonly SegmentedRowOption[];
  disabled?: boolean;
  title?: string;
  onChange: (value: string) => void;
  onReset?: () => void;
}) {
  return (
    <FieldRow label={label} kind="segmented" disabled={disabled} title={title} onReset={onReset}>
      <SegmentedControl
        aria-label={label}
        options={options.map((option) => ({
          value: option.id,
          label: option.label,
          icon: option.icon,
          iconOnly: option.iconOnly,
        }))}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </FieldRow>
  );
}
