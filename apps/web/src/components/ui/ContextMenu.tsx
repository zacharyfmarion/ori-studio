import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { createPortal } from 'react-dom';
import type { ContextMenuItem } from './contextMenuTypes';

interface ContextMenuProps {
  open: boolean;
  /** Viewport x coordinate to anchor the menu at (CSS px). */
  x: number;
  /** Viewport y coordinate to anchor the menu at (CSS px). */
  y: number;
  items: ContextMenuItem[];
  onOpenChange: (open: boolean) => void;
}

/**
 * A cursor-anchored context menu built on a **controlled** Radix DropdownMenu.
 *
 * We drive `open` ourselves (rather than using `@radix-ui/react-context-menu`,
 * whose trigger opens on the native `contextmenu` event) so the surface raising
 * the menu keeps full control over when it appears — e.g. the crease-pattern
 * canvas opens it only on a right-*click*, leaving right-*drag* as its erase
 * gesture. Radix supplies the accessibility: focus trap/return, roving focus,
 * typeahead, arrow-key nav, Escape, and viewport collision handling.
 *
 * The menu anchors to an invisible zero-size trigger positioned at the cursor.
 * That anchor is portaled to `document.body` on purpose: `position: fixed` is
 * only viewport-relative when no ancestor establishes a containing block, and
 * callers render this inside laid-out, transformed, or `will-change`-promoted
 * containers (the CP viewport is a centring grid; Dockview panels are
 * transformed). Left in place, the anchor drifts to its container's origin — or
 * gets centred by the grid — instead of sitting under the cursor. Portaling to
 * body makes `x`/`y` unambiguously viewport coordinates. React portals preserve
 * context, so Radix still wires the trigger to the menu.
 */
export function ContextMenu({ open, x, y, items, onOpenChange }: ContextMenuProps) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      {createPortal(
        <DropdownMenu.Trigger asChild>
          <span
            aria-hidden
            data-context-menu-anchor=""
            style={{
              position: 'fixed',
              left: x,
              top: y,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenu.Trigger>,
        document.body
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          loop
        >
          {items.map((item, index) =>
            item.kind === 'separator' ? (
              <DropdownMenu.Separator
                key={`separator-${index}`}
                className="context-menu__separator"
              />
            ) : (
              <DropdownMenu.Item
                key={item.id}
                className="context-menu__item"
                data-danger={item.danger || undefined}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.icon != null && <span className="context-menu__icon">{item.icon}</span>}
                <span className="context-menu__label">{item.label}</span>
                {item.shortcut != null && (
                  <span className="context-menu__shortcut">{item.shortcut}</span>
                )}
              </DropdownMenu.Item>
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
