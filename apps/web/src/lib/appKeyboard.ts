import { selectionSize } from './selection';
import type { Selection } from './sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import { isOpenLayerTarget, isShortcutEditingTarget } from '../keyboard/shortcutDispatcher';
import { handleShortcutRuntimeKeyDown } from '../keyboard/shortcutRuntime';
import type { ShortcutDefaultsSource, ShortcutOverrides } from '../keyboard/shortcuts';

export interface AppKeyboardActions {
  /**
   * Whether the app is showing a site page — the landing, `/faq/`, `/download/` —
   * rather than a workspace.
   *
   * A third "who owns this keystroke" predicate, beside {@link isShortcutEditingTarget}
   * (the target is typing) and {@link isOpenLayerTarget} (a layer is navigating): on a
   * site page the *page* owns them, because the reader is reading it.
   *
   * Without this, every chord the app registers is claimed and `preventDefault`ed on a
   * page where no workspace is mounted to act on it — and the one that matters is ⌘C.
   * `edit.copy` is a registered shortcut, a `<p>` is not an editing target, so the
   * runtime took the chord and the browser's own copy never ran: text on these pages
   * selected but could not be copied. Reported 2026-09-22; measured as
   * `defaultPrevented` with no `copy` event fired at all.
   *
   * Read through a getter, like the others here, because this handler outlives any one
   * route — and it asks the router rather than the DOM, so it cannot be wrong about
   * where focus happens to be.
   */
  isReadingSitePage?: () => boolean;
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
  // A key typed into an input, or into an open menu, is not a shortcut. The
  // runtime asks the same of its own callers, but the deselect fallback below
  // is this function's alone: without the layer check here, Escape aimed at a
  // context menu would still clear the project selection behind it.
  if (
    event.defaultPrevented ||
    isShortcutEditingTarget(event.target) ||
    isOpenLayerTarget(event.target) ||
    actions.isReadingSitePage?.()
  ) {
    return false;
  }

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
