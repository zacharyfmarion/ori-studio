import { useSyncExternalStore } from 'react';
import { FOLD_PANE_DISPLAY_DEFAULT, type FoldPaneDisplay } from './foldPaneScenes';

/**
 * The panes' display switches on the viewport toolbar ("Step creases |
 * Precreases"), held here rather than in the canvas: the step strip's cards
 * are the folded pane's pictures small (`foldStatePicture`), so they read the
 * same switches, and the strip is not inside the canvas. The view's, never
 * the document's: a reload starts with both on.
 */
let shown: FoldPaneDisplay = FOLD_PANE_DISPLAY_DEFAULT;
const listeners = new Set<() => void>();

export function foldPaneDisplay(): FoldPaneDisplay {
  return shown;
}

export function setFoldPaneDisplay(display: FoldPaneDisplay): void {
  if (display.stepCreases === shown.stepCreases && display.precreases === shown.precreases) return;
  shown = display;
  for (const listener of listeners) listener();
}

/** Both switches on again: for tests, which share the module. */
export function resetFoldPaneDisplay(): void {
  setFoldPaneDisplay(FOLD_PANE_DISPLAY_DEFAULT);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The panes' display switches, reactively. */
export function useFoldPaneDisplay(): FoldPaneDisplay {
  return useSyncExternalStore(subscribe, foldPaneDisplay, () => FOLD_PANE_DISPLAY_DEFAULT);
}
