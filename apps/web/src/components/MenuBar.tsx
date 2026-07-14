import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { handleMenuAction } from '../commands/menuActions';
import { getMenuBarDef, type MenuDef, type MenuItemDef } from '../menus/menuDefinition';
import { useShortcutStore } from '../store/shortcutStore';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import './MenuBar.css';

function isMenuItemVisible(item: MenuItemDef, capabilities: WorkspaceCapabilities): boolean {
  if (item.type === 'separator') return true;
  if (item.type === 'command') return true;
  if (item.type === 'submenu') {
    return item.items.some((child) => child.type !== 'separator' && isMenuItemVisible(child, capabilities));
  }

  const capability = capabilities[item.id as WorkspaceCapabilityId];
  return !(capability && !capability.visible);
}

/**
 * Whether a top-level menu has any non-separator item that is visible in the
 * current context. Lets the bar drop menus that are entirely hidden — e.g. the
 * Design and Crease Pattern menus while authoring a Box-Pleat design.
 */
function menuHasVisibleItems(menu: MenuDef, capabilities: WorkspaceCapabilities): boolean {
  return menu.items.some(
    (item) => item.type !== 'separator' && isMenuItemVisible(item, capabilities)
  );
}

/**
 * Drop the items hidden in the current context, then collapse separators so no
 * leading, trailing, or doubled dividers survive. Without this a menu (or
 * submenu) whose visible items straddle a divider — e.g. an Export submenu that
 * only exposes "Export .bps..." — renders orphaned separator lines around a lone
 * entry.
 */
export function pruneMenuItems(
  items: MenuItemDef[],
  capabilities: WorkspaceCapabilities
): MenuItemDef[] {
  const pruned: MenuItemDef[] = [];
  for (const item of items) {
    if (item.type === 'separator') {
      if (pruned.length > 0 && pruned[pruned.length - 1].type !== 'separator') {
        pruned.push(item);
      }
      continue;
    }
    if (!isMenuItemVisible(item, capabilities)) continue;
    pruned.push(item);
  }
  while (pruned.length > 0 && pruned[pruned.length - 1].type === 'separator') {
    pruned.pop();
  }
  return pruned;
}

function MenuDropdown({
  items,
  onAction,
  onClose,
  capabilities,
  nested = false,
}: {
  items: MenuItemDef[];
  onAction: (id: string) => void;
  onClose: () => void;
  capabilities: WorkspaceCapabilities;
  nested?: boolean;
}) {
  const visibleItems = pruneMenuItems(items, capabilities);
  return (
    <div className={`menu-dropdown ${nested ? 'menu-dropdown--submenu' : ''}`.trim()} role="menu">
      {visibleItems.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`separator-${index}`} className="menu-dropdown__separator" />;
        }

        if (item.type === 'command') {
          return (
            <button
              key={`command-${index}-${item.actionId}`}
              type="button"
              className="menu-dropdown__item"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onAction(item.actionId);
                onClose();
              }}
            >
              <span className="menu-dropdown__item-label">{item.label}</span>
            </button>
          );
        }

        if (item.type === 'submenu') {
          if (!isMenuItemVisible(item, capabilities)) return null;

          return (
            <div key={item.label} className="menu-dropdown__submenu" role="none">
              <button
                type="button"
                className="menu-dropdown__item menu-dropdown__item--submenu"
                role="menuitem"
                aria-haspopup="menu"
                onClick={(event) => event.preventDefault()}
              >
                <span className="menu-dropdown__item-label">{item.label}</span>
                <span className="menu-dropdown__submenu-arrow" aria-hidden="true">
                  <ChevronRight size={13} />
                </span>
              </button>
              <MenuDropdown
                items={item.items}
                onAction={onAction}
                onClose={onClose}
                capabilities={capabilities}
                nested
              />
            </div>
          );
        }

        const capability = capabilities[item.id as WorkspaceCapabilityId];
        if (capability && !capability.visible) return null;

        return (
          <button
            key={item.id}
            type="button"
            className="menu-dropdown__item"
            role="menuitem"
            disabled={capability ? !capability.enabled : false}
            title={capability?.reason}
            onClick={() => {
              if (capability && !capability.enabled) return;
              onAction(item.id);
              onClose();
            }}
          >
            <span className="menu-dropdown__item-label">{capability?.label ?? item.label}</span>
            {item.shortcut && (
              <span className="menu-dropdown__item-shortcut">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shortcutOverrides = useShortcutStore((state) => state.overrides);
  const menuDef = useMemo(
    () => getMenuBarDef(shortcutOverrides),
    [shortcutOverrides]
  );
  const capabilities = useWorkspaceCapabilities();
  const visibleMenus = useMemo<MenuDef[]>(
    () => menuDef.filter((menu) => menuHasVisibleItems(menu, capabilities)),
    [menuDef, capabilities]
  );

  const closeMenu = useCallback(() => {
    setOpenMenu(null);
  }, []);

  const runAction = useCallback((id: string) => {
    void handleMenuAction(id);
  }, []);

  useEffect(() => {
    if (openMenu === null) return undefined;

    const onClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [openMenu]);

  return (
    <div className="menubar" ref={menuRef}>
      <div className="menubar__menus">
        {visibleMenus.map((menu, index) => (
          <div key={menu.label} className="menubar__menu-wrapper">
            <button
              type="button"
              className={`menubar__trigger ${
                openMenu === index ? 'menubar__trigger--active' : ''
              }`}
              aria-haspopup="menu"
              aria-expanded={openMenu === index}
              onClick={() => setOpenMenu(openMenu === index ? null : index)}
              onMouseEnter={() => {
                if (openMenu !== null) setOpenMenu(index);
              }}
            >
              {menu.label}
            </button>
            {openMenu === index && (
              <MenuDropdown
                items={menu.items}
                onAction={runAction}
                onClose={closeMenu}
                capabilities={capabilities}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
