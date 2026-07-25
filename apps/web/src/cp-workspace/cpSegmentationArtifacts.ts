import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import { segmentationFoldArtifactsFromFold } from '../lib/creasePatternImport';
import { exportOristudioCpDocumentAsFold } from '../store/workspaceStore/oristudioCpRuntime';

const COORD_QUANTIZE = 1e6;

/**
 * A cheap content fingerprint of the crease geometry — the actual input to
 * segmentation.
 *
 * Both obvious proxies for "the creases changed" are wrong here. The document
 * snapshot is a fresh object after every kernel command, and
 * `foldArtifactRevision` advances on the deselect that precedes a new selection
 * (it records history, which marks fold artifacts stale). Keyed on either, the
 * cache missed on every selection and re-paid the ~1s segmentation.
 *
 * Hashing the endpoints and colours is O(creases) — well under a millisecond for
 * a 6k-crease pattern against a ~1s recompute — and changes exactly when the
 * geometry does.
 */
function computeCreaseFingerprint(document: OristudioCpDocumentSnapshot): string {
  const lines = document.crease_pattern.line_segments;
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    mix(Math.round(line.a.x * COORD_QUANTIZE));
    mix(Math.round(line.a.y * COORD_QUANTIZE));
    mix(Math.round(line.b.x * COORD_QUANTIZE));
    mix(Math.round(line.b.y * COORD_QUANTIZE));
    mix(line.color.charCodeAt(0) + line.color.length);
  }
  return `${lines.length}:${hash >>> 0}`;
}

/** Memoized per snapshot, so only a genuinely new snapshot pays the O(n) hash. */
const fingerprints = new WeakMap<OristudioCpDocumentSnapshot, string>();

function creaseFingerprint(document: OristudioCpDocumentSnapshot): string {
  const cachedFingerprint = fingerprints.get(document);
  if (cachedFingerprint !== undefined) return cachedFingerprint;
  const fingerprint = computeCreaseFingerprint(document);
  fingerprints.set(document, fingerprint);
  return fingerprint;
}

/**
 * Segments-only fold artifacts for the active editable crease pattern, cached by
 * {@link creaseFingerprint}.
 *
 * A single slot is enough: only one crease pattern is active at a time, and a
 * superseded fingerprint is never wanted again.
 */
let cached: { fingerprint: string; artifacts: FoldArtifacts } | null = null;
let inFlight: { fingerprint: string; promise: Promise<FoldArtifacts | null> } | null = null;

/** Already-computed artifacts for this crease geometry, if any. Never starts work. */
export function peekCpSegmentationArtifacts(
  document: OristudioCpDocumentSnapshot | null | undefined
): FoldArtifacts | null {
  if (!document || !cached) return null;
  return cached.fingerprint === creaseFingerprint(document) ? cached.artifacts : null;
}

/**
 * Resolve segmentation-only artifacts (base fold + faces, **no** simulation mesh)
 * for the current crease geometry. Unlike `ensureFoldArtifacts` this never builds
 * the triangulated simulation model — see {@link segmentationFoldArtifactsFromFold}.
 * Resolves `null` when no editable document is loaded or the export fails.
 */
export function ensureCpSegmentationArtifacts(
  document: OristudioCpDocumentSnapshot | null | undefined
): Promise<FoldArtifacts | null> {
  if (!document) return Promise.resolve(null);
  const fingerprint = creaseFingerprint(document);
  if (cached?.fingerprint === fingerprint) return Promise.resolve(cached.artifacts);
  if (inFlight?.fingerprint === fingerprint) return inFlight.promise;

  const promise = (async (): Promise<FoldArtifacts | null> => {
    const startedAt = performance.now();
    const fold = JSON.parse(await exportOristudioCpDocumentAsFold()) as FoldDocument;
    const artifacts = segmentationFoldArtifactsFromFold(fold);
    cached = { fingerprint, artifacts };
    if (import.meta.env.DEV) {
       
      console.debug(
        `[cp-toolbar] segmentation recomputed in ${Math.round(performance.now() - startedAt)}ms (${fingerprint})`
      );
    }
    return artifacts;
  })().catch((error: unknown) => {
    // Never leave a failure cached: one transient error (e.g. the kernel handle
    // not ready) would otherwise disable the toolbar until the next edit. Report
    // rather than swallow — a silently absent toolbar is indistinguishable from
    // "this selection is not a crease pattern".
    console.warn('Crease-pattern segmentation failed; selection actions unavailable.', error);
    return null;
  }).finally(() => {
    if (inFlight?.fingerprint === fingerprint) inFlight = null;
  });

  inFlight = { fingerprint, promise };
  return promise;
}
