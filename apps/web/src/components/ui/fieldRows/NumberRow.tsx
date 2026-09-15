import { useId } from 'react';
import { NumberField } from '../NumberField';
import { FieldRow } from './FieldRow';

/**
 * A stepper field in a row. Commit semantics are `NumberField`'s: the draft
 * commits on blur, Enter or a step, Escape reverts, and a no-op commit is
 * skipped — which matters because a commit is usually an undo entry.
 */
export function NumberRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  title,
  normalize,
  onCommit,
  onReset,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  title?: string;
  normalize?: (value: number) => number;
  onCommit: (value: number) => void;
  onReset?: () => void;
}) {
  const inputId = useId();
  return (
    <FieldRow
      label={label}
      htmlFor={inputId}
      kind="input"
      disabled={disabled}
      title={title}
      onReset={onReset}
    >
      <NumberField
        id={inputId}
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        suffix={suffix}
        disabled={disabled}
        normalize={normalize}
        onCommit={onCommit}
      />
    </FieldRow>
  );
}
