import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef } from 'react';
import styles from './Tooltip.module.css';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

/** Found by `role="tooltip"`, which Radix gives a hidden copy of its text. */
export function TooltipContent({
  side = 'top',
  sideOffset = 6,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof RadixTooltip.Content>, 'className'>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        side={side}
        sideOffset={sideOffset}
        className={styles.content}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}
