import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import {
  shortcutLabelForAction,
  type ReferencesShortcutId,
  type ShortcutResolutionInput,
} from '../../keyboard/shortcuts';
import type { ReferencesAction } from './referencesActions';

/**
 * The References view's context menu, as content.
 *
 * `simulatorContextMenu.ts`'s arrangement: every row is a registry shortcut,
 * and the menu is the first surface that says out loud what the keys do. The
 * rows come from the action catalog (`referencesActions.ts`) rather than from
 * the registry directly, so a verb's gating and label are decided once for the
 * transport strip and this menu alike; the registry only contributes the
 * user's *current* chord for each row.
 *
 * Pointer-only, like the simulator's: every row already is a key binding, so a
 * keyboard user has the whole menu without opening it.
 *
 * Free of React and of the store.
 */
export function referencesMenuItems(
  actions: readonly ReferencesAction[],
  /** The panel's executor, so a menu row and its key are one path. */
  run: (id: ReferencesShortcutId) => void,
  shortcuts?: ShortcutResolutionInput
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  for (const action of actions) {
    if (action.kind === 'separator') {
      // Collapse a separator that would lead or double up.
      const last = items[items.length - 1];
      if (!last || last.kind === 'separator') continue;
      items.push({ kind: 'separator' });
      continue;
    }
    items.push({
      kind: 'action',
      id: action.shortcutId,
      label: action.label,
      shortcut: shortcutLabelForAction(action.shortcutId, shortcuts),
      disabled: action.disabled,
      hint: action.hint,
      onSelect: () => run(action.shortcutId),
    });
  }
  while (items.length > 0 && items[items.length - 1].kind === 'separator') items.pop();
  return items;
}
