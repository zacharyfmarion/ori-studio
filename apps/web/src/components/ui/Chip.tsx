import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CHIP_SIZE_CLASSES } from './controlStyles';

const chip = cva('ui-chip', {
  variants: { size: CHIP_SIZE_CLASSES },
  // The dense in-panel row, which is where every chip was before this existed.
  defaultVariants: { size: 'sm' },
});

export interface ChipProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chip> {}

/**
 * A pill-shaped quick pick: a short value you set in one press.
 *
 * Three groups had a private copy of this — the fold-angle presets, the
 * fold-direction options, and the crease-angle popover — which is what made
 * "make the popover's chips bigger" a question about a component rather than
 * about one rule in a stylesheet.
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
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  ({ size, className, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={chip({ size, className })} {...props} />
  )
);

Chip.displayName = 'Chip';
