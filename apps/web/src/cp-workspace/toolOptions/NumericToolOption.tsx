/**
 * The numeric field every CP tool param uses.
 *
 * Lifted out of `CpContextToolPanel` when a second file needed it. It is a
 * primitive, not a panel concern — and duplicating a control whose whole reason
 * for existing is a subtle editing rule (below) would guarantee the two copies
 * drift.
 */
import { useEffect, useRef, useState } from 'react';

export function NumericToolOption({
  label,
  ariaLabel,
  min,
  max,
  step,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  min?: number;
  max?: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  // Edit against a local string draft so the field can be cleared or hold a partial
  // value while typing; only parse/clamp/commit on blur or Enter. A controlled
  // number input that committed every keystroke snapped an emptied field back to its
  // old value (and committed intermediate digits, e.g. backspacing "16" → "1").
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => String(value));
  // Re-sync the draft when the committed value changes from outside — but never
  // while the user is mid-edit in this field.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (Number.isFinite(parsed)) {
      const clamped = clampToolNumber(parsed, min, max);
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      // Empty or unparseable: revert to the last committed value.
      setDraft(String(value));
    }
  };

  return (
    <label className="cp-context-panel__field">
      <span>{label}</span>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function clampToolNumber(
  value: number,
  min: number | undefined,
  max: number | undefined
): number {
  const lowerBounded = min === undefined ? value : Math.max(min, value);
  return max === undefined ? lowerBounded : Math.min(max, lowerBounded);
}
