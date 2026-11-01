import { toast } from 'sonner';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import { onEngineLost } from '../../engines/engineHost';
import i18n from '../../i18n';
import { layerOrderOffline, layerOrderReloadAction } from '../../layer-order/engine/layerOrderLoadFailure';
import { openLayerOrderResolveBatch, type LayerOrderResolveBatch } from '../../layer-order/host/hostEngineGateway';
import { requestConfirmation } from '../../store/commandDialogStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { stepById, stepsOf, type DiagramStep, type DiagramStyle } from '../document/diagramDocument';
import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import { refreshDiagramFoldStep } from '../fold/foldStepActions';
import { knownCreasesOf } from './captureCreases';
import { diagramLinkStatus } from './diagramLinks';
import { abandonOnEngineLoss } from './engineLoss';
import { linkedSourceOf, refreshKind, type DiagramLinkContext } from './linkStatus';
import { layerOrderOf, sayCaptureOutcome, trackCapture } from './stepCaptureActions';
import { linkContextNow } from './useLinkStatus';

/** The label Refresh all's one undo entry carries. */
const REFRESH_ALL_LABEL = 'Refresh out-of-date steps';

let cancelRun: (() => void) | null = null;
/** The step Refresh all is capturing now: the one capture its Stop is for. */
let refreshing: string | null = null;

/**
 * Refresh all out-of-date steps (D4): every linked step whose pattern changed
 * — and every step linked to a Fold step whose sequence changed (plan D17) —
 * captured again one at a time, as one undo entry for the whole run.
 *
 * - One at a time, yielding between steps, so the Diagram stays responsive and
 *   each card updates as its picture lands.
 * - It waits while Edit is the active workspace before a step of Edit's
 *   pattern: the pattern being edited is the one being captured, and both
 *   fold on one kernel. A Fold step folds nothing, and does not wait.
 * - It asks first when a redo branch would be lost.
 * - A Stop on any of its folds, a replaced diagram or a lost engine ends it.
 * - A step's layer order is restored on one host engine worker for the run
 *   (H7). One the browser did not load (offline) is asked once: the
 *   constrained steps after it are counted, not folded, and said in one toast;
 *   the other steps go on.
 *
 * Never on open, and never on its own: only when asked. Resolves how many
 * steps were refreshed.
 */
export async function refreshAllDiagramSteps(): Promise<number> {
  if (cancelRun) return 0;
  const state = useWorkspaceStore.getState();
  const cp = state.oristudioCpDocument;
  if (!state.diagram || state.diagramReadOnly) return 0;
  const loadId = state.diagramLoadId;
  // A diagram linked only to Fold steps needs no pattern: its sheets are none.
  const sheets = cp ? await abandonOnEngineLoss(ensureCpSheetIndex(cp.document)).catch(() => null) : null;
  const current = useWorkspaceStore.getState().diagram;
  const stale = current ? outOfDate(stepsOf(current), current.style, sheets) : [];
  if (stale.length === 0) return 0;
  if (useWorkspaceStore.getState().diagramHistory.future.length > 0) {
    const t = i18n.t;
    const confirmed = await requestConfirmation({
      title: t('dialogs:diagram.refreshAllTitle', 'Refresh {{total}} steps?', { total: stale.length }),
      message: t(
        'dialogs:diagram.refreshAllMessage',
        'Refreshing them is one change you can undo, but what you undid before it can no longer be redone.'
      ),
      confirmLabel: t('dialogs:diagram.refreshAllConfirm', 'Refresh'),
      cancelLabel: t('dialogs:common.cancel', 'Cancel'),
    });
    if (!confirmed || useWorkspaceStore.getState().diagramLoadId !== loadId) return 0;
  }

  let cancelled = false;
  cancelRun = () => {
    cancelled = true;
  };
  const unlisten = onEngineLost(({ engine }) => {
    if (engine === 'oristudio-cp') cancelled = true;
  });
  useWorkspaceStore.setState({ diagramRefreshAll: { total: stale.length, done: 0 } });
  let refreshed = 0;
  let joinEntry: object | undefined;
  // One host engine worker for every step whose layer order is restored (H7):
  // opened by the first such step, once it has done waiting for Edit, and
  // ended with the run.
  let layerOrders: LayerOrderResolveBatch | null = null;
  // Steps whose layer order kept their picture, or found no engine: said once, at the end.
  const kept = { constraints: 0, chosen: 0 };
  const lost = { load: 0, other: 0 };
  try {
    for (const [index, stepId] of stale.entries()) {
      await nextTurn();
      const waiting = useWorkspaceStore.getState();
      const linked = waiting.diagram ? stepById(waiting.diagram, stepId) : null;
      if (lost.load > 0 && linked?.source?.kind === 'cp' && linked.source.layerOrder !== undefined) {
        if (cancelled || waiting.diagramLoadId !== loadId) break;
        // The browser did not load the host engine for an earlier step (offline): this run's
        // constrained steps are counted, not folded and asked again for the same answer. A crash
        // may be one record's, so after one the steps go on being tried.
        lost.load += 1;
        useWorkspaceStore.setState({ diagramRefreshAll: { total: stale.length, done: index + 1 } });
        continue;
      }
      if (linked?.source?.kind === 'fold-step') {
        if (cancelled || waiting.diagramLoadId !== loadId) break;
        // Captured from Fold's replay: no kernel to share with Edit, and nothing to stop.
        refreshing = stepId;
        const outcome = await refreshDiagramFoldStep(stepId, { label: REFRESH_ALL_LABEL, joinEntry })?.finally(() => {
          refreshing = null;
        });
        if (outcome?.status === 'captured' && outcome.changed) {
          refreshed += 1;
          joinEntry ??= useWorkspaceStore.getState().diagramHistory.past.at(-1);
        }
        useWorkspaceStore.setState({ diagramRefreshAll: { total: stale.length, done: index + 1 } });
        continue;
      }
      await whileEditIsActive(() => cancelled);
      const store = useWorkspaceStore.getState();
      if (cancelled || store.diagramLoadId !== loadId) break;
      const step = store.diagram ? stepById(store.diagram, stepId) : null;
      if (step?.source?.kind !== 'cp') continue;
      const { scope, render } = step.source;
      if (step.source.layerOrder !== undefined) layerOrders ??= openLayerOrderResolveBatch();
      refreshing = stepId;
      const outcome = await store
        .captureDiagramStep(stepId, {
          scope,
          known: knownCreasesOf(step.source),
          render,
          kind: 'diagram-refresh',
          label: REFRESH_ALL_LABEL,
          joinEntry,
          ...layerOrderOf(step.source),
          ...(layerOrders ? { layerOrders } : {}),
        })
        .finally(() => {
          refreshing = null;
        });
      trackCapture(outcome, render, 'refresh_all');
      if (outcome.status === 'captured' && outcome.changed) {
        refreshed += 1;
        joinEntry ??= useWorkspaceStore.getState().diagramHistory.past.at(-1);
      }
      if (outcome.status === 'needs-attention') {
        // Flagged in the run's one entry too, and said with the rest at the end.
        if (outcome.changed) joinEntry ??= useWorkspaceStore.getState().diagramHistory.past.at(-1);
        if (outcome.attention.count === 0) kept.chosen += 1;
        else kept.constraints += 1;
      } else if (outcome.status === 'layer-order-lost') {
        if (outcome.offline) lost.load += 1;
        else lost.other += 1;
      } else if (outcome.status === 'stopped') {
        break;
      } else if (outcome.status !== 'captured' && outcome.status !== 'discarded') {
        sayCaptureOutcome(outcome);
      }
      useWorkspaceStore.setState({ diagramRefreshAll: { total: stale.length, done: index + 1 } });
    }
  } finally {
    layerOrders?.close();
    unlisten();
    cancelRun = null;
    if (useWorkspaceStore.getState().diagramLoadId === loadId) {
      useWorkspaceStore.setState({ diagramRefreshAll: null });
    }
  }
  sayRefreshedAll(refreshed, kept);
  sayLayerOrderLostSteps(lost);
  return refreshed;
}

/**
 * The steps Refresh all left as they were because the host engine was not
 * there, counted: one toast for those the browser did not load it for, with
 * Reload, the only retry there is (`layerOrderReloadAction`; offline, to
 * reconnect first), and one, neutral, for those it stopped or did not start
 * for, which may be a defect.
 */
function sayLayerOrderLostSteps(lost: { load: number; other: number }): void {
  const t = i18n.t;
  if (lost.load > 0) {
    toast.error(
      layerOrderOffline()
        ? t('toasts:diagram.refreshAllLayerOrderLostLoadOffline', {
            count: lost.load,
            defaultValue_one:
              'Layer order couldn’t load while offline, so 1 step wasn’t changed. Reconnect, then reload Ori Studio to try again.',
            defaultValue_other:
              'Layer order couldn’t load while offline, so {{count}} steps weren’t changed. Reconnect, then reload Ori Studio to try again.',
          })
        : t('toasts:diagram.refreshAllLayerOrderLostLoadReload', {
            count: lost.load,
            defaultValue_one: 'Layer order couldn’t load, so 1 step wasn’t changed. Reload Ori Studio to try again.',
            defaultValue_other:
              'Layer order couldn’t load, so {{count}} steps weren’t changed. Reload Ori Studio to try again.',
          }),
      { action: layerOrderReloadAction(t) }
    );
  }
  if (lost.other > 0) {
    toast.error(
      t('toasts:diagram.refreshAllLayerOrderLost', {
        count: lost.other,
        defaultValue_one: 'Layer order stopped unexpectedly, so 1 step wasn’t changed.',
        defaultValue_other: 'Layer order stopped unexpectedly, so {{count}} steps weren’t changed.',
      })
    );
  }
}

/**
 * What Refresh all came to, in one toast: the steps it refreshed, and the
 * steps whose layer order kept their picture (D10), which each say why in the
 * Step pane — never a toast a step.
 */
function sayRefreshedAll(refreshed: number, kept: { constraints: number; chosen: number }): void {
  const t = i18n.t;
  const flagged = kept.constraints + kept.chosen;
  const description =
    flagged === 0
      ? undefined
      : kept.constraints === 0
        ? t('toasts:diagram.refreshAllChosenOrderKept', {
            count: kept.chosen,
            defaultValue_one: '1 step’s chosen layer order needs attention, so it keeps its picture.',
            defaultValue_other: '{{count}} steps’ chosen layer orders need attention, so they keep their pictures.',
          })
        : t('toasts:diagram.refreshAllLayerOrderKept', {
            count: flagged,
            defaultValue_one: '1 step’s layer constraints need attention, so it keeps its picture.',
            defaultValue_other: '{{count}} steps’ layer constraints need attention, so they keep their pictures.',
          });
  if (refreshed > 0) {
    const title = t('toasts:diagram.refreshedAll', {
      count: refreshed,
      defaultValue_one: 'Refreshed 1 step',
      defaultValue_other: 'Refreshed {{count}} steps',
    });
    if (description) toast.success(title, { description });
    else toast.success(title);
  } else if (description) {
    toast.message(description);
  }
}

/**
 * Stop Refresh all: no step after the one it is on, and that step's fold
 * stopped as any is. A capture the user started meanwhile — a Pose verb, a
 * link — is theirs, and goes on.
 */
export function stopRefreshAll(): void {
  cancelRun?.();
  if (refreshing !== null) useWorkspaceStore.getState().stopDiagramCapture(refreshing);
}

/**
 * The linked steps whose pattern — or Fold step — changed, or whose 3D
 * picture was lit by another style than the diagram's, in order.
 */
export function outOfDate(
  steps: readonly DiagramStep[],
  style: DiagramStyle,
  sheets: CpSheetIndex | null
): string[] {
  const now = linkContextNow();
  const context: DiagramLinkContext = { ...now, cp: { document: now.cp.document, sheets } };
  return steps
    .filter((step) => {
      const source = linkedSourceOf(step);
      // A References step is never refreshed (D6); folded part way in the
      // simulator (`pose`), only Pose can capture it again (D19).
      return (
        (source?.kind === 'cp' || source?.kind === 'fold-step') &&
        refreshKind(step, diagramLinkStatus(source, context), style) === 'refresh'
      );
    })
    .map((step) => step.id);
}

/** Let the page breathe between steps. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resolve once Edit is not the active workspace, or the run is cancelled. */
function whileEditIsActive(cancelled: () => boolean): Promise<void> {
  if (useLayoutStore.getState().activeWorkspace !== 'edit') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (cancelled() || useLayoutStore.getState().activeWorkspace !== 'edit') {
        unsubscribe();
        clearInterval(poll);
        resolve();
      }
    };
    const unsubscribe = useLayoutStore.subscribe(check);
    // Cancellation does not move the layout store; look for it now and then.
    const poll = setInterval(check, 500);
  });
}
