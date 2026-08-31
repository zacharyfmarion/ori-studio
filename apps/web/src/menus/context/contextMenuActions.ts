import { handleMenuAction, isMenuActionId, type MenuActionId } from '../../commands/menuActions';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import { shortcutLabelForAction, type ShortcutResolutionInput } from '../../keyboard/shortcuts';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../../lib/workspaceCapabilities';
import { getMenuBarDef, type MenuItemDef, type MenuTranslate } from '../menuDefinition';

/**
 * Turning application commands into context-menu rows.
 *
 * A context menu offers verbs the menu bar already offers. This module is what
 * keeps those two from becoming two declarations of the same thing: an id in,
 * a finished row out, where every part of the row is *derived* —
 *
 * - the **label** from {@link getMenuBarDef}, so a wording change lands in both
 *   surfaces at once and neither needs its own i18n key;
 * - the **shortcut hint** from the shortcut registry, so a rebind is reflected;
 * - **enabled**, and the reason it is not, from {@link WorkspaceCapabilities},
 *   so a row cannot be clickable in one surface and greyed in the other;
 * - **dispatch** through `handleMenuAction`, which is also where `command
 *   invoked` is captured — so these menus need no analytics of their own.
 *
 * `useBpSheetTransforms` established the pattern for one toolbar; this is it
 * generalized to arbitrary lists. Free of React and of the store, so the whole
 * thing is directly testable against a capability map.
 */

/**
 * An id that is both a command the app dispatches and a capability it gates.
 *
 * Spelled as the overlap rather than as `MenuActionId`, because a row this
 * module builds needs *both*: something to call, and something to ask whether
 * calling it is allowed. An id with only one of the two fails typecheck here
 * rather than rendering a permanently-enabled row that silently does nothing.
 */
export type ContextMenuActionId = Extract<MenuActionId, WorkspaceCapabilityId>;

export interface ContextMenuActionContext {
  capabilities: WorkspaceCapabilities;
  /**
   * Current shortcut bindings, for the right-aligned hint. Omitted falls back
   * to the registry defaults, which is correct for tests and for any caller
   * that has not read the user's overrides.
   */
  shortcuts?: ShortcutResolutionInput;
  /** Translator for labels. Omitted yields the inline English defaults. */
  t?: MenuTranslate;
  /**
   * Run instead of `handleMenuAction`. The controller passes its error-reporting
   * wrapper here; a bare caller (a test) gets the plain dispatch.
   */
  run?: (id: MenuActionId) => void;
}

/**
 * `id -> label`, flattened from the menu bar definition.
 *
 * Built per call rather than memoized at module scope on purpose: the labels are
 * localized, so a cached index would keep the language the app started in. The
 * definition is a few hundred plain objects and this runs once per menu *open*,
 * never per render — see `useContextMenuController`, which is the only thing
 * that should be calling it.
 */
export function menuActionLabelIndex(t?: MenuTranslate): Map<string, string> {
  const index = new Map<string, string>();
  const walk = (items: MenuItemDef[]) => {
    for (const item of items) {
      if (item.type === 'submenu') walk(item.items);
      else if (item.type === 'action') index.set(item.id, item.label);
    }
  };
  for (const menu of getMenuBarDef(undefined, t)) walk(menu.items);
  return index;
}

/**
 * One command as a row, or `null` when it has no place in this context.
 *
 * `null` means *hidden*, which is not the same as disabled and is decided by the
 * capability's own `visible` flag: the Crease Pattern verbs are meaningless
 * while authoring a box-pleat design, and the menu bar drops them outright
 * rather than showing a column of grey. A row that is merely unavailable —
 * "Make Mountain" with nothing selected — stays, disabled, because seeing it is
 * how you learn the verb exists and what it wants.
 */
export function contextMenuActionItem(
  id: ContextMenuActionId,
  context: ContextMenuActionContext,
  labels: Map<string, string> = menuActionLabelIndex(context.t)
): ContextMenuItem | null {
  const capability = context.capabilities[id];
  if (capability && !capability.visible) return null;
  const run = context.run ?? ((actionId: MenuActionId) => void handleMenuAction(actionId));
  const disabled = capability ? !capability.enabled : false;
  return {
    kind: 'action',
    id,
    label: labels.get(id) ?? capability?.label ?? id,
    shortcut: shortcutLabelForAction(id, context.shortcuts),
    disabled,
    // A greyed row is a dead end unless it says why. The capability already
    // carries a sentence for exactly this ("Select one or more crease-pattern
    // lines first"), and it is the same sentence the toolbars show — so hovering
    // a disabled row here answers the question rather than leaving it.
    hint: disabled ? capability?.reason : undefined,
    onSelect: () => run(id),
  };
}

/**
 * Drop hidden rows, then collapse separators.
 *
 * The same rule `pruneMenuItems` states for the menu bar, restated over
 * `ContextMenuItem` — no leading, trailing, or doubled dividers survive. It has
 * to be applied *after* assembly rather than during, because the whole point of
 * a context menu is that most of its groups are conditional: a group that
 * vanishes must take its divider with it, and no author-placed separator can
 * know whether the group before it survived.
 */
export function pruneContextMenuItems(items: (ContextMenuItem | null | false)[]): ContextMenuItem[] {
  const pruned: ContextMenuItem[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item.kind === 'separator') {
      if (pruned.length > 0 && pruned[pruned.length - 1].kind !== 'separator') pruned.push(item);
      continue;
    }
    pruned.push(item);
  }
  while (pruned.length > 0 && pruned[pruned.length - 1].kind === 'separator') pruned.pop();
  return pruned;
}

/** A run of commands, in order, with the hidden ones removed. */
export function contextMenuActionItems(
  ids: readonly ContextMenuActionId[],
  context: ContextMenuActionContext,
  labels: Map<string, string> = menuActionLabelIndex(context.t)
): ContextMenuItem[] {
  return ids
    .map((id) => contextMenuActionItem(id, context, labels))
    .filter((item): item is ContextMenuItem => item !== null);
}

/**
 * A run of commands behind one submenu trigger.
 *
 * Returns `null` when every child is hidden, so the caller can splice it in
 * without a guard — an empty submenu is a trigger that opens onto nothing, which
 * is worse than the group being absent. Disabled when every surviving child is
 * disabled: the trigger should not invite a hover that leads only to grey.
 */
export function contextMenuActionSubmenu(
  id: string,
  label: string,
  ids: readonly (ContextMenuActionId | 'separator')[],
  context: ContextMenuActionContext,
  labels: Map<string, string> = menuActionLabelIndex(context.t)
): ContextMenuItem | null {
  const items = pruneContextMenuItems(
    ids.map((child) =>
      child === 'separator'
        ? ({ kind: 'separator' } as const)
        : contextMenuActionItem(child, context, labels)
    )
  );
  const actionable = items.filter((item) => item.kind !== 'separator');
  if (actionable.length === 0) return null;
  return {
    kind: 'submenu',
    id,
    label,
    disabled: actionable.every((item) => 'disabled' in item && item.disabled === true),
    items,
  };
}

/**
 * Whether an arbitrary string is one of the ids this module can build a row for.
 *
 * For the surfaces that assemble their lists from data rather than literals.
 * Both halves are asked: a `MenuActionId` alone would let an id through that no
 * capability gates, which is the shape that renders as permanently enabled.
 */
export function isContextMenuActionId(
  id: string,
  capabilities: WorkspaceCapabilities
): id is ContextMenuActionId {
  return isMenuActionId(id) && id in capabilities;
}
