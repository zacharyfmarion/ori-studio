import * as RadixSelect from '@radix-ui/react-select';
import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties } from 'react';
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
  Omit<ComponentPropsWithoutRef<typeof RadixSelect.Content>, 'className'> & {
    /**
     * How tall the list may grow: `capped`, the default, scrolls past 220px;
     * `available` takes the room the window has beside the trigger, for a
     * short list whose last option must be seen without a scroll — a colour
     * list ending in Custom… (`DiagramColorSelect`).
     */
    fit?: 'capped' | 'available';
    /**
     * The widest the list may grow, in CSS px: a list whose options carry a
     * description line wraps it there rather than stretching across the
     * window (`SelectRow` caps it at its row). Unset, it grows to its widest option.
     */
    maxWidth?: number;
  }
>(({ children, fit = 'capped', maxWidth, style, ...props }, ref) => (
  <RadixSelect.Portal>
    <RadixSelect.Content
      ref={ref}
      className={styles.content}
      data-fit={fit}
      data-capped={maxWidth === undefined ? undefined : ''}
      position="popper"
      sideOffset={4}
      style={maxWidth === undefined ? style : ({ ...style, '--select-max-width': `${maxWidth}px` } as CSSProperties)}
      {...props}
    >
      <RadixSelect.Viewport className={styles.viewport}>{children}</RadixSelect.Viewport>
    </RadixSelect.Content>
  </RadixSelect.Portal>
));

SelectContent.displayName = 'SelectContent';

export const SelectItem = forwardRef<
  HTMLDivElement,
  Omit<ComponentPropsWithoutRef<typeof RadixSelect.Item>, 'className'> & {
    /**
     * A line under the option in the list, never in the trigger: why a
     * disabled option is offered as no choice, say.
     */
    description?: string;
  }
>(({ children, description, ...props }, ref) => (
  <RadixSelect.Item ref={ref} className={styles.item} {...props}>
    <span className={styles.indicator} aria-hidden>
      <RadixSelect.ItemIndicator>
        <Check size={12} />
      </RadixSelect.ItemIndicator>
    </span>
    {description ? (
      <span className={styles.described}>
        <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
        {/* At most two lines, the rest behind an ellipsis: the whole of it in the tooltip. */}
        <span className={styles.description} title={description}>
          {description}
        </span>
      </span>
    ) : (
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    )}
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
