import type { StoreApi } from 'zustand';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import { drawnLinesUntracked } from '../../diagram/capture/linkStatus';
import { forgetOpenedLines, rememberOpenedLines, type OpenedLinkSource } from '../../diagram/capture/openedLines';
import { isStep } from '../../diagram/document/diagramDocument';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { lineContentFingerprint } from '../../lib/creaseFingerprint';
import type { WorkspaceState } from './types';

/** The store {@link installOpenedLinesSync} reads: the crease pattern and the diagram. */
type OpenedLinesState = Pick<WorkspaceState, 'oristudioCpDocument' | 'diagram'>;

/**
 * Take the crease pattern's lines as it was opened (`openedLines.ts`) for the
 * diagram's folded steps whose links never kept the lines they draw, so an aux
 * edit made since marks one out of date.
 *
 * Here rather than beside the diagram because the open is the moment that
 * matters: an aux line drawn in Edit before the Diagram workspace was ever
 * shown has to count too, and nothing of the diagram is mounted then.
 *
 * Taken once per pattern loaded (a new `loadSerial`), as soon as there is a
 * diagram holding such a step — a project installs its diagram after its
 * pattern — and the sheet index for the lines as they opened has landed.
 * Given up when the lines change first: an index built for edited lines would
 * make the edit the baseline. A pattern without aux lines, or a diagram with
 * no such step, builds no index.
 */
export function installOpenedLinesSync(store: StoreApi<OpenedLinesState>): () => void {
  /** The load a baseline is being taken, or was taken, for; undefined before the first look. */
  let serial: number | null | undefined;
  /** That load's lines, until the diagram is there to take them for — or an edit gives them up. */
  let pending: OristudioCpDocumentSnapshot | null = null;

  const run = (state: OpenedLinesState) => {
    const cp = state.oristudioCpDocument;
    const loadSerial = cp?.loadSerial ?? null;
    if (loadSerial !== serial) {
      serial = loadSerial;
      forgetOpenedLines();
      pending = cp?.document ?? null;
    }
    if (!pending) return;
    if (!cp || !sameLines(cp.document, pending)) {
      pending = null;
      return;
    }
    const entries = state.diagram?.steps ?? [];
    if (entries.length === 0) return;
    const opened = pending;
    pending = null;
    const sources: OpenedLinkSource[] = [];
    for (const entry of entries) {
      if (!isStep(entry)) continue;
      const { source } = entry;
      if (source?.kind === 'cp' && drawnLinesUntracked(entry, opened)) sources.push(source);
    }
    if (sources.length === 0) return;
    const forSerial = serial;
    void ensureCpSheetIndex(opened).then((sheets) => {
      const now = store.getState().oristudioCpDocument;
      if (!sheets || serial !== forSerial || !now || !sameLines(now.document, opened)) return;
      rememberOpenedLines(opened, sheets, sources);
    });
  };

  const unsubscribe = store.subscribe(run);
  run(store.getState());
  return unsubscribe;
}

/** The same lines: a selection, or an undo back to them, replaces the snapshot and none of them. */
function sameLines(a: OristudioCpDocumentSnapshot, b: OristudioCpDocumentSnapshot): boolean {
  return a === b || lineContentFingerprint(a) === lineContentFingerprint(b);
}
