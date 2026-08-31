import type { FoldArtifacts } from '../../engine/types';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';

export type FoldArtifactStatus = 'idle' | 'stale' | 'loading' | 'ready' | 'error';

export interface FoldArtifactResourceState {
  foldArtifacts: FoldArtifacts | null;
  foldArtifactError: string | null;
  foldArtifactStatus: FoldArtifactStatus;
  foldArtifactRevision: number;
  foldArtifactResolvedRevision: number | null;
  /**
   * Selected crease-pattern segment (index into `foldArtifacts.segments`), or
   * null when there are no segments. Lifecycle is tied to the fold resource so
   * it resets to the first segment whenever new artifacts resolve.
   */
  selectedSegmentId: number | null;
}

function defaultSelectedSegmentId(foldArtifacts: FoldArtifacts | null): number | null {
  return resolveCpSegments(foldArtifacts)[0]?.id ?? null;
}

export function emptyFoldArtifactResourceState(): FoldArtifactResourceState {
  return {
    foldArtifacts: null,
    foldArtifactError: null,
    foldArtifactStatus: 'idle',
    foldArtifactRevision: 0,
    foldArtifactResolvedRevision: null,
    selectedSegmentId: null,
  };
}

/**
 * Extract the current fold-artifact resource fields from a larger state object.
 * Used when a project mutation resets most state but must leave the live Edit
 * canvas's fold artifacts untouched (design-method chooser). Kept next to
 * {@link emptyFoldArtifactResourceState} so the field set stays in sync.
 */
export function pickFoldArtifactResourceState(
  state: FoldArtifactResourceState
): FoldArtifactResourceState {
  return {
    foldArtifacts: state.foldArtifacts,
    foldArtifactError: state.foldArtifactError,
    foldArtifactStatus: state.foldArtifactStatus,
    foldArtifactRevision: state.foldArtifactRevision,
    foldArtifactResolvedRevision: state.foldArtifactResolvedRevision,
    selectedSegmentId: state.selectedSegmentId,
  };
}

/**
 * The simulation source changed — a document was replaced, or the current one
 * was edited. Drops the cached artifacts and bumps the revision, which is what
 * makes a request already in flight for the previous source be discarded when
 * it lands instead of being published as the current document's.
 *
 * Every path that swaps the document the simulator reads from must go through
 * this. The Simulate workspace treats a non-null `foldArtifacts` as the current
 * document's crease pattern and never re-derives it, so a missed invalidation
 * shows the previously opened file rather than merely showing stale data.
 */
export function staleFoldArtifactResourceState(
  currentRevision: number
): FoldArtifactResourceState {
  return {
    foldArtifacts: null,
    foldArtifactError: null,
    foldArtifactStatus: 'stale',
    foldArtifactRevision: currentRevision + 1,
    foldArtifactResolvedRevision: null,
    selectedSegmentId: null,
  };
}

export function readyFoldArtifactResourceState(
  foldArtifacts: FoldArtifacts,
  revision: number
): FoldArtifactResourceState {
  return {
    foldArtifacts,
    foldArtifactError: null,
    foldArtifactStatus: 'ready',
    foldArtifactRevision: revision,
    foldArtifactResolvedRevision: revision,
    selectedSegmentId: defaultSelectedSegmentId(foldArtifacts),
  };
}
