import {
  cpDecodedLineSegments,
  SEG_ATTR_STRIDE,
  SEG_SELECTED_SLOT,
} from '../../engine/oristudioCpGeometry';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentState,
  OristudioCpSelectedLines,
} from '../../engine/oristudioCpTypes';
import { emptyOristudioCpSelection, type OristudioCpSelection } from '../../lib/creasePatternViewport';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { isCurrentOristudioCpDocumentState, refreshOristudioCpDocument } from './oristudioCpRuntime';

/**
 * The commands that change which lines are selected and nothing else: the
 * kernel's `SELECTION_OPERATIONS`, which refuses to answer for any other.
 * They come back from the kernel as selected lines, not as a new document.
 */
export const SELECTION_ONLY_CP_OPERATIONS: ReadonlySet<OristudioCpOperationId> =
  new Set<OristudioCpOperationId>([
    'CreaseSelect',
    'CreaseUnselect',
    'SelectPolygon',
    'UnselectPolygon',
    'SelectLineIntersecting',
    'UnselectLineIntersecting',
    'SelectLasso',
    'UnselectLasso',
  ]);

/** The store's crease selection for the kernel's selected lines: all of them, by id. */
export function lineSelectionOf(lines: OristudioCpSelectedLines): OristudioCpSelection {
  return { ...emptyOristudioCpSelection(), lines: Array.from(lines.ids) };
}

/**
 * Write a change in the kernel's selected lines, from `replaced` to `current`,
 * into the snapshot and geometry the store holds. In place, on purpose.
 *
 * Both mirror the kernel, `selected` flags included, and two things read the
 * flags back: an `.osf` save writes the snapshot as the document, and an
 * edit's undo entry keeps the snapshot it replaced and puts it back into the
 * kernel on undo. A selection changes the flags without the document being
 * fetched again, so the change is written here, into the same objects, and
 * everything keyed on their identity (the canvas's memos, the fingerprint and
 * sheet caches) carries on. Nothing needs telling: the canvas draws
 * `oristudioCpSelection`, not these flags, and no fingerprint reads them.
 *
 * Only the store's own state may be passed, and only while it is current
 * (`isCurrentOristudioCpDocumentState`), which is what keeps this away from
 * every snapshot an undo entry puts back into the kernel. An edit takes the
 * store's snapshot for its undo entry, and an undo takes it for the redo entry,
 * as they are asked for, and each counts as a change to the document from that
 * moment, so the snapshot stops being current before either is stored. An
 * entry that keeps sharing the store's snapshot (an overlay or selection entry)
 * never puts its document back.
 */
export function mirrorSelectedLines(
  state: OristudioCpDocumentState,
  replaced: OristudioCpSelectedLines,
  current: OristudioCpSelectedLines
): void {
  // Lines not decoded yet are left so: a decode reads the flags from the
  // geometry written below (`lazyCpDocumentSnapshot`).
  const lines = cpDecodedLineSegments(state.document);
  const attr = state.geometry?.segAttr ?? null;
  const write = (id: number, value: number) => {
    const line = lines?.[id - 1];
    if (line) line.selected = value;
    const at = (id - 1) * SEG_ATTR_STRIDE + SEG_SELECTED_SLOT;
    if (attr && at < attr.length) attr[at] = value;
  };
  for (const id of replaced.ids) write(id, 0);
  current.ids.forEach((id, index) => write(id, current.values[index] ?? 0));
}

/**
 * The document state to install once the kernel's selected lines went from
 * `replaced` to `current`, in a change made while `started` was the store's.
 *
 * Normally the same snapshot and geometry, mirrored ({@link
 * mirrorSelectedLines}), in a new state object carrying `lastCommandResult`.
 * The document is fetched again instead when the store replaced its snapshot
 * while the change was in flight, or when any other change to the document has
 * been asked for since the snapshot was read, even one that has not landed: the
 * ids may no longer name the same lines in it, and an edit or undo in flight
 * may be holding it for an undo entry.
 */
export async function documentStateAfterSelection(
  started: OristudioCpDocumentState,
  live: OristudioCpDocumentState | null,
  replaced: OristudioCpSelectedLines,
  current: OristudioCpSelectedLines,
  lastCommandResult: OristudioCpCommandResult | null
): Promise<OristudioCpDocumentState> {
  if (live && live.document === started.document && isCurrentOristudioCpDocumentState(live)) {
    mirrorSelectedLines(live, replaced, current);
    return { ...live, lastCommandResult };
  }
  const refreshed = await refreshOristudioCpDocument(lastCommandResult);
  if (!refreshed) throw new Error('Editable crease-pattern document was released');
  return refreshed;
}
