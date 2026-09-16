import { useSyncExternalStore } from 'react';
import i18n from '../../i18n';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { registerCanvasSessionEnder } from '../canvasObjects/canvasSessions';
import type { GestureToken } from '../canvasObjects/gestureBracket';
import { annotationGesture } from './annotationGesture';

/**
 * The inline text edit in progress, held at module level.
 *
 * Follows the `cpOverlayViewStore` shape: module state, `subscribe`, a stable
 * `get`, a `use*` wrapper, a `reset*` test seam. It used to be `useState` and
 * two refs inside `useCpAnnotations`, which only the crease-pattern panel
 * mounts — and the Properties pane, a separate dock panel, has to know
 * whether the box it is showing is being edited, because that decides which
 * write path an alignment or colour change takes (a JSON transform on the
 * stored doc, or the live editor).
 *
 * The session holds the annotation layer's bracket token for its whole life,
 * under the owner `'text-session'`, which is what refuses every other
 * annotation gesture while a box is being edited — and what makes the whole
 * edit, formatting from the pane included, one undo entry recorded on exit.
 * Nothing here enters the workspace store: history does not capture it and
 * nothing persists it.
 */
export interface TextEditSession {
  id: string;
  /** Whether this session created the box, so the undo label and the empty-box rule know. */
  created: boolean;
  /** The bracket token the session holds; null when the layer refused it. */
  token: GestureToken | null;
}

/**
 * Why a session ends: a click outside, the keyboard, the toolbar's delete, an
 * undo about to run (the session commits so the step can undo it), or the
 * document being replaced (nothing to record into).
 */
export type TextEditExitReason = 'blur' | 'escape' | 'delete' | 'history' | 'document-replaced';

let session: TextEditSession | null = null;
/**
 * A click outside an editor both commits it and, if the Text tool is active,
 * would land on the canvas as a "create a box here". Armed on a blur exit so
 * that same click only deselects.
 */
let suppressNextCreate = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function textEditSession(): TextEditSession | null {
  return session;
}

export function subscribeTextEditSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The session, as React state. */
export function useTextEditSession(): TextEditSession | null {
  return useSyncExternalStore(subscribeTextEditSession, textEditSession, () => null);
}

/**
 * Open a session on `id`. Any session already open is ended first as a blur.
 * The bracket may refuse — another owner holds the layer — in which case the
 * session still opens (the box is editable) but records no entry on exit; an
 * un-recordable session is reported so the caller can decide.
 */
export function beginTextEditSession(id: string, created: boolean): boolean {
  if (session) endTextEditSession('blur');
  const token = annotationGesture.begin('text-session');
  session = { id, created, token };
  notify();
  return token !== null;
}

/**
 * Leave inline editing. An empty box is discarded (parity with Oriedita's
 * blank-text GC); otherwise the whole edit records one undo entry — unless the
 * document is being replaced, in which case there is nothing to record into
 * and the session is simply dropped. A `'delete'` removes the box outright,
 * undoable when it existed before the session.
 */
export function endTextEditSession(reason: TextEditExitReason): void {
  const editing = session;
  if (!editing) return;
  session = null;
  if (reason === 'blur') suppressNextCreate = true;
  notify();

  const store = useWorkspaceStore.getState();
  const settle = (label: string | null) => {
    if (!editing.token) return;
    if (label === null || reason === 'document-replaced') {
      annotationGesture.abort(editing.token);
    } else {
      void annotationGesture.commit(editing.token, label);
    }
  };
  const t = i18n.t;
  if (reason === 'delete') {
    store.removeAnnotation(editing.id);
    settle(editing.created ? null : t('panels:textAnnotation.deleteText', 'Delete text'));
    return;
  }
  const annotation = store.oristudioCpAnnotations.find((a) => a.id === editing.id);
  const empty = !annotation || (annotation.kind === 'text' && annotation.plainText.trim() === '');
  if (empty) {
    if (reason !== 'document-replaced' && annotation) store.removeAnnotation(editing.id);
    settle(editing.created ? null : t('panels:textAnnotation.deleteText', 'Delete text'));
    return;
  }
  settle(
    editing.created
      ? t('panels:textAnnotation.addText', 'Add text')
      : t('panels:textAnnotation.editText', 'Edit text')
  );
}

// An undo about to run commits the open session first, so the step undoes it
// rather than running under a live editor that would write the restored doc
// back on its next keystroke; a document replacement drops it. Registered at
// module load, like the brackets: the session is module state, and reaching
// it must not depend on which surface happens to be mounted.
registerCanvasSessionEnder((reason) => {
  if (session) endTextEditSession(reason);
}, 'session');

/** Whether the next Text-tool click on empty canvas should only deselect. Consumed. */
export function takeSuppressNextTextCreate(): boolean {
  const armed = suppressNextCreate;
  suppressNextCreate = false;
  return armed;
}

/** Tests only. */
export function resetTextEditSessionForTests(): void {
  session = null;
  suppressNextCreate = false;
  listeners.clear();
}
