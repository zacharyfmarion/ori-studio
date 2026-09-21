import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ContextMenuColorItem } from './ContextMenuColorItem';
import { MenuPickerProvider, hoverFocusProps, useMenuPicker } from './contextMenuPicker';
import type { ContextMenuItem } from './contextMenuTypes';

/** Whether a row draws something in the leading column: an icon, or a check. */
function drawsLeadingSlot(item: ContextMenuItem): boolean {
  switch (item.kind) {
    case 'action':
    case 'submenu':
      return item.icon != null;
    case 'radio':
    case 'checkbox':
    case 'color':
      return true;
    case 'separator':
      return false;
  }
}

/**
 * Render one menu entry. Recursive, so a `submenu` nests arbitrarily deep;
 * Radix's `Sub` primitives carry the nested keyboard navigation and collision
 * handling that `Content` already provides at the top level.
 *
 * `key` is supplied by the caller: only separators lack a stable id, so they
 * fall back to their index. `reserveLeading` says whether a row with nothing to
 * draw in the leading column keeps the column anyway — see
 * {@link ContextMenuItems}. `hover` is what every row does about focus on
 * hover, decided once per list — see {@link hoverFocusProps}.
 */
function renderItem(
  item: ContextMenuItem,
  index: number,
  reserveLeading: boolean,
  hover: ReturnType<typeof hoverFocusProps>
): React.ReactNode {
  switch (item.kind) {
    case 'separator':
      return (
        <DropdownMenu.Separator key={`separator-${index}`} className="context-menu__separator" />
      );
    case 'submenu':
      return (
        <DropdownMenu.Sub key={item.id}>
          <DropdownMenu.SubTrigger
            className="context-menu__item"
            disabled={item.disabled}
            title={item.hint}
            {...hover}
          >
            {(item.icon != null || reserveLeading) && (
              <span className="context-menu__icon">{item.icon}</span>
            )}
            <span className="context-menu__label">{item.label}</span>
            <span className="context-menu__subtrigger-arrow" aria-hidden>
              <ChevronRight size={12} />
            </span>
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent className="context-menu" sideOffset={2} collisionPadding={8}>
              <ContextMenuRows items={item.items} />
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      );
    case 'radio':
      // Rendered as a plain item carrying its own checked state rather than a
      // Radix RadioGroup: the caller owns the set (each option knows whether it
      // is current), and a group would need a single value binding that the
      // generic item list deliberately does not model.
      return (
        <DropdownMenu.Item
          key={item.id}
          className="context-menu__item"
          disabled={item.disabled}
          {...hover}
          onSelect={(event) => {
            if (item.keepOpen) event.preventDefault();
            item.onSelect();
          }}
        >
          <span className="context-menu__icon">{item.checked && <Check size={12} />}</span>
          <span className="context-menu__label">{item.label}</span>
        </DropdownMenu.Item>
      );
    case 'checkbox':
      return (
        <DropdownMenu.CheckboxItem
          key={item.id}
          className="context-menu__item"
          checked={item.checked}
          disabled={item.disabled}
          title={item.hint}
          {...hover}
          onSelect={(event) => {
            if (item.keepOpen) event.preventDefault();
            item.onToggle();
          }}
        >
          <span className="context-menu__icon">{item.checked && <Check size={12} />}</span>
          <span className="context-menu__label">{item.label}</span>
        </DropdownMenu.CheckboxItem>
      );
    case 'color':
      return <ContextMenuColorItem key={item.id} item={item} />;
    case 'action':
      return (
        <DropdownMenu.Item
          key={item.id}
          className="context-menu__item"
          data-danger={item.danger || undefined}
          disabled={item.disabled}
          // Radix renders a `div`, not a native control, so a disabled row still
          // receives hover — which is what makes this reachable on exactly the
          // rows that most need it.
          title={item.hint}
          {...hover}
          onSelect={item.onSelect}
        >
          {(item.icon != null || reserveLeading) && (
            <span className="context-menu__icon">{item.icon}</span>
          )}
          <span className="context-menu__label">{item.label}</span>
          {item.shortcut != null && (
            <span className="context-menu__shortcut">{item.shortcut}</span>
          )}
        </DropdownMenu.Item>
      );
  }
}

/**
 * One list's rows.
 *
 * Labels line up in one column per list: a row with no icon still reserves the
 * leading slot when any sibling draws in it, so a glyph-less "Side" sits under
 * "Render as" rather than flush left of it. A list where nothing draws there
 * keeps its labels at the edge, as every menu without icons always has.
 */
function ContextMenuRows({ items }: { items: ContextMenuItem[] }) {
  const reserveLeading = items.some(drawsLeadingSlot);
  const hover = hoverFocusProps(useMenuPicker());
  return items.map((item, index) => renderItem(item, index, reserveLeading, hover));
}

/**
 * A list of entries, rendered into whatever `DropdownMenu.Content` they sit in.
 *
 * Exported so a toolbar dropdown can show the same rows a context menu does,
 * from the same descriptors — a colour row or a check row written once, not
 * once per surface. Every submenu below shares this menu's picker state, so a
 * colour row's open picker holds the whole tree still — see
 * {@link MenuPickerProvider}.
 */
export function ContextMenuItems({ items }: { items: ContextMenuItem[] }) {
  return (
    <MenuPickerProvider>
      <ContextMenuRows items={items} />
    </MenuPickerProvider>
  );
}

interface ContextMenuProps {
  open: boolean;
  /** Viewport x coordinate to anchor the menu at (CSS px). */
  x: number;
  /** Viewport y coordinate to anchor the menu at (CSS px). */
  y: number;
  items: ContextMenuItem[];
  onOpenChange: (open: boolean) => void;
  /**
   * Fires once the menu has closed and is about to hand focus back to whatever
   * held it before. Call `preventDefault()` to keep that from happening — which
   * an action that moves focus itself (starting an inline edit, opening a
   * dialog) must do, or the menu's focus trap yanks focus back out from under
   * it. Leave it unset for the default, correct behaviour.
   */
  onCloseAutoFocus?: (event: Event) => void;
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
export function ContextMenu({
  open,
  x,
  y,
  items,
  onOpenChange,
  onCloseAutoFocus,
}: ContextMenuProps) {
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
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <ContextMenuItems items={items} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
