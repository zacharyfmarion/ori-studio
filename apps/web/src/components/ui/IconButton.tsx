import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';
import { useTouchLabel } from './useTouchLabel';
import { CONTROL_RADIUS_CLASS, ICON_CONTROL_SIZE_CLASSES } from './controlStyles';

const iconButton = cva(
  ['ui-button', 'ui-button--icon', CONTROL_RADIUS_CLASS].join(' '),
  {
    variants: {
      variant: {
        default: 'ui-button--ghost',
        toolbar: 'ui-button--secondary',
      },
      size: ICON_CONTROL_SIZE_CLASSES,
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButton> {
  isActive?: boolean;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      variant,
      size,
      isActive,
      className = '',
      type = 'button',
      title,
      tooltipSide,
      'aria-label': ariaLabel,
      disabled,
      onClick,
      ...props
    },
    ref
  ) => {
    const accessibleLabel = ariaLabel ?? (typeof title === 'string' ? title : undefined);
    // Every icon-only control in the app is one of these, so the touch path for
    // reading a label lives here rather than at each toolbar that has one.
    const hold = useTouchLabel();
    const button = (
      <button
        ref={ref}
        type={type}
        className={iconButton({ variant, size, className })}
        data-active={isActive || undefined}
        aria-label={accessibleLabel}
        disabled={disabled}
        onClick={(event) => {
          // The press that summoned the label is not also an activation.
          if (hold.consumeClick()) return;
          onClick?.(event);
        }}
        {...(title && !disabled ? hold.handlers : null)}
        {...props}
      />
    );

    if (!title) return button;
    // A disabled button receives no pointer events at all, which is why the
    // wrapper exists for hover in the first place — so the hold goes on whatever
    // ends up being the trigger. A disabled control's label is worth as much as
    // any other, often more: "why can I not press this" is the question.
    const trigger = disabled ? (
      <span className="ui-button-tooltip-trigger" data-disabled="true" {...hold.handlers}>
        {button}
      </span>
    ) : (
      button
    );

    return (
      <Tooltip open={hold.open}>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side={tooltipSide}>{title}</TooltipContent>
      </Tooltip>
    );
  }
);

IconButton.displayName = 'IconButton';

export interface IconButtonLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof iconButton> {
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * An icon-only link wearing {@link IconButton}'s shape — the `ButtonLink` of the
 * icon controls, and made for the same reason.
 *
 * An anchor rather than a button that calls `window.open`: opening in a new tab,
 * copying the address and seeing the destination before you commit all come from
 * the control actually being a link, and an icon that leaves the app is exactly
 * where somebody wants to know where it goes first.
 *
 * `title` is the tooltip *and* the accessible name, as on {@link IconButton} —
 * an icon has no other text. There is no disabled branch, because a disabled
 * link is not a thing: what an anchor cannot do it simply does not offer.
 */
export const IconButtonLink = forwardRef<HTMLAnchorElement, IconButtonLinkProps>(
  (
    {
      variant,
      size,
      className = '',
      title,
      tooltipSide,
      'aria-label': ariaLabel,
      onClick,
      ...props
    },
    ref
  ) => {
    const accessibleLabel = ariaLabel ?? (typeof title === 'string' ? title : undefined);
    const hold = useTouchLabel();
    const link = (
      <a
        ref={ref}
        className={iconButton({ variant, size, className })}
        aria-label={accessibleLabel}
        onClick={(event) => {
          // The press that summoned the label is not also an activation — and on
          // an anchor that takes a `preventDefault` as well, since the thing to
          // suppress is the browser's own navigation rather than a handler.
          if (hold.consumeClick()) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        {...(title ? hold.handlers : null)}
        {...props}
      />
    );

    if (!title) return link;

    return (
      <Tooltip open={hold.open}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side={tooltipSide}>{title}</TooltipContent>
      </Tooltip>
    );
  }
);

IconButtonLink.displayName = 'IconButtonLink';
