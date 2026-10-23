import { useSyncExternalStore } from 'react';
import type { FoldPaneId } from './foldPicking';

/**
 * Which of the Fold canvas's two panes a phone shows (plan D14): one at a
 * time, swapped by the pane switch on the canvas's bar
 * (`useFoldPhoneBarGroups`). Held here rather than in a component: it is the
 * view's, never the document's, and a reload starts on the folded form,
 * where folding happens.
 */
let shown: FoldPaneId = 'folded';
const listeners = new Set<() => void>();

export function foldPhonePane(): FoldPaneId {
  return shown;
}

export function showFoldPhonePane(pane: FoldPaneId): void {
  if (shown === pane) return;
  shown = pane;
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The pane a phone shows, reactively. */
export function useFoldPhonePane(): FoldPaneId {
  return useSyncExternalStore(subscribe, foldPhonePane, () => 'folded');
}
