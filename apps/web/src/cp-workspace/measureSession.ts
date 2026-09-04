import type { CpMeasurement } from './measure';

/**
 * The measure tool's session — the readings taken since the tool was armed, and
 * the ones Undo has taken back.
 *
 * This is a **transient undo layer that outranks the document**. A reading is
 * not document state (see `measure-system-redesign.md`: nothing is persisted,
 * and the whole session is discarded when the tool is left), so it has no place
 * on the crease-pattern history stack — an entry there is a document snapshot,
 * and `MAX_HISTORY` would let readings evict real edits. But it *is* something
 * the user just did, so Undo has to mean it.
 *
 * The rule, whole:
 *
 * > While the measure tool holds readings, Undo takes back the last reading and
 * > Redo puts it back. The document's own history is untouched until the
 * > readings run out — and reaching it ends the session's redo.
 *
 * Deliberately *not* interleaved with the document history. Doing that properly
 * needs a sequence number shared by both stacks, to buy an ordering only
 * reachable when a document mutation arrives while a non-mutating tool is the
 * active one. What the rule above guarantees instead is the property that
 * matters: with a reading on screen, Undo never silently changes geometry.
 *
 * See implementation-plans/measure-session-undo.md.
 */
export interface CpMeasureSession {
  /** Readings taken, oldest first — the order the context panel lists them in. */
  readonly taken: readonly CpMeasurement[];
  /** Readings Undo took back, newest first, so `[0]` is what Redo restores. */
  readonly undone: readonly CpMeasurement[];
}

export const EMPTY_CP_MEASURE_SESSION: CpMeasureSession = { taken: [], undone: [] };

export function cpMeasureSessionIsEmpty(session: CpMeasureSession): boolean {
  return session.taken.length === 0 && session.undone.length === 0;
}

/**
 * Record a reading. Clears the redo stack, as taking a new action always does:
 * a reading restored *after* this one would land out of the order it was taken
 * in, and the list is read as a chronology.
 */
export function takeCpMeasurement(
  session: CpMeasureSession,
  measurement: CpMeasurement
): CpMeasureSession {
  return { taken: [...session.taken, measurement], undone: [] };
}

/** Take back the newest reading, or null when there is none to take back. */
export function undoCpMeasurement(session: CpMeasureSession): CpMeasureSession | null {
  const last = session.taken.at(-1);
  if (!last) return null;
  return { taken: session.taken.slice(0, -1), undone: [last, ...session.undone] };
}

/** Put back the most recently undone reading, or null when there is none. */
export function redoCpMeasurement(session: CpMeasureSession): CpMeasureSession | null {
  const [next, ...rest] = session.undone;
  if (!next) return null;
  return { taken: [...session.taken, next], undone: rest };
}

/**
 * What the session becomes when Undo falls through to the document.
 *
 * The readings are gone either way; what this drops is the *redo*, so a Redo
 * after a document undo redoes the document rather than resurrecting a reading
 * the user had already stepped past. Without it the two stacks answer Undo and
 * Redo in different orders, which is the same confusion this feature exists to
 * remove.
 */
export function releasedCpMeasureRedo(session: CpMeasureSession): CpMeasureSession {
  return session.undone.length === 0 ? session : { taken: session.taken, undone: [] };
}
