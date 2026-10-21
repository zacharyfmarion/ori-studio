import { releaseFoldedFigureHandles } from '../../cp-workspace/folded/foldedFigureHandles';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentState,
} from '../../engine/oristudioCpTypes';
import {
  restoreOristudioCpDocumentInPlace,
  restoreOristudioCpGeometryInPlace,
} from './oristudioCpRuntime';
import type { OristudioCpHistoryDocument, OristudioCpHistoryEntry } from './types';

/** Cap on the CP undo stack (matches historySlice's MAX_HISTORY). */
export const MAX_CP_HISTORY = 100;

/**
 * The CP undo stack with `entry` on top, at most {@link MAX_CP_HISTORY} deep.
 *
 * Every push goes through here. The cap used to be applied to overlay entries
 * alone, while crease edits and selections — the entries that each held a whole
 * document snapshot, 131 MiB apiece on a canvas of 489k creases — grew the
 * stack without bound. An entry the cap drops lets go of the folded-figure
 * handles it was keeping alive.
 */
export function withCpHistoryEntry(
  past: readonly OristudioCpHistoryEntry[],
  entry: OristudioCpHistoryEntry
): OristudioCpHistoryEntry[] {
  const grown = [...past, entry];
  const evicted = grown.length - MAX_CP_HISTORY;
  for (let index = 0; index < evicted; index += 1) {
    releaseFoldedFigureHandles(grown[index]!.foldedFigures ?? []);
  }
  return evicted > 0 ? grown.slice(evicted) : grown;
}

/**
 * What an undo entry keeps of `state` to put it back: its compact geometry,
 * the same arrays the store holds, not a copy (see
 * {@link OristudioCpHistoryDocument}).
 */
export function cpHistoryDocumentOf(state: OristudioCpDocumentState): OristudioCpHistoryDocument {
  return state.geometry ? { geometry: state.geometry } : { snapshot: state.document };
}

/** Put the crease pattern an undo entry holds back into the kernel, in place. */
export function restoreCpHistoryDocument(
  document: OristudioCpHistoryDocument,
  source: OristudioCpDocumentState['source'],
  lastCommandResult: OristudioCpCommandResult | null = null
): Promise<OristudioCpDocumentState> {
  return 'geometry' in document
    ? restoreOristudioCpGeometryInPlace(document.geometry, source, lastCommandResult)
    : restoreOristudioCpDocumentInPlace(document.snapshot, source, lastCommandResult);
}
