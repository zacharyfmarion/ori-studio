import type { ReactNode } from 'react';
import { CONTROL_RADIUS_CLASS } from './controlStyles';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  title?: string;
  /** Show the icon alone; the label stays the accessible name and the tooltip. */
  iconOnly?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  /** `null` marks no option active — a mixed value across a multi-block selection. */
  value: T | null;
  onChange: (value: T) => void;
  /** Greys out every option and refuses clicks — the control is still readable. */
  disabled?: boolean;
  'aria-label'?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className={`segmented ${CONTROL_RADIUS_CLASS}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title ?? option.label}
            aria-pressed={active}
            data-active={active || undefined}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className="segmented__option"
            aria-label={option.iconOnly ? option.label : undefined}
          >
            {option.icon}
            {!option.iconOnly && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
