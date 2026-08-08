import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Button, type ButtonProps } from './Button';

export interface SplitButtonAction {
  /** Stable key, and the analytics-safe identifier for the action. */
  id: string;
  label: string;
  /** Disabled reason, or the action's own tooltip when it is available. */
  title?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A primary button with a caret beside it opening a menu of related actions.
 *
 * The two halves are separate buttons sharing one outline, not a button that
 * happens to contain a menu: clicking the label must run the default action
 * without ever opening the menu, and that is only unambiguous if the caret is
 * its own hit target.
 *
 * Both halves take the disabled state together. A live caret over a dead primary
 * offers a menu whose items are all unavailable, which reads as broken rather
 * than as disabled.
 */
export function SplitButton({
  label,
  icon,
  title,
  actions,
  onClick,
  disabled = false,
  size = 'sm',
  variant = 'primary',
  menuLabel,
}: {
  label: string;
  icon?: ReactNode;
  /** Tooltip for the primary half — its reason when disabled. */
  title?: string;
  /** Extra actions behind the caret. An empty list renders a plain button. */
  actions: readonly SplitButtonAction[];
  onClick: () => void;
  disabled?: boolean;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  /** Accessible name for the caret, e.g. "More send options". */
  menuLabel: string;
}) {
  const primary = (
    <Button
      size={size}
      variant={variant}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={actions.length > 0 ? 'ui-split-button__primary' : undefined}
    >
      {icon}
      {label}
    </Button>
  );

  // Nothing behind the caret means no caret. A menu button that opens an empty
  // menu is worse than the plain button it replaced.
  if (actions.length === 0) return primary;

  return (
    <div className="ui-split-button">
      {primary}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          {/* No `title`: it would compete with the dropdown trigger for the
              element, the same clash `MenuIconButton` documents. */}
          <Button
            size={size}
            variant={variant}
            disabled={disabled}
            aria-label={menuLabel}
            className="ui-split-button__caret"
          >
            <ChevronDown size={14} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="context-menu"
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            loop
          >
            {actions.map((action) => (
              <DropdownMenu.Item
                key={action.id}
                className="context-menu__item"
                disabled={action.disabled}
                title={action.title}
                onSelect={action.onSelect}
              >
                <span className="context-menu__label">{action.label}</span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
