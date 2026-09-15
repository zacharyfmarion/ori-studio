import { useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  findCanvasObjectEntry,
  resolveCanvasObjectEntry,
  selectedCanvasObjectIdOf,
  type CanvasObjectTarget,
} from './canvasObjectKinds';

/**
 * The selected canvas object, resolved, for a component outside the
 * crease-pattern panel (the Properties pane is a separate dock panel with no
 * prop channel from the canvas).
 *
 * Two selectors and a memo rather than one selector returning the target: the
 * bound store hook takes a selector only, and a selector that builds a fresh
 * object per call trips React's uncached-`getSnapshot` guard. The first selector
 * returns a string (the id, from the kind table's precedence); the second
 * returns the entry *as it sits in its store array* — a stable reference, so a
 * placement drag of some other object, which replaces the array, does not
 * re-render a pane bound to this one. A drag of the selected object itself
 * does, which it should.
 */
export function useSelectedCanvasObject(): CanvasObjectTarget | null {
  const id = useWorkspaceStore((state) => selectedCanvasObjectIdOf(state));
  const entry = useWorkspaceStore((state) =>
    id === null ? null : (findCanvasObjectEntry(state, id)?.entry ?? null)
  );
  const entriesField = useWorkspaceStore((state) =>
    id === null ? null : (findCanvasObjectEntry(state, id)?.entriesField ?? null)
  );
  return useMemo(
    () =>
      id !== null && entry !== null && entriesField !== null
        ? resolveCanvasObjectEntry({ entriesField, entry }, id)
        : null,
    [id, entry, entriesField]
  );
}
