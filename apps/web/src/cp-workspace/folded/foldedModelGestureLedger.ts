/**
 * Which continuous folded-model edit is mid-gesture, and what to call it.
 *
 * A colour picker fires a change per pointer move, so a drag is one undo entry
 * only if something remembers that a gesture is open, which one it is, and
 * closes it exactly once. That used to be a bare ref in the hook, closed only
 * by the control that opened it — so any other verb starting a gesture in the
 * meantime overwrote the snapshot and the drag silently left the undo stack.
 *
 * The ledger is the pure half of the fix. The hook consults it at every gesture
 * boundary (`closeAny` before a new gesture begins), and a menu row that cannot
 * know whether its blur already committed can call `close` freely: a scope that
 * is not open is a no-op, which is what makes the second of two commits for one
 * drag record nothing.
 */

export interface FoldedModelGesture {
  /** Names one control's run of changes, e.g. `folded-color:<figure>:front_color`. */
  scope: string;
  /** The history label the run lands under, stated when it opens. */
  label: string;
}

export interface FoldedModelGestureLedger {
  /**
   * Open `scope`. Returns `true` when this call opened it — the caller
   * snapshots then — and `false` when it was already the open scope.
   */
  open(gesture: FoldedModelGesture): boolean;
  isOpen(scope: string): boolean;
  /** Close `scope` if it is the open one; the gesture to commit, else `null`. */
  close(scope: string): FoldedModelGesture | null;
  /** Close whatever is open; the gesture to commit, else `null`. */
  closeAny(): FoldedModelGesture | null;
}

export function createFoldedModelGestureLedger(): FoldedModelGestureLedger {
  let current: FoldedModelGesture | null = null;
  return {
    open(gesture) {
      if (current?.scope === gesture.scope) return false;
      current = gesture;
      return true;
    },
    isOpen(scope) {
      return current?.scope === scope;
    },
    close(scope) {
      if (current?.scope !== scope) return null;
      const closed = current;
      current = null;
      return closed;
    },
    closeAny() {
      const closed = current;
      current = null;
      return closed;
    },
  };
}
