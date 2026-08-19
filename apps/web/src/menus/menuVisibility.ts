import type { MenuDef, MenuItemDef } from './menuDefinition';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../lib/workspaceCapabilities';

/**
 * Shared visibility/pruning logic for the application menu. Both the web
 * {@link MenuBar} and the native macOS menu builder consume these so the two
 * surfaces mask the same items in the same context — the single source of truth
 * for *which* menu entries appear is `menuDefinition.ts`, and this is the single
 * source of truth for *when* each entry appears.
 */
export function isMenuItemVisible(item: MenuItemDef, capabilities: WorkspaceCapabilities): boolean {
  if (item.type === 'separator') return true;
  if (item.type === 'command') return true;
  if (item.type === 'submenu') {
    return item.items.some(
      (child) => child.type !== 'separator' && isMenuItemVisible(child, capabilities),
    );
  }

  const capability = capabilities[item.id as WorkspaceCapabilityId];
  return !(capability && !capability.visible);
}

/**
 * Whether a top-level menu has any non-separator item that is visible in the
 * current context. Lets the bar drop menus that are entirely hidden — e.g. the
 * Design and Crease Pattern menus while authoring a Box-Pleat design.
 */
export function menuHasVisibleItems(menu: MenuDef, capabilities: WorkspaceCapabilities): boolean {
  return menu.items.some(
    (item) => item.type !== 'separator' && isMenuItemVisible(item, capabilities),
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
  capabilities: WorkspaceCapabilities,
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
