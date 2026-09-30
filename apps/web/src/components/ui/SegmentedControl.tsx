import type { ReactNode } from 'react';
import styles from './SegmentedControl.module.css';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  title?: string;
}

/** The shared control scale's outer heights: 28, 32 and 36px. */
export type SegmentedControlSize = 'sm' | 'md' | 'lg';

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  /** `null` marks no option active — a mixed value across a multi-block selection. */
  value: T | null;
  onChange: (value: T) => void;
  /** Greys out every option and refuses clicks — the control is still readable. */
  disabled?: boolean;
  /**
   * The track's height on the shared control scale, so it lines up with a
   * button or an input beside it: `sm` in dense panels and rows, `md` (the
   * default) in dialogs, `lg` for a control that heads what it switches.
   */
  size?: SegmentedControlSize;
  /**
   * Stretch to the container: each option takes its label's width and an equal
   * share of the rest. Otherwise the control hugs its options, which is what it
   * should do almost everywhere.
   */
  fill?: boolean;
  'aria-label'?: string;
}

/**
 * One choice among a few, as a padded track of pills.
 *
 * Its look is its own (`SegmentedControl.module.css`): a screen that wants it
 * different asks through `size` or `fill`, never with CSS of its own
 * (`docs/styling.md`).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  size = 'md',
  fill = false,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={styles.track}
      data-size={size}
      data-fill={fill || undefined}
      role="group"
      aria-label={ariaLabel}
    >
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
            className={styles.option}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
