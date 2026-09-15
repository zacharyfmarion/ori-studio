import { useMemo } from 'react';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import type { AnnotationUpdate } from './annotation';
import { useTextEditSession } from './textEditSession';
import { buildTextProperties } from './textProperties';
import { useAnnotationPaneDeps } from './useAnnotationPaneDeps';

/**
 * The text sheet, with the two write paths its box-level fields need.
 *
 * **Idle** — the box is not being edited: a size or opacity change goes
 * through the layer's bracket like any annotation's, one entry per change.
 *
 * **Editing** — the box's editor is live: the session *holds* that bracket
 * for its whole life, so the pane's own `begin` would be refused and the
 * rows would sit disabled for the whole edit. Instead they write the store
 * directly, inside the session's one 'Edit text' entry, the way a keystroke
 * does.
 */
export function useTextProperties(target: TargetOf<'text'>): PropertySheet {
  const paneDeps = useAnnotationPaneDeps(target.id);
  const updateAnnotation = useWorkspaceStore((state) => state.updateAnnotation);
  const id = target.id;
  const editing = useTextEditSession()?.id === id;
  const deps = useMemo(
    () =>
      editing
        ? {
            ...paneDeps,
            held: false,
            begin: () => true,
            update: (patch: AnnotationUpdate) => updateAnnotation(id, patch),
            end: () => {},
            commit: (patch: AnnotationUpdate) => updateAnnotation(id, patch),
          }
        : paneDeps,
    [editing, paneDeps, updateAnnotation, id]
  );
  return useMemo(() => buildTextProperties(target, deps), [target, deps]);
}
