import type { FoldArtifacts } from '../../engine/types';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import type { SequenceSimulationFocus } from './types';

export type FoldArtifactStatus = 'idle' | 'stale' | 'loading' | 'ready' | 'error';

export interface FoldArtifactResourceState {
  foldArtifacts: FoldArtifacts | null;
  foldArtifactError: string | null;
  foldArtifactStatus: FoldArtifactStatus;
  foldArtifactRevision: number;
  foldArtifactResolvedRevision: number | null;
  foldArtifactRequestId: number;
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

export interface FoldArtifactDependentState {
  sequenceTarget: null;
  sequencePlan: null;
  sequenceSimulationFocus: SequenceSimulationFocus;
  sequencePlanning: false;
  sequenceError: null;
}

const wholeSimulationFocus: SequenceSimulationFocus = { kind: 'whole' };

export function emptyFoldArtifactResourceState(): FoldArtifactResourceState {
  return {
    foldArtifacts: null,
    foldArtifactError: null,
    foldArtifactStatus: 'idle',
    foldArtifactRevision: 0,
    foldArtifactResolvedRevision: null,
    foldArtifactRequestId: 0,
    selectedSegmentId: null,
  };
}

export function staleFoldArtifactResourceState(
  currentRevision: number
): FoldArtifactResourceState & FoldArtifactDependentState {
  return {
    foldArtifacts: null,
    foldArtifactError: null,
    foldArtifactStatus: 'stale',
    foldArtifactRevision: currentRevision + 1,
    foldArtifactResolvedRevision: null,
    foldArtifactRequestId: 0,
    selectedSegmentId: null,
    sequenceTarget: null,
    sequencePlan: null,
    sequenceSimulationFocus: wholeSimulationFocus,
    sequencePlanning: false,
    sequenceError: null,
  };
}

export function readyFoldArtifactResourceState(
  foldArtifacts: FoldArtifacts,
  revision: number
): Omit<FoldArtifactResourceState, 'foldArtifactRequestId'> {
  return {
    foldArtifacts,
    foldArtifactError: null,
    foldArtifactStatus: 'ready',
    foldArtifactRevision: revision,
    foldArtifactResolvedRevision: revision,
    selectedSegmentId: defaultSelectedSegmentId(foldArtifacts),
  };
}
