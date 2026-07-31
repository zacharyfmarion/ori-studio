import { useEffect, useRef } from 'react';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { diagnosticEntryBounds, type CpDiagnosticBounds } from './geometry';

/**
 * Frame the diagnostic the store says was just activated.
 *
 * Keyed on the store's one-shot focus request and nothing else. That is the whole
 * point: framing is a response to an activation, so re-deriving the entry list must
 * never move the camera. It used to — the camera followed a `bounds` object memoized
 * from the active entry, and hiding the CAMV overlay dropped that entry and showing
 * it again rebuilt the bounds, which read as a fresh instruction to zoom. A user who
 * clicked an issue, zoomed out, and toggled "Foldability issues" off and on was
 * thrown back to the issue.
 *
 * `entries` therefore stays out of the effect's dependencies, in a ref: it is the
 * lookup table a request is resolved against, not a trigger. A request naming an
 * entry that is not currently listed (hidden by the overlay toggle, or left over
 * from a document that has since been replaced) frames nothing and is dropped —
 * a request never waits around for its entry to reappear.
 */
export function useCpDiagnosticFocus(
  entries: readonly OristudioCpDiagnosticEntry[],
  frameBounds: (bounds: CpDiagnosticBounds) => void
): void {
  const request = useWorkspaceStore((state) => state.oristudioCpDiagnosticFocusRequest);
  const clearRequest = useWorkspaceStore(
    (state) => state.clearOristudioCpDiagnosticFocusRequest
  );
  // Synced in an effect declared *before* the one that reads it: effects run in
  // declaration order, so a request arriving in the same commit as its entry always
  // resolves against that commit's list.
  const liveRef = useRef({ entries, frameBounds });
  useEffect(() => {
    liveRef.current = { entries, frameBounds };
  }, [entries, frameBounds]);

  useEffect(() => {
    if (!request) return;
    const { entries: listed, frameBounds: frame } = liveRef.current;
    const entry = listed.find((candidate) => candidate.id === request.diagnosticId);
    const bounds = entry ? diagnosticEntryBounds(entry) : null;
    if (bounds) frame(bounds);
    clearRequest(request.id);
  }, [clearRequest, request]);
}
