/**
 * How the things that hold an open edit on the canvas — a gesture bracket
 * mid-drag, a text box mid-edit — are told to let go when something outside
 * them moves history or replaces the document.
 *
 * Store-free by design: the store's `discardCpDocumentState` calls
 * {@link endOpenCanvasSessions} directly, and the brackets and sessions that
 * register here import the store themselves, so the dependency runs one way.
 *
 * Two phases, because order matters: a text session answers `'history'` by
 * *committing* its entry through its layer's bracket, so it has to run before
 * that bracket answers the same call by aborting whatever it holds.
 */
export type CanvasSessionEndReason = 'history' | 'document-replaced';

export type CanvasSessionPhase = 'session' | 'bracket';

type Ender = (reason: CanvasSessionEndReason) => void;

const enders: Record<CanvasSessionPhase, Set<Ender>> = {
  session: new Set(),
  bracket: new Set(),
};

/** Register how one owner ends; returns the unregister. */
export function registerCanvasSessionEnder(
  end: Ender,
  phase: CanvasSessionPhase = 'session'
): () => void {
  enders[phase].add(end);
  return () => {
    enders[phase].delete(end);
  };
}

/**
 * End every open session and bracket.
 *
 * `'history'`: an undo or redo is about to run — a session commits what it has
 * so the step then undoes it, and a pointer bracket aborts so its later commit
 * records nothing against a baseline that no longer exists.
 * `'document-replaced'`: everything is dropped; there is nothing to record into.
 */
export function endOpenCanvasSessions(reason: CanvasSessionEndReason): void {
  for (const end of [...enders.session]) end(reason);
  for (const end of [...enders.bracket]) end(reason);
}

/** Test seam. */
export function resetCanvasSessionEndersForTests(): void {
  enders.session.clear();
  enders.bracket.clear();
}
