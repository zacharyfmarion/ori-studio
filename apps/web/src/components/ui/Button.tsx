import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CONTROL_RADIUS_CLASS, CONTROL_SIZE_CLASSES } from './controlStyles';

const button = cva(['ui-button', CONTROL_RADIUS_CLASS].join(' '), {
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
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  isActive?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, isActive, className = '', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={button({ variant, size, className })}
      data-active={isActive || undefined}
      {...props}
    />
  ),
);

Button.displayName = 'Button';

export interface ButtonLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>, VariantProps<typeof button> {}

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
    <a ref={ref} className={button({ variant, size, className })} {...props} />
  ),
);

ButtonLink.displayName = 'ButtonLink';
