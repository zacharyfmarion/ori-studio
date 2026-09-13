import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CONTROL_RADIUS_CLASS, CONTROL_SIZE_CLASSES } from './controlStyles';

/**
 * The button's classes, for an element that has to be something other than a `<button>`
 * or an `<a>` — a react-router `Link`, which renders its own anchor. Exported as the class
 * builder rather than as another wrapper so the site's call to action wears exactly what a
 * `ButtonLink` wears, and cannot drift from it the way a hand-written class list would.
 */
export const buttonClassName = cva(['ui-button', CONTROL_RADIUS_CLASS].join(' '), {
  variants: {
    variant: {
      primary: 'ui-button--primary',
      secondary: 'ui-button--secondary',
      danger: 'ui-button--danger',
      ghost: 'ui-button--ghost',
    },
    size: CONTROL_SIZE_CLASSES,
  },
  defaultVariants: {
    variant: 'secondary',
    size: 'md',
  },
});

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonClassName> {
  isActive?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, isActive, className = '', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={buttonClassName({ variant, size, className })}
      data-active={isActive || undefined}
      {...props}
    />
  )
);

Button.displayName = 'Button';

export interface ButtonLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof buttonClassName> {}

/**
 * A link that acts as a button, wearing the button's own classes.
 *
 * An anchor rather than a `Button` that calls `window.open`, because everything
 * a link gives you — open in a new tab, copy the address, see where it goes —
 * comes from it actually being one. It exists so that "looks like a button" is
 * not re-derived per surface: hand-rolled copies drift, and the one this
 * replaced had picked up a different radius and font size from the buttons it
 * sat beside.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ variant, size, className = '', ...props }, ref) => (
    <a ref={ref} className={buttonClassName({ variant, size, className })} {...props} />
  )
);

ButtonLink.displayName = 'ButtonLink';
