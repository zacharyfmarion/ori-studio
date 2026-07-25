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
 * Resolved artifacts, kept alongside the in-flight promises. Consumers can hold
 * the async result in component state only for as long as they stay mounted, and
 * segmentation takes ~1s on a large document — long enough for a remount (the
 * panel gates the toolbar on tool state) or an effect re-run to discard the
 * result and restart, potentially forever. Caching the resolved value here means
 * any later render reads it synchronously instead of racing for it again.
 */
const resolved = new WeakMap<OristudioCpDocumentSnapshot, FoldArtifacts>();

/** Already-computed artifacts for this document, if any. Never starts work. */
export function peekCpSegmentationArtifacts(
  document: OristudioCpDocumentSnapshot | null | undefined
): FoldArtifacts | null {
  return document ? (resolved.get(document) ?? null) : null;
}

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
    const artifacts = segmentationFoldArtifactsFromFold(fold);
    resolved.set(document, artifacts);
    return artifacts;
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
