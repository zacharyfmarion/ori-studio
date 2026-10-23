/**
 * A step card's context menu, in the strip: the action
 * catalog's verbs for that step, as rows. Each row runs its verb by its
 * command id (`fold/sequence/foldCommands`), through the chokepoint, so a verb
 * from a card's menu is counted as one from the menu bar is.
 *
 * Pure: the catalog in, rows out.
 */
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import type { FoldAction } from '../foldActions';
import { foldCommandActionId } from './foldCommands';

/** The rows, `run` dispatching each command id. A separator never leads, trails or doubles. */
export function foldStepMenuItems(actions: readonly FoldAction[], run: (actionId: string) => void): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  for (const action of actions) {
    if (action.kind === 'separator') {
      const last = items[items.length - 1];
      if (last && last.kind !== 'separator') items.push({ kind: 'separator' });
      continue;
    }
    if (action.kind === 'choice') {
      items.push({
        kind: 'submenu',
        id: action.id,
        label: action.label,
        disabled: action.disabled,
        hint: action.hint,
        items: action.options.map((option) => ({
          kind: 'radio' as const,
          id: `${action.id}-${option.id}`,
          label: option.label,
          checked: option.checked,
          onSelect: () => run(`fold.${option.id}`),
        })),
      });
      continue;
    }
    items.push({
      kind: 'action',
      id: action.id,
      // The note says what else it does: "Starts a new branch".
      label: action.note ? `${action.label} · ${action.note}` : action.label,
      hint: action.hint,
      disabled: action.disabled,
      danger: action.danger,
      onSelect: () => run(foldCommandActionId(action.id)),
    });
  }
  while (items.length > 0 && items[items.length - 1]!.kind === 'separator') items.pop();
  return items;
}
