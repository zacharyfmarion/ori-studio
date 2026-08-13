import { selectionSize } from './selection';
import type { Selection } from './sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import { isShortcutEditingTarget } from '../keyboard/shortcutDispatcher';
import { handleShortcutRuntimeKeyDown } from '../keyboard/shortcutRuntime';
import type { ShortcutDefaultsSource, ShortcutOverrides } from '../keyboard/shortcuts';

export interface AppKeyboardActions {
  getActiveEditingContext: () => EditingContext;
  getSelection: () => Selection;
  handleMenuAction: (id: string) => unknown;
  selectNone: () => void;
  getShortcutOverrides?: () => ShortcutOverrides;
  /**
   * Which defaults table the dispatcher resolves against. Read here rather than
   * captured, for the same reason the overrides are: this handler outlives any
   * one render.
   *
   * Without it the toggle is a lie — the Settings list and the menu bar would
   * show Oriedita's keys while the canvas kept firing Ori Studio's, because this
   * is the only path a real keypress takes.
   */
  getShortcutDefaultsSource?: () => ShortcutDefaultsSource;
}

export function handleAppKeyDown(event: KeyboardEvent, actions: AppKeyboardActions): boolean {
  if (event.defaultPrevented || isShortcutEditingTarget(event.target)) return false;

  // The runtime is asked first, always. It used to be asked second, behind a
  // branch that handed Escape to the project-selection deselect for every
  // context except `crease-pattern` — so a surface with its own selection got
  // Escape swallowed here, saw an empty *project* selection, and did nothing.
  // Naming the one context that owned `viewport.cancel` is what made every
  // later one wrong; a surface claims the chord by registering for it.
  if (
    handleShortcutRuntimeKeyDown(event, {
      context: {
        activeEditingContext: actions.getActiveEditingContext(),
      },
      overrides: actions.getShortcutOverrides?.(),
      defaultsSource: actions.getShortcutDefaultsSource?.(),
      menu: actions.handleMenuAction,
    })
  ) {
    return true;
  }

  // Unclaimed: the workspace-wide deselect, for surfaces that have no selection
  // of their own and whose Escape means "drop the project selection".
  if (event.key === 'Escape') {
    if (selectionSize(actions.getSelection()) === 0) return false;
    event.preventDefault();
    actions.selectNone();
    return true;
  }

  return false;
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
