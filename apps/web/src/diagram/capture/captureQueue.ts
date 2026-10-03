import { toast } from 'sonner';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import { onEngineLost } from '../../engines/engineHost';
import i18n from '../../i18n';
import { requestConfirmation } from '../../store/commandDialogStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { stepIndex, type DiagramStep, type DiagramStyle } from '../document/diagramDocument';
import { lightingChanged } from '../pictures/lighting';
import { abandonOnEngineLoss } from './engineLoss';
import { linkStatus } from './linkStatus';
import { sayCaptureOutcome, trackCapture } from './stepCaptureActions';

/** The label Refresh all's one undo entry carries. */
const REFRESH_ALL_LABEL = 'Refresh out-of-date steps';

let cancelRun: (() => void) | null = null;
/** The step Refresh all is capturing now: the one capture its Stop is for. */
let refreshing: string | null = null;

/**
 * Refresh all out-of-date steps (D4): every linked step whose pattern changed,
 * captured again one at a time, as one undo entry for the whole run.
 *
 * - One at a time, yielding between steps, so the Diagram stays responsive and
 *   each card updates as its picture lands.
 * - It waits while Edit is the active workspace: the pattern being edited is
 *   the one being captured, and both fold on one kernel.
 * - It asks first when a redo branch would be lost.
 * - A Stop on any of its folds, a replaced diagram or a lost engine ends it.
 *
 * Never on open, and never on its own: only when asked. Resolves how many
 * steps were refreshed.
 */
export async function refreshAllDiagramSteps(): Promise<number> {
  if (cancelRun) return 0;
  const state = useWorkspaceStore.getState();
  const cp = state.oristudioCpDocument;
  if (!state.diagram || !cp || state.diagramReadOnly) return 0;
  const loadId = state.diagramLoadId;
  const segmentation = await abandonOnEngineLoss(ensureCpSegmentationArtifacts(cp.document)).catch(
    () => null
  );
  const current = useWorkspaceStore.getState().diagram;
  const stale = current ? outOfDate(current.steps, current.style, segmentation) : [];
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
  try {
    for (const [index, stepId] of stale.entries()) {
      await nextTurn();
      await whileEditIsActive(() => cancelled);
      const store = useWorkspaceStore.getState();
      if (cancelled || store.diagramLoadId !== loadId) break;
      const step = store.diagram?.steps[stepIndex(store.diagram, stepId)];
      if (step?.source?.kind !== 'cp') continue;
      const { scope, render } = step.source;
      refreshing = stepId;
      const outcome = await store
        .captureDiagramStep(stepId, {
          scope,
          render,
          kind: 'diagram-refresh',
          label: REFRESH_ALL_LABEL,
          joinEntry,
        })
        .finally(() => {
          refreshing = null;
        });
      trackCapture(outcome, render, 'refresh_all');
      if (outcome.status === 'captured' && outcome.changed) {
        refreshed += 1;
        joinEntry ??= useWorkspaceStore.getState().diagramHistory.past.at(-1);
      }
      if (outcome.status === 'stopped') break;
      if (outcome.status !== 'captured' && outcome.status !== 'discarded') sayCaptureOutcome(outcome);
      useWorkspaceStore.setState({ diagramRefreshAll: { total: stale.length, done: index + 1 } });
    }
  } finally {
    unlisten();
    cancelRun = null;
    if (useWorkspaceStore.getState().diagramLoadId === loadId) {
      useWorkspaceStore.setState({ diagramRefreshAll: null });
    }
  }
  if (refreshed > 0) {
    toast.success(
      i18n.t('toasts:diagram.refreshedAll', {
        count: refreshed,
        defaultValue_one: 'Refreshed 1 step',
        defaultValue_other: 'Refreshed {{count}} steps',
      })
    );
  }
  return refreshed;
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
 * The linked steps whose pattern changed, or whose 3D picture was lit by
 * another style than the diagram's, in order.
 */
export function outOfDate(
  steps: readonly DiagramStep[],
  style: DiagramStyle,
  segmentation: Parameters<typeof linkStatus>[2]
): string[] {
  const document = useWorkspaceStore.getState().oristudioCpDocument?.document ?? null;
  return steps
    .filter((step) => {
      if (step.unknown || step.source?.kind !== 'cp') return false;
      const status = linkStatus(step.source, document, segmentation);
      return status === 'stale' || (status === 'current' && lightingChanged(step, style));
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
