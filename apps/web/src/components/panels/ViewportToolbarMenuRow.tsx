import { Check } from 'lucide-react';
import {
  MenuCheckboxItem,
  MenuItem,
  MenuItemIcon,
  MenuItemLabel,
} from '../ui/Menu';
import type { ViewportToolbarAction } from './viewportToolbarLayout';

/**
 * One of the viewport toolbar's controls as a menu row: in the touch `⋯` menu,
 * where the bar's controls collapse, and in the layers menu on a pointer
 * device. One row for both, so a layer toggle looks and behaves the same
 * whichever of them it is in.
 *
 * A mode is a checkbox row and a verb a plain one; see
 * {@link ViewportToolbarAction} for why an action is never both.
 */
export function ViewportToolbarMenuRow({
  action,
  onOpenDialog,
}: {
  action: ViewportToolbarAction;
  /** Told before the select runs, so the close that follows keeps its hands off focus. */
  onOpenDialog?: () => void;
}) {
  if (action.checked === undefined) {
    return (
      <MenuItem
        disabled={action.disabled}
        onSelect={() => {
          if (action.opensDialog) onOpenDialog?.();
          action.onSelect();
        }}
      >
        <MenuItemIcon>{action.icon}</MenuItemIcon>
        <MenuItemLabel>{action.label}</MenuItemLabel>
      </MenuItem>
    );
  }

  return (
    <MenuCheckboxItem
      checked={action.checked}
      disabled={action.disabled}
      // A verb closes the menu; a mode does not. Radix closes on select unless
      // the event is canceled, and the modes here arrive in runs — the packing
      // pane has twelve layer toggles, and closing after each one would cost
      // twelve reopenings to set three of them.
      onSelect={(event) => {
        event.preventDefault();
        action.onSelect();
      }}
    >
      {/* A tick while on and nothing while off, as `ContextMenu` draws a checked
          item. The mode's own icon in the off slot read as a mark of its own. */}
      <MenuItemIcon>{action.checked && <Check size={12} />}</MenuItemIcon>
      <MenuItemLabel>{action.label}</MenuItemLabel>
    </MenuCheckboxItem>
  );
}
