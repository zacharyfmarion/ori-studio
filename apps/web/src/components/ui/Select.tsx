import * as RadixSelect from '@radix-ui/react-select';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CONTROL_RADIUS_CLASS } from './controlStyles';
import styles from './Select.module.css';

export const Select = RadixSelect.Root;
export const SelectValue = RadixSelect.Value;

export const SelectTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixSelect.Trigger>
>(({ children, className = '', ...props }, ref) => (
  <RadixSelect.Trigger
    ref={ref}
    className={`select-trigger ${CONTROL_RADIUS_CLASS} ${className}`.trim()}
    {...props}
  >
    {children}
    <RadixSelect.Icon asChild>
      <ChevronDown size={14} />
    </RadixSelect.Icon>
  </RadixSelect.Trigger>
));

SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = forwardRef<
  HTMLDivElement,
  Omit<ComponentPropsWithoutRef<typeof RadixSelect.Content>, 'className'>
>(({ children, ...props }, ref) => (
  <RadixSelect.Portal>
    <RadixSelect.Content
      ref={ref}
      className={styles.content}
      position="popper"
      sideOffset={4}
      {...props}
    >
      <RadixSelect.Viewport className={styles.viewport}>{children}</RadixSelect.Viewport>
    </RadixSelect.Content>
  </RadixSelect.Portal>
));

SelectContent.displayName = 'SelectContent';

export const SelectItem = forwardRef<
  HTMLDivElement,
  Omit<ComponentPropsWithoutRef<typeof RadixSelect.Item>, 'className'>
>(({ children, ...props }, ref) => (
  <RadixSelect.Item ref={ref} className={styles.item} {...props}>
    <span className={styles.indicator} aria-hidden>
      <RadixSelect.ItemIndicator>
        <Check size={12} />
      </RadixSelect.ItemIndicator>
    </span>
    <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
  </RadixSelect.Item>
));

SelectItem.displayName = 'SelectItem';

/**
 * The colour an option names, as a dot before its label. Put inside the
 * item's children, so the trigger shows it too once the option is chosen.
 */
export function SelectSwatch({ color }: { color: string }) {
  return <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />;
}
