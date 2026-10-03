import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import { shortcutLabelForAction, type ShortcutResolutionInput } from '../../keyboard/shortcuts';
import type { DiagramStepAction } from './diagramActions';

/**
 * A step card's context menu: the step verbs, as rows. Each row shows the key
 * that runs the same verb, resolved against the user's bindings, so a rebind
 * reads true here.
 */
export function diagramStepMenuItems(
  actions: readonly DiagramStepAction[],
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
      id: action.id,
      label: action.label,
      shortcut: action.shortcutId ? shortcutLabelForAction(action.shortcutId, shortcuts) : undefined,
      disabled: action.disabled,
      hint: action.hint,
      danger: action.danger,
      onSelect: action.run,
    });
  }
  while (items.length > 0 && items[items.length - 1].kind === 'separator') items.pop();
  return items;
}
