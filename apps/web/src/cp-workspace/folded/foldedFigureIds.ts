/**
 * Where an Edit folded figure's id comes from: `generated-N`.
 *
 * An id names more than the figure on the canvas. The project file's layer
 * order bag keys each record, and each record a reload detached, by the id
 * of the figure it was saved on (`foldedFigureLayerOrders.ts`), and a
 * detached record is shown on the figure that has its id and its refold key.
 * A new figure handed a deleted one's id — folded from the same region,
 * unmoved, under the same title — would be shown a record that was never
 * its own.
 *
 * Which is what happened: the counter started at 0 with each session and
 * skipped only the ids in use, so a file's `generated-1`, deleted, was handed
 * out again to the next fold.
 *
 * So the counter is a **session high-water mark**, as the inline simulation
 * windows' is (`inlineSimulationIds.ts`): ids arriving from outside this
 * module — a project file's figures, and every id its layer order bag names —
 * are handed to {@link noteFoldedFigureIds} before anything else is
 * allocated, and no id is handed out twice in a session.
 */

const PREFIX = 'generated-';

/** The next ordinal to hand out. Only ever moves forward. */
let nextOrdinal = 1;

/**
 * The ordinal in one of our ids, or null for anything else: a figure from a
 * TreeMaker design or an import has an id of its own scheme, which cannot
 * collide with what this hands out.
 */
function ordinalOf(id: string): number | null {
  if (!id.startsWith(PREFIX)) return null;
  // `Number` rather than `parseInt`, so `generated-1x` is rejected outright.
  const ordinal = Number(id.slice(PREFIX.length));
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

/**
 * Raise the mark past every id in `ids`. Opening a project is the one path
 * that produces ids this session did not; undo and redo restore ids already
 * noted or allocated.
 */
export function noteFoldedFigureIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const ordinal = ordinalOf(id);
    if (ordinal !== null && ordinal >= nextOrdinal) nextOrdinal = ordinal + 1;
  }
}

/**
 * A fresh id, unused by anything this session has seen. `taken`, the live
 * figures, is noted too: a path that put figures in the store without noting
 * them would otherwise hand out one of their ids.
 */
export function nextFoldedFigureId(taken: readonly { id: string }[] = []): string {
  noteFoldedFigureIds(taken.map((figure) => figure.id));
  const id = `${PREFIX}${nextOrdinal}`;
  nextOrdinal += 1;
  return id;
}

/** Back to a fresh session. For tests; nothing in the app resets the mark. */
export function resetFoldedFigureIds(): void {
  nextOrdinal = 1;
}
