/**
 * Where a simulation window's id comes from.
 *
 * An id is not a label. It keys the runtime side table that holds the window's
 * fold, its fold position, and its exporter (`inlineSimulationRuntime`), it keys
 * the rebuild counter that busts the worker's prepared-model cache, and it is
 * the React key the canvas layer renders by. Two windows sharing one is not a
 * cosmetic clash — the second window's fold *replaces* the first's in the map,
 * so both draw the same mesh, both match `focusedId`, and both advance when the
 * fold is played.
 *
 * Which is what shipped: the counter was a module-scope `1` in the store slice,
 * bumped only when a window was created, and a project file restores windows
 * with the ids they were saved under. Open a file holding `inline-sim-1..3` and
 * the first window created in that session was handed `inline-sim-1` again. The
 * loaded window then rendered the *new* simulation at its own saved size, and
 * saving wrote two entries under one id — of which `validateInlineSimulations`
 * silently keeps one on the next load.
 *
 * So the counter is a **session high-water mark**, and the rule that makes it
 * one is that ids arriving from outside this module must be handed to
 * {@link noteInlineSimulationIds} before anything else can be allocated.
 *
 * Monotonic, deliberately: ids are never reused within a session, which is what
 * lets a deleted window's fold position survive in the runtime table until undo
 * brings the window back (see `clearInlineSimulationSource`). Picking the lowest
 * free number instead would hand a new window the fold position of a deleted one.
 */

/** What this module needs of a window: its id. */
interface HasId {
  id: string;
}

const PREFIX = 'inline-sim-';

/** The next ordinal to hand out. Only ever moves forward. */
let nextOrdinal = 1;

/**
 * The ordinal in one of our ids, or null for anything else.
 *
 * Foreign ids — a hand-edited file, some future scheme — are not an error and
 * not something to renumber. They cannot collide with what this hands out, so
 * ignoring them is the whole handling.
 */
function ordinalOf(id: string): number | null {
  if (!id.startsWith(PREFIX)) return null;
  const suffix = id.slice(PREFIX.length);
  // `Number` rather than `parseInt`, so `inline-sim-1x` is rejected outright
  // rather than read as 1 — that would move the mark too little, not too much.
  const ordinal = Number(suffix);
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

/**
 * Raise the mark past every id in `simulations`.
 *
 * Call this wherever windows enter the store from outside — today that is
 * opening a project, the only path that produces ids this session did not.
 * Undo and redo restore ids that were already noted or allocated, so they need
 * no call of their own.
 */
export function noteInlineSimulationIds(simulations: readonly HasId[]): void {
  for (const simulation of simulations) {
    const ordinal = ordinalOf(simulation.id);
    if (ordinal !== null && ordinal >= nextOrdinal) nextOrdinal = ordinal + 1;
  }
}

/**
 * A fresh id, unused by anything this session has seen.
 *
 * `taken` is the live list, noted here as well as at ingestion. Belt and braces:
 * a future path that puts windows into the store without noting them would
 * otherwise reintroduce exactly the collision above, and the cost of catching it
 * is one pass over at most a handful of entries.
 */
export function nextInlineSimulationId(taken: readonly HasId[] = []): string {
  noteInlineSimulationIds(taken);
  const id = `${PREFIX}${nextOrdinal}`;
  nextOrdinal += 1;
  return id;
}

/** Back to a fresh session. For tests; nothing in the app resets the mark. */
export function resetInlineSimulationIds(): void {
  nextOrdinal = 1;
}
