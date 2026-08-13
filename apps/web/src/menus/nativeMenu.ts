import { Menu } from '@tauri-apps/api/menu';
import type {
  MenuItemOptions,
  PredefinedMenuItemOptions,
  SubmenuOptions,
} from '@tauri-apps/api/menu';
import { getMenuBarDef, type MenuDef, type MenuItemDef, type MenuTranslate } from './menuDefinition';
import { menuHasVisibleItems, pruneMenuItems } from './menuVisibility';
import { handleMenuAction } from '../commands/menuActions';
import {
  getResolvedShortcut,
  type KeyChord,
  type ShortcutActionId,
  type ShortcutResolutionInput,
} from '../keyboard/shortcuts';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../lib/workspaceCapabilities';

/**
 * Builds the native macOS menu from the *same* {@link getMenuBarDef} definition
 * and capability masking as the web {@link MenuBar}. This is the whole point of
 * the module: the OS menu bar and the in-canvas menu never drift because they
 * are generated from one source. Each leaf routes clicks straight to
 * {@link handleMenuAction}, so no `menu-action` IPC round-trip is needed.
 */

type NativeItemOption = SubmenuOptions | MenuItemOptions | PredefinedMenuItemOptions;

const SEPARATOR: PredefinedMenuItemOptions = { item: 'Separator' };

/** Translate a normalized {@link KeyChord} into a Tauri accelerator string. */
function keyChordToAccelerator(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.primary) parts.push('CmdOrCtrl');
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.meta) parts.push('Cmd');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(acceleratorKey(chord.key));
  return parts.join('+');
}

function acceleratorKey(key: string): string {
  switch (key) {
    case 'backspace':
      return 'Backspace';
    case 'delete':
      return 'Delete';
    case 'enter':
      return 'Enter';
    case 'space':
      return 'Space';
    case 'escape':
      return 'Escape';
    case 'tab':
      return 'Tab';
    default:
      // Single characters (letters, digits, punctuation like ",") pass through
      // uppercased; function keys ("f1") become "F1"; everything else is left as
      // the parser receives it.
      if (/^f\d+$/u.test(key)) return key.toUpperCase();
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

function acceleratorForAction(
  id: string,
  resolution: ShortcutResolutionInput | undefined
): string | undefined {
  // getResolvedShortcut returns null for ids without a shortcut definition, so
  // this is safe to call for every action id.
  const chord = getResolvedShortcut(id as ShortcutActionId, resolution);
  return chord ? keyChordToAccelerator(chord) : undefined;
}

/**
 * Convert one already-visible {@link MenuItemDef} into a Tauri menu option.
 * Returns null for submenus that prune down to nothing.
 */
function toNativeOption(
  item: MenuItemDef,
  capabilities: WorkspaceCapabilities,
  resolution: ShortcutResolutionInput | undefined
): NativeItemOption | null {
  switch (item.type) {
    case 'separator':
      return SEPARATOR;
    case 'command':
      return {
        id: item.actionId,
        text: item.label,
        enabled: !item.disabled,
        action: () => {
          void handleMenuAction(item.actionId);
        },
      };
    case 'submenu': {
      const children = buildItemOptions(item.items, capabilities, resolution);
      if (children.length === 0) return null;
      return { text: item.label, items: children };
    }
    case 'action': {
      const capability = capabilities[item.id as WorkspaceCapabilityId];
      return {
        id: item.id,
        text: capability?.label ?? item.label,
        enabled: capability ? capability.enabled : true,
        accelerator: acceleratorForAction(item.id, resolution),
        action: () => {
          void handleMenuAction(item.id);
        },
      };
    }
  }
}

function buildItemOptions(
  items: MenuItemDef[],
  capabilities: WorkspaceCapabilities,
  resolution: ShortcutResolutionInput | undefined
): NativeItemOption[] {
  return pruneMenuItems(items, capabilities)
    .map((item) => toNativeOption(item, capabilities, resolution))
    .filter((option): option is NativeItemOption => option !== null);
}

/**
 * The standard macOS application submenu (the bold app-name menu). It is not
 * part of the shared web definition — it is platform chrome — so it is built
 * here with predefined native items. "About" routes to the same in-app About
 * modal as Help ▸ About Ori Studio.
 */
function appSubmenu(): SubmenuOptions {
  return {
    text: 'Ori Studio',
    items: [
      {
        id: 'app.about',
        text: 'About Ori Studio',
        action: () => {
          void handleMenuAction('app.about');
        },
      },
      SEPARATOR,
      { item: 'Services' },
      SEPARATOR,
      { item: 'Hide' },
      { item: 'HideOthers' },
      { item: 'ShowAll' },
      SEPARATOR,
      { item: 'Quit' },
    ],
  };
}

/** Build the full native menu option tree for the current context. */
export function nativeMenuOptions(
  menuDef: MenuDef[],
  capabilities: WorkspaceCapabilities,
  resolution: ShortcutResolutionInput | undefined
): SubmenuOptions[] {
  const menus: SubmenuOptions[] = [appSubmenu()];
  for (const menu of menuDef) {
    if (!menuHasVisibleItems(menu, capabilities)) continue;
    const items = buildItemOptions(menu.items, capabilities, resolution);
    if (items.length === 0) continue;
    menus.push({ text: menu.label, items });
  }
  return menus;
}

/**
 * A stable signature of everything that affects the native menu's structure,
 * labels, enablement, and accelerators. The sync hook rebuilds only when this
 * changes, so per-render capability churn does not thrash the OS menu.
 */
export function nativeMenuSignature(
  menuDef: MenuDef[],
  capabilities: WorkspaceCapabilities,
  resolution: ShortcutResolutionInput | undefined
): string {
  // Carries the whole resolution, not just the overrides: switching the defaults
  // source moves accelerators the same way a rebind does.
  const parts: string[] = [JSON.stringify(resolution ?? {})];
  const walk = (items: MenuItemDef[]) => {
    for (const item of items) {
      switch (item.type) {
        case 'separator':
          parts.push('|');
          break;
        case 'command':
          parts.push(`c:${item.actionId}:${item.disabled ? 0 : 1}:${item.label}`);
          break;
        case 'submenu':
          parts.push(`s:${item.label}`);
          walk(item.items);
          break;
        case 'action': {
          const capability = capabilities[item.id as WorkspaceCapabilityId];
          const flags = capability
            ? `${capability.visible ? 1 : 0}${capability.enabled ? 1 : 0}`
            : '11';
          parts.push(`a:${item.id}:${flags}:${capability?.label ?? item.label}`);
          break;
        }
      }
    }
  };
  for (const menu of menuDef) {
    parts.push(`m:${menu.label}`);
    walk(menu.items);
  }
  return parts.join('\n');
}

/** Build a fresh {@link Menu} for the current context. */
export async function buildNativeMenu(
  capabilities: WorkspaceCapabilities,
  resolution: ShortcutResolutionInput | undefined,
  translate?: MenuTranslate
): Promise<Menu> {
  const options = nativeMenuOptions(getMenuBarDef(resolution, translate), capabilities, resolution);
  return Menu.new({ items: options });
}
