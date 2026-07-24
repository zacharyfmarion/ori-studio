import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import { segmentationFoldArtifactsFromFold } from '../lib/creasePatternImport';
import { exportOristudioCpDocumentAsFold } from '../store/workspaceStore/oristudioCpRuntime';

// Cheap segments artifacts for the active CP, keyed by document-snapshot identity
// so a stable document computes once and edits recompute. Segmentation is cheap
// (kernel-supplied faces + a union-find), so no debounce is needed — the toolbar
// only fetches on selection/document change, and the document is stable while a
// selection is held.
const cache = new WeakMap<OristudioCpDocumentSnapshot, Promise<FoldArtifacts | null>>();

/**
 * Resolve segmentation-only fold artifacts (base fold + faces, **no** simulation
 * model) for the active editable crease pattern. Unlike `ensureFoldArtifacts`,
 * this never builds the triangulated simulation mesh, so it stays fast on large
 * documents — see {@link segmentationFoldArtifactsFromFold}. Returns `null` if no
 * editable document is loaded or the export fails.
 */
export function ensureCpSegmentationArtifacts(
  document: OristudioCpDocumentSnapshot | null | undefined
): Promise<FoldArtifacts | null> {
  if (!document) return Promise.resolve(null);
  const cached = cache.get(document);
  if (cached) return cached;
  const pending = (async (): Promise<FoldArtifacts | null> => {
    const fold = JSON.parse(await exportOristudioCpDocumentAsFold()) as FoldDocument;
    return segmentationFoldArtifactsFromFold(fold);
  })().catch((error: unknown) => {
    // Never cache a failure: the document snapshot is stable across selection
    // changes, so a single transient error (e.g. the kernel handle not yet ready)
    // would otherwise disable the toolbar for the rest of the document's life.
    // Drop the entry so the next selection retries, and report rather than
    // swallow — a silently absent toolbar is indistinguishable from "no match".
    cache.delete(document);
    console.warn('Crease-pattern segmentation failed; selection actions unavailable.', error);
    return null;
  });
  cache.set(document, pending);
  return pending;
}
