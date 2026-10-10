/**
 * Fields holding typed text they have not committed yet: a text area that
 * commits after a pause, a title that commits on blur.
 *
 * Every question about unsaved work, and every save, flushes them first. Until
 * then the store does not know about the draft, so a save writes the old text
 * and reports the project clean, and a discard prompt does not appear, while
 * the screen shows the new text. Store-free on purpose: the fields register
 * here, and the store's save path and the unsaved-work guard call
 * {@link flushPendingEdits}, so the dependency runs one way.
 */
type Flush = () => void;

const flushes = new Set<Flush>();

/** Register a field's flush; returns the unregister. */
export function registerPendingEditFlush(flush: Flush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/** Commit every pending draft, now. */
export function flushPendingEdits(): void {
  for (const flush of [...flushes]) flush();
}

/** Test seam. */
export function resetPendingEditsForTests(): void {
  flushes.clear();
}
