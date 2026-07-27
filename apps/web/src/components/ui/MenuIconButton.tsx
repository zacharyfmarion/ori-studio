import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { IconButton } from './IconButton';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

/**
 * An icon button that opens a dropdown menu **and** shows a tooltip.
 *
 * Passing `title` to {@link IconButton} normally gives the tooltip for free, but
 * that makes the button its own `TooltipTrigger asChild` — and a dropdown needs
 * it to be a `DropdownMenu.Trigger asChild` as well. Two `asChild` wrappers
 * cannot each clone the same element from the outside, so a menu button used to
 * end up with an `aria-label` and no tooltip at all.
 *
 * The fix is to nest the triggers rather than have them compete: the tooltip
 * trigger clones the dropdown trigger, which clones the button, and both sets of
 * props merge down. Given how easy the plain approach is to reach for, this
 * lives as a primitive so the workaround is written once.
 */
export function MenuIconButton({
  label,
  icon,
  disabled,
  size = 'sm',
  variant = 'toolbar',
  tooltipSide,
}: {
  /** Accessible name and tooltip text — a menu button has no other label. */
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  variant?: 'default' | 'toolbar';
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenu.Trigger asChild>
          {/* No `title` here: that is what would re-introduce the competing
              tooltip trigger this component exists to avoid. */}
          <IconButton size={size} variant={variant} aria-label={label} disabled={disabled}>
            {icon}
          </IconButton>
        </DropdownMenu.Trigger>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}
