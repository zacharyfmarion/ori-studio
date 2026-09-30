import type { ComponentPropsWithRef, ReactNode } from 'react';
import styles from './SegmentedControl.module.css';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';
import { useTouchLabel } from './useTouchLabel';

export interface SegmentedOption<T extends string> {
  value: T;
  /** The option's name: its visible text, or with `iconsOnly` its accessible name. */
  label: string;
  icon?: ReactNode;
  /** The native hover title, when there is no `tooltip`. Defaults to the label. */
  title?: string;
  /**
   * The app's tooltip rather than the native title, for an option whose icon
   * does not say enough on its own. A finger asks for it by pressing and
   * holding, which does not also choose the option.
   */
  tooltip?: ReactNode;
  /**
   * This option alone refuses a choice. It stays focusable and keeps its
   * tooltip, which is where it can say why.
   */
  disabled?: boolean;
}

/** The shared control scale's outer heights: 28, 32 and 36px. */
export type SegmentedControlSize = 'sm' | 'md' | 'lg';

type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

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
  /**
   * Draw each option's icon alone, its label becoming the accessible name — for
   * icons that say it all, like the line types' letters.
   */
  iconsOnly?: boolean;
  /** Which side of an option its tooltip opens on. */
  tooltipSide?: TooltipSide;
  'aria-label'?: string;
}

/**
 * One choice among a few, as a padded track of pills.
 *
 * Its look is its own (`SegmentedControl.module.css`): a screen that wants it
 * different asks through a prop, never with CSS of its own
 * (`docs/styling.md`).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  size = 'md',
  fill = false,
  iconsOnly = false,
  tooltipSide = 'top',
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
        const props = { option, active: option.value === value, disabled, iconsOnly, onChange };
        return option.tooltip ? (
          <TooltipOption key={option.value} {...props} side={tooltipSide} />
        ) : (
          <OptionButton key={option.value} {...props} />
        );
      })}
    </div>
  );
}

interface OptionProps<T extends string> {
  option: SegmentedOption<T>;
  active: boolean;
  /** The whole control's `disabled`: inert, and out of the tab order. */
  disabled: boolean;
  iconsOnly: boolean;
  onChange: (value: T) => void;
}

/**
 * One pill. Anything else it is given — a tooltip trigger's ref, pointer
 * handlers and state — lands on the button, and a given `onClick` runs before
 * its own, so Radix's trigger (`asChild`) keeps working through it.
 */
function OptionButton<T extends string>({
  option,
  active,
  disabled,
  iconsOnly,
  onChange,
  consumeClick,
  onClick,
  ...trigger
}: OptionProps<T> &
  Omit<ComponentPropsWithRef<'button'>, 'onChange'> & {
    /** True for the click that ends a hold: it named the option and chooses nothing. */
    consumeClick?: () => boolean;
  }) {
  return (
    <button
      {...trigger}
      type="button"
      title={option.tooltip ? undefined : (option.title ?? option.label)}
      aria-label={iconsOnly ? option.label : undefined}
      aria-pressed={active}
      aria-disabled={option.disabled || undefined}
      data-active={active || undefined}
      disabled={disabled}
      className={styles.option}
      onClick={(event) => {
        onClick?.(event);
        if (consumeClick?.()) return;
        if (option.disabled) return;
        onChange(option.value);
      }}
    >
      {option.icon}
      {!iconsOnly && <span>{option.label}</span>}
    </button>
  );
}

function TooltipOption<T extends string>({
  side,
  ...props
}: OptionProps<T> & { side: TooltipSide }) {
  const hold = useTouchLabel();
  return (
    <Tooltip open={hold.open}>
      <TooltipTrigger asChild>
        <OptionButton {...props} {...hold.handlers} consumeClick={hold.consumeClick} />
      </TooltipTrigger>
      <TooltipContent side={side}>{props.option.tooltip}</TooltipContent>
    </Tooltip>
  );
}
