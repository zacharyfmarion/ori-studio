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
    if (action.kind === 'choice') {
      // Show as marks the way the step is shown; Duplicate as is a verb per way.
      items.push({
        kind: 'submenu',
        id: action.id,
        label: action.label,
        disabled: action.disabled,
        hint: action.hint,
        items: action.options.map((option) =>
          option.checked !== undefined
            ? { kind: 'radio' as const, id: `${action.id}-${option.id}`, label: option.label, checked: option.checked, onSelect: option.run }
            : { kind: 'action' as const, id: `${action.id}-${option.id}`, label: option.label, onSelect: option.run }
        ),
      });
      continue;
    }
    if (action.checked !== undefined) {
      items.push({
        kind: 'checkbox',
        id: action.id,
        label: action.label,
        checked: action.checked,
        disabled: action.disabled,
        hint: action.hint,
        onToggle: action.run,
      });
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
