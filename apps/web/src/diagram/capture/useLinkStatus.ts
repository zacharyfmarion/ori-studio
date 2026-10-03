import { useEffect, useMemo, useState } from 'react';
import {
  ensureCpSegmentationArtifacts,
  peekCpSegmentationArtifacts,
} from '../../cp-workspace/cpSegmentationArtifacts';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldArtifacts } from '../../engine/types';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import { linkedSourceOf, linkStatus, type DiagramLinkStatus } from './linkStatus';

const NO_STATUSES: ReadonlyMap<string, DiagramLinkStatus> = new Map();

/** Where the open pattern's kernel-space segmentation is. */
export type CpSegmentationState =
  | { status: 'no-pattern' }
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'ready'; artifacts: FoldArtifacts };

/**
 * The open pattern's kernel-space segmentation, and where it is: asked for
 * only when something `wants` it — segmenting a large pattern takes a second,
 * and a diagram with no region-linked step has no use for it.
 */
export function useCpSegmentationState(wants: boolean): CpSegmentationState {
  const document = useWorkspaceStore((state) => state.oristudioCpDocument?.document ?? null);
  const [settled, setSettled] = useState<{
    document: OristudioCpDocumentSnapshot;
    artifacts: FoldArtifacts | null;
  } | null>(null);
  const peeked = document ? peekCpSegmentationArtifacts(document) : null;
  useEffect(() => {
    if (!wants || !document || peeked) return undefined;
    let live = true;
    void ensureCpSegmentationArtifacts(document).then((artifacts) => {
      if (live) setSettled({ document, artifacts });
    });
    return () => {
      live = false;
    };
  }, [wants, document, peeked]);
  // One object per answer, so what is built from it is built once.
  return useMemo((): CpSegmentationState => {
    if (!document) return { status: 'no-pattern' };
    if (peeked) return { status: 'ready', artifacts: peeked };
    if (settled?.document === document) {
      return settled.artifacts ? { status: 'ready', artifacts: settled.artifacts } : { status: 'failed' };
    }
    return { status: 'pending' };
  }, [document, peeked, settled]);
}

/** {@link useCpSegmentationState}'s segmentation, or null while there is none. */
export function useCpSegmentation(wants: boolean): FoldArtifacts | null {
  const state = useCpSegmentationState(wants);
  return state.status === 'ready' ? state.artifacts : null;
}

/** Whether any of these steps is linked to a region, and so needs the segmentation. */
function wantsSegmentation(steps: readonly DiagramStep[]): boolean {
  return steps.some((step) => {
    const source = linkedSourceOf(step);
    return source?.kind === 'references-step' || (source?.kind === 'cp' && source.scope.kind === 'segment');
  });
}

/**
 * Each linked step's link status, by step id (D2, D3, D6): what the cards
 * and the Step pane say, and what Refresh is offered for. A step that is not
 * linked — to a pattern, or to the sheet it was sent from — has none. Statuses are memoized per document (`linkStatus`), so this costs a
 * lookup per card once the pattern has been looked at.
 */
export function useDiagramLinkStatuses(
  steps: readonly DiagramStep[]
): ReadonlyMap<string, DiagramLinkStatus> {
  const document = useWorkspaceStore((state) => state.oristudioCpDocument?.document ?? null);
  const segmentation = useCpSegmentation(wantsSegmentation(steps));
  return useMemo(() => {
    let statuses: Map<string, DiagramLinkStatus> | null = null;
    for (const step of steps) {
      const source = linkedSourceOf(step);
      if (!source) continue;
      statuses ??= new Map();
      statuses.set(step.id, linkStatus(source, document, segmentation));
    }
    return statuses ?? NO_STATUSES;
  }, [steps, document, segmentation]);
}

/**
 * A step's link status as it can be told right now, without waiting for a
 * segmentation: for a surface that builds its verbs at the moment it needs
 * them (a context menu opening).
 */
export function linkStatusNow(step: DiagramStep): DiagramLinkStatus | null {
  const source = linkedSourceOf(step);
  if (!source) return null;
  const document = useWorkspaceStore.getState().oristudioCpDocument?.document ?? null;
  return linkStatus(source, document, document ? peekCpSegmentationArtifacts(document) : null);
}
