import { selectionSize } from './selection';
import type { Selection } from './sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import { isShortcutEditingTarget } from '../keyboard/shortcutDispatcher';
import { handleShortcutRuntimeKeyDown } from '../keyboard/shortcutRuntime';
import type { ShortcutOverrides } from '../keyboard/shortcuts';

export interface AppKeyboardActions {
  getActiveEditingContext: () => EditingContext;
  getSelection: () => Selection;
  handleMenuAction: (id: string) => unknown;
  selectNone: () => void;
  getShortcutOverrides?: () => ShortcutOverrides;
}

export function handleAppKeyDown(event: KeyboardEvent, actions: AppKeyboardActions): boolean {
  if (event.defaultPrevented || isShortcutEditingTarget(event.target)) return false;

  // The crease-pattern viewport owns Escape as `viewport.cancel`, dispatched
  // through the runtime below: deselecting is only its first rung, above leaving
  // the hand tool and cancelling the active tool, and only the panel knows which
  // applies. Other contexts have no such ladder, so a plain deselect is the
  // whole behaviour.
  if (event.key === 'Escape' && actions.getActiveEditingContext() !== 'crease-pattern') {
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
