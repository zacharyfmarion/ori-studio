import { forwardRef, type ButtonHTMLAttributes } from 'react';
import styles from './Chip.module.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `md`, the default: a row of quick picks in a panel — the tool window's
   * groups and the crease-angle popover — as tall as the app's fields.
   *
   * `sm`: a header row, beside pills of the same height and weight — Settings
   * → Paper's Update and Revert, next to the pill naming the preset.
   */
  size?: 'sm' | 'md';
}

/**
 * A pill-shaped quick pick: a short value you set in one press.
 *
 * Three groups had a private copy of this — the fold-angle presets, the
 * fold-direction options, and the crease-angle popover — so a chip's look is
 * one component's, not three rules that agree by accident.
 *
 * # Selection is the caller's word, not a prop
 *
 * Styled on `aria-pressed`, which the caller sets, rather than a `selected`
 * prop of our own. A chip is not always a toggle: the fold-angle group's
 * "Unassigned" and the measure actions are verbs that run and are never *the*
 * current one, and they legitimately carry no pressed state at all. A `selected`
 * prop would either force those to say `selected={false}` — which announces a
 * choice that is off, not an action — or quietly diverge from the ARIA the
 * screen reader actually reads. One fact, one place to state it.
 *
 * A `className` is for placing the chip; how it looks is a `size`.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  ({ size = 'md', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={className ? `${styles.chip} ${className}` : styles.chip}
      data-size={size}
      {...props}
    />
  )
);

Chip.displayName = 'Chip';
