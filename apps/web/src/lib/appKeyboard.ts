import { selectionSize } from './selection';
import type { Selection } from './sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import { isShortcutEditingTarget } from '../keyboard/shortcutDispatcher';
import { handleShortcutRuntimeKeyDown } from '../keyboard/shortcutRuntime';
import type { ShortcutOverrides } from '../keyboard/shortcuts';

export interface AppKeyboardActions {
  getActiveEditingContext: () => EditingContext;
  getCpSelectionSize: () => number;
  getSelection: () => Selection;
  handleMenuAction: (id: string) => unknown;
  selectNone: () => void;
  getShortcutOverrides?: () => ShortcutOverrides;
}

export function handleAppKeyDown(event: KeyboardEvent, actions: AppKeyboardActions): boolean {
  if (event.defaultPrevented || isShortcutEditingTarget(event.target)) return false;

  if (event.key === 'Escape') {
    if (actions.getActiveEditingContext() === 'crease-pattern') {
      if (actions.getCpSelectionSize() === 0) return false;
      event.preventDefault();
      void actions.handleMenuAction('edit.deselectAll');
      return true;
    }
    if (selectionSize(actions.getSelection()) === 0) return false;
    event.preventDefault();
    actions.selectNone();
    return true;
  }

  return handleShortcutRuntimeKeyDown(event, {
    context: {
      activeEditingContext: actions.getActiveEditingContext(),
    },
    overrides: actions.getShortcutOverrides?.(),
    menu: actions.handleMenuAction,
  });
}

export function installAppKeyboardListener(
  actions: AppKeyboardActions,
  target: Document = document
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    handleAppKeyDown(event, actions);
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
