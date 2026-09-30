import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useOptimistic,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { observeResizeDeferred } from './observeResizeDeferred';
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
  const trackRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  // A choice shows at once, rather than when the owner's re-render lands: the
  // context panel's re-renders the whole crease-pattern panel, and the pill
  // used to wait ~100ms (in development) before it moved. The owner's update
  // runs as a transition, and if it keeps the old value, the pill goes back.
  const [shownValue, showValue] = useOptimistic(value);
  const choose = (next: T) =>
    startTransition(() => {
      showValue(next);
      onChange(next);
    });
  const activeIndex = options.findIndex((option) => option.value === shownValue);
  useActiveIndicator(
    trackRef,
    indicatorRef,
    activeIndex,
    // What moves the options without a new choice: their labels, and the size.
    `${size} ${fill} ${iconsOnly} ${options.map((option) => option.label).join('\u0000')}`
  );
  return (
    <div
      ref={trackRef}
      className={styles.track}
      data-size={size}
      data-fill={fill || undefined}
      data-refused={disabled || options[activeIndex]?.disabled || undefined}
      role="group"
      aria-label={ariaLabel}
    >
      <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
      {options.map((option) => {
        const props = {
          option,
          active: option.value === shownValue,
          disabled,
          iconsOnly,
          onChange: choose,
        };
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

/**
 * Keeps the indicator — the chosen pill's background — over the chosen option.
 *
 * A new choice slides it there. Anything else that moves the options (new
 * labels, a new size, the container resizing or first being laid out) puts it
 * there at once: sliding after a layout change would read as the choice
 * changing when it has not. With nothing chosen, or the options not laid out
 * yet, the indicator hides, and the next placement is a jump rather than a
 * slide from wherever it last was.
 *
 * Positioned from the option's offsets, which are relative to the track's
 * padding edge — the same edge the indicator's `top: 0; left: 0` is measured
 * from, as the track is its containing block.
 */
function useActiveIndicator(
  trackRef: RefObject<HTMLDivElement | null>,
  indicatorRef: RefObject<HTMLSpanElement | null>,
  activeIndex: number,
  layoutKey: string
) {
  /** Whether the indicator is showing somewhere it can slide from. */
  const shownRef = useRef(false);
  const lastIndexRef = useRef(activeIndex);

  const place = useCallback(
    (slide: boolean) => {
      const indicator = indicatorRef.current;
      const active = trackRef.current?.querySelector<HTMLElement>(':scope > [data-active]');
      if (!indicator) return;
      if (!active || active.offsetWidth === 0) {
        delete indicator.dataset.shown;
        shownRef.current = false;
        return;
      }
      const jump = !(slide && shownRef.current);
      if (jump) indicator.style.transition = 'none';
      indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.height = `${active.offsetHeight}px`;
      indicator.dataset.shown = '';
      if (jump) {
        // Commit the jump before the transition comes back, or it slides anyway.
        void indicator.offsetWidth;
        indicator.style.transition = '';
      }
      shownRef.current = true;
    },
    [indicatorRef, trackRef]
  );

  useLayoutEffect(() => {
    const chose = lastIndexRef.current !== activeIndex;
    lastIndexRef.current = activeIndex;
    place(chose);
  }, [activeIndex, layoutKey, place]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    // The options as well as the track: a filled track keeps its width while
    // its options' widths change under it, as they do when a font arrives.
    const stops = [track, ...track.querySelectorAll(':scope > button')].map((element) =>
      observeResizeDeferred(element, () => place(false))
    );
    return () => stops.forEach((stop) => stop());
  }, [layoutKey, place, trackRef]);
}
