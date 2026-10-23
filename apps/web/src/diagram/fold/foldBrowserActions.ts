/**
 * The ways Fold steps become Diagram steps (plan D17), bound to the store:
 * the Diagram's From Fold… — the Fold browser, opened for where its steps go
 * (D2's insertion rule, as From References… is) — and Fold's own Send to
 * Diagram, which sends the step on screen, or the active path up to it, to
 * the end of the diagram. Both capture through the Fold session's replay
 * (`pullFoldTargets`) and land as one undo step in the diagram; both make a
 * precrease and its mirror image one step while Merge symmetric precreases
 * is on (`foldPrecreaseMerge.ts`, the setting the browser remembers). The
 * session and the capture are Fold's code (`foldGateway`), loaded by the
 * pull.
 *
 * Store-bound, React-free.
 */
import { toast } from 'sonner';
import { trackDiagramStepAdded, trackDiagramTurnAdded } from '../../analytics';
import { trackFoldStepSentToDiagram, type FoldSentToDiagramVia } from '../../analytics/trackFoldIo';
import { foldStepTree, pathTo } from '../../fold/document/foldStepTree';
import { isLockedStep, turnKindOf, type FoldStepNode } from '../../fold/document/foldSequenceDocument';
import i18n from '../../i18n';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { shownFoldSequence } from '../../store/workspaceStore/foldState';
import { loadFold } from '../../workspaces/foldGateway';
import { anchorTakesCard, isTurn, stepIndex, type DiagramPullAnchor } from '../document/diagramDocument';
import { mergedPullTargets, type FoldPrecreaseMerge } from './foldPrecreaseMerge';
import type { FoldPullTarget } from './foldPull';

/** From Fold… for the diagram, by the insertion rule: an empty selected step takes the first step, the rest after it. */
export function openFoldBrowser(): void {
  const store = useWorkspaceStore.getState();
  const selected = store.diagramSelectedStepId;
  if (selected === null || !store.diagram || stepIndex(store.diagram, selected) < 0) {
    store.openDiagramFoldBrowser({ kind: 'end' });
    return;
  }
  const fill: DiagramPullAnchor = { kind: 'fill', stepId: selected };
  store.openDiagramFoldBrowser(anchorTakesCard(store.diagram, fill) ? fill : { kind: 'after', stepId: selected });
}

/** From Fold… on an empty step: the first step fills it, the rest follow it. */
export function fillStepFromFold(stepId: string): void {
  useWorkspaceStore.getState().openDiagramFoldBrowser({ kind: 'fill', stepId });
}

/** Whether the project has a Fold sequence with a step to pull: what From Fold… is offered on. */
export function hasFoldSteps(state: Parameters<typeof shownFoldSequence>[0]): boolean {
  return (shownFoldSequence(state)?.document.steps.length ?? 0) > 0;
}

/**
 * Add `targets` of the shown Fold sequence where `anchor` says, as one undo
 * step: each captured from Fold's replay, the steps that could not be left
 * out and said so. `opening` names the Fold browser opening it was pressed
 * in. How many entries it added.
 */
export async function pullFromFold(
  targets: readonly FoldPullTarget[],
  anchor: DiagramPullAnchor,
  { via, opening }: { via: FoldSentToDiagramVia; opening?: number }
): Promise<number> {
  const store = useWorkspaceStore.getState();
  const shown = shownFoldSequence(store);
  if (!shown || targets.length === 0 || store.diagramReadOnly) return 0;
  const loadId = store.diagramLoadId;
  const t = i18n.t.bind(i18n);
  const fold = await loadFold();
  const { sent, failed } = await fold.pullFoldTargets(fold.foldSession(), shown.document.id, targets, { t });
  if (failed > 0) {
    toast.error(
      t('toasts:diagram.fold.someFailed', {
        count: failed,
        defaultValue_one: 'A step couldn’t be captured from Fold, so it was left out.',
        defaultValue_other: '{{count}} steps couldn’t be captured from Fold, so they were left out.',
      })
    );
  }
  const pulled = useWorkspaceStore
    .getState()
    .pullFoldDiagramSteps(sent, anchor, { loadId, label: 'Add steps from Fold', ...(opening !== undefined ? { opening } : {}) });
  if (!pulled) return 0;
  const added = pulled.stepIds.length + pulled.turnIds.length;
  trackFoldStepSentToDiagram(via, added > 1 ? 'many' : 'one', {
    option: useSettingsStore.getState().diagramFoldMergePrecreases ? 'on' : 'off',
    // A run captured as one step: one that could not be is left out, and merged nothing.
    merged: sent.some((entry) => !('kind' in entry) && entry.source.kind === 'fold-step' && entry.source.through !== undefined)
      ? 'some'
      : 'none',
  });
  trackPulledEntries(pulled, anchor);
  return added;
}

/**
 * Count each step and turn a pull made in the Diagram's own funnels, as a
 * References pull does: a step it filled was there already, and is not added.
 */
function trackPulledEntries(
  pulled: { stepIds: readonly string[]; turnIds: readonly string[] },
  anchor: DiagramPullAnchor
): void {
  for (const stepId of pulled.stepIds) {
    if (anchor.kind === 'end' || stepId !== anchor.stepId) trackDiagramStepAdded('fold', 'fold');
  }
  const entries = useWorkspaceStore.getState().diagram?.steps ?? [];
  for (const turnId of pulled.turnIds) {
    const turn = entries.find((entry) => entry.id === turnId);
    if (turn && isTurn(turn)) trackDiagramTurnAdded(turn.kind, 'fold');
  }
}

/** What Send to Diagram sends from Fold: the step on screen, or the active path from the first step to it. */
export type FoldSendToDiagramScope = 'step' | 'path';

/** A Fold node as a pull target: a turn as a turn, anything else as the state before it with its marks. */
function targetOf(node: FoldStepNode): FoldPullTarget {
  if (!isLockedStep(node) && (node.op.kind === 'turn' || node.op.kind === 'rotate')) {
    return { kind: 'turn', turn: turnKindOf(node.op) };
  }
  return { kind: 'step', step: node.id, moment: 'before' };
}

/**
 * What Send to Diagram sends for the step on screen: that step alone, or
 * every step from the first to it — then Finished, the state it leaves, when
 * the steps fold at all. Nothing for the flat sheet.
 */
export function foldSendTargets(path: readonly FoldStepNode[], scope: FoldSendToDiagramScope): FoldPullTarget[] {
  const last = path.at(-1);
  if (!last) return [];
  if (scope === 'step') return [targetOf(last)];
  const targets = path.map(targetOf);
  return targets.some((target) => target.kind === 'step')
    ? [...targets, { kind: 'step', step: last.id, moment: 'after' }]
    : targets;
}

/** The precreases and mirror images that merge along `path`, told by the Fold session while it is held. */
async function pathMerges(sequence: string, path: readonly FoldStepNode[]): Promise<FoldPrecreaseMerge[]> {
  const fold = await loadFold();
  const session = fold.foldSession();
  const release = session.retain();
  try {
    return await fold.foldPrecreaseMerges(session, sequence, path);
  } finally {
    release();
  }
}

/**
 * Fold's Send to Diagram: the step on screen — or the path to it — added at
 * the end of the diagram, which is made if the project has none, as one undo
 * step there. Says what it did, with the way to the Diagram. Whether
 * anything was sent.
 */
export async function sendFoldStepsToDiagram(scope: FoldSendToDiagramScope): Promise<boolean> {
  const store = useWorkspaceStore.getState();
  const t = i18n.t.bind(i18n);
  if (store.diagramReadOnly) {
    toast.error(t('toasts:diagram.capture.readOnly', 'This diagram was made with a newer Ori Studio and opens read-only.'));
    return false;
  }
  const shown = shownFoldSequence(store);
  const cursor = store.foldReader?.cursor ?? null;
  const path = shown && cursor !== null ? (pathTo(foldStepTree(shown.document.steps), cursor) ?? []) : [];
  const targets = foldSendTargets(path, scope);
  if (!shown || targets.length === 0) {
    toast.error(t('common:capability.foldNoSteps', 'Fold a step first'));
    return false;
  }
  // The path, with Merge symmetric precreases as the From Fold… browser last left it: one step sends that step alone.
  const merging = scope === 'path' && useSettingsStore.getState().diagramFoldMergePrecreases;
  const sent = merging ? mergedPullTargets(targets, await pathMerges(shown.document.id, path)) : targets;
  const added = await pullFromFold(sent, { kind: 'end' }, { via: 'fold' });
  if (added === 0) return false;
  toast.success(
    t('toasts:diagram.fold.sent', {
      count: added,
      defaultValue_one: 'Added a step to the Diagram',
      defaultValue_other: 'Added {{count}} steps to the Diagram',
    }),
    {
      action: {
        label: t('toasts:diagram.fold.openDiagram', 'Open Diagram'),
        onClick: () => useLayoutStore.getState().activateWorkspace('diagram'),
      },
    }
  );
  return true;
}
