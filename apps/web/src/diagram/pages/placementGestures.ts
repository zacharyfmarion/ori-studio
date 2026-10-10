import type { DiagramShortcutId } from '../../keyboard/shortcuts';
let execute: ((id: DiagramShortcutId) => boolean) | null = null;
let cancel: (() => boolean) | null = null;
export function registerPlacementKeys(run: (id: DiagramShortcutId) => boolean, drop: () => boolean): () => void {
  execute = run;
  cancel = drop;
  return () => {
    if (execute === run) {
      execute = null;
      cancel = null;
    }
  };
}
export const runPlacementKey = (id: DiagramShortcutId) => execute?.(id) ?? false;
export const cancelPlacementGesture = () => cancel?.() ?? false;
