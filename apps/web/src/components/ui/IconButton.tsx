import { forwardRef, type ButtonHTMLAttributes } from 'react';
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
