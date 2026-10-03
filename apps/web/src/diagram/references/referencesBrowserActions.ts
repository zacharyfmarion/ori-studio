/**
 * The ways into the References browser (D20), each fixing where what it adds
 * goes: From References… on the header or an empty diagram (after the
 * selected step, or at the end), on an empty step (fills it), and Replace
 * from References… on a References step (its card, the one it shows now
 * marked).
 */
import { trackDiagramReferencesBrowserOpened } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import { stepIndex, type DiagramPullAnchor } from '../document/diagramDocument';

/** From References… for the diagram: the cards go after the selected step, or at the end. */
export function openReferencesBrowser(): void {
  const store = useWorkspaceStore.getState();
  const selected = store.diagramSelectedStepId;
  const known = selected !== null && store.diagram !== null && stepIndex(store.diagram, selected) >= 0;
  open(known ? { kind: 'after', stepId: selected } : { kind: 'end' });
}

/** From References… on an empty step: the first card fills it, the rest follow it. */
export function fillStepFromReferences(stepId: string): void {
  open({ kind: 'fill', stepId });
}

/**
 * Replace from References… on a step pulled or sent from References: the
 * first card takes its place, opened on the pattern it came from with its
 * card marked "Shown now".
 */
export function replaceStepFromReferences(stepId: string): void {
  const store = useWorkspaceStore.getState();
  const step = store.diagram?.steps[stepIndex(store.diagram, stepId)];
  if (!step || step.unknown || step.source?.kind !== 'references-step') return;
  const { plan, card, line, mode } = step.source;
  open(
    // The card's sentence is the shown card's, read as the cards are drawn (`useReferencesBrowser`).
    { kind: 'replace', stepId, sentence: null },
    {
      mode,
      pattern: plan ?? null,
      shown: { plan: plan ?? null, card, line: line ? { n: [line.n[0], line.n[1]], d: line.d } : null },
    }
  );
}

function open(anchor: DiagramPullAnchor, options?: Partial<Omit<DiagramReferencesBrowserState, 'anchor'>>): void {
  if (useWorkspaceStore.getState().openDiagramReferencesBrowser(anchor, options)) {
    trackDiagramReferencesBrowserOpened(anchor.kind);
  }
}
