import type { MenuActionId } from '../commands/menuActions';
import { handleShortcutKeyDown, topmostModalDialog } from './shortcutDispatcher';
import type { ShortcutDefaultsSource, ShortcutOverrides } from './shortcuts';

/**
 * A barrier dialog's own undo history, such as the Layer order dialog's
 * constraints. Undo and Redo act on it, not on the document behind, while its
 * dialog is on top.
 */
export interface ModalHistory {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export type ModalHistoryVerb = 'undo' | 'redo';

/** Each dialog's history, by the dialog's root (`role="dialog" aria-modal="true" data-shortcut-barrier`). */
const histories = new WeakMap<Element, ModalHistory>();

/**
 * Give the barrier dialog `root` a history that Undo and Redo act on while it is
 * the dialog on top, from both the keys (`handleDialogShortcutKeyDown`) and
 * the menu bar (`handleMenuAction`). Returns an unregister; call it on unmount.
 * A newer registration for the same root replaces an older one, whose
 * unregister then leaves it be.
 *
 * A dialog with no history registered keeps Undo and Redo refused while it is
 * open, menus included. Only the dialog on top counts: a dialog opened over
 * this one takes Undo and Redo away from it until it closes.
 */
export function registerModalHistory(root: Element, history: ModalHistory): () => void {
  histories.set(root, history);
  return () => {
    if (histories.get(root) === history) histories.delete(root);
  };
}

/** The history of the dialog on top, or null: no dialog is open, or the one on top keeps none. */
function topModalHistory(): ModalHistory | null {
  const top = topmostModalDialog();
  return (top && histories.get(top)) ?? null;
}

/**
 * Undo or redo on the history of the dialog on top. True when it took a step;
 * false when that dialog keeps no history or has nothing to take.
 */
export function runModalHistory(verb: ModalHistoryVerb): boolean {
  const history = topModalHistory();
  if (!history) return false;
  if (verb === 'undo') {
    if (!history.canUndo()) return false;
    history.undo();
    return true;
  }
  if (!history.canRedo()) return false;
  history.redo();
  return true;
}

export interface DialogShortcutOptions {
  overrides?: ShortcutOverrides;
  defaultsSource?: ShortcutDefaultsSource;
  /** Where a chord goes once claimed: `handleMenuAction`, the menu bar's own route. */
  menu: (id: MenuActionId) => unknown;
}

/**
 * A key while a barrier dialog is open. The dialog on top resolves it, through
 * the same registry as the workspace (`insideBarrier`), but only while that
 * dialog keeps a history. Otherwise nothing claims it, and the key does what it
 * did before any dialog had keys of its own.
 *
 * What it can claim is Undo and Redo (`inBarrierDialogs`). They go to `menu`,
 * so a key and the menu bar's Undo take one route to the dialog's history: the
 * guard in `handleMenuAction`.
 */
export function handleDialogShortcutKeyDown(event: KeyboardEvent, options: DialogShortcutOptions): boolean {
  const root = topmostModalDialog();
  if (!root || !histories.has(root)) return false;
  return handleShortcutKeyDown(event, {
    scopeStack: ['global'],
    overrides: options.overrides,
    defaultsSource: options.defaultsSource,
    executors: { menu: options.menu },
    insideBarrier: root,
  });
}
