import type { TFunction } from 'i18next';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { toast } from 'sonner';
import { ANALYTICS_EVENTS, bucketCount, COUNT_BUCKETS, track } from '../../analytics';
import { layerOrderOffline, layerOrderReloadAction } from '../../layer-order/engine/layerOrderLoadFailure';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpFigureSolutionStep } from '../../store/workspaceStore/types';
import type { FoldedFigureCamera } from './folded3dCamera';
import { foldedFigureCapabilities } from './foldedFigureCapabilities';
import { foldedFigureGesture } from './foldedFigureGesture';
import { foldedFigureLayerOrderHold } from './foldedFigureLayerOrderState';
import { sayFoldedFigureLayerOrderRefold } from './foldedFigureLayerOrderToasts';
import { foldedFigureCurrentCase, foldedFigureFrontier } from './foldedFigureState';
import { openFoldedFigureExport } from './openFoldedFigureExport';

/**
 * The folded-figure layer's one-entry setters as React-free functions over the
 * layer's bracket, so the Properties pane, the floating toolbar and the
 * context menu share one implementation without mounting `useFoldedFigures`
 * (single-instance: it needs the panel's document and selection, and owns the
 * orbit and rehydration effects).
 *
 * Every function is `foldedFigureGesture.run('verb', label, …)`; a verb that
 * changed nothing records nothing, and one issued while another owner holds
 * the layer is refused. Export is no entry: saving a file changes nothing. The
 * verbs that need panel-held state — the notice action, the 3D flip through
 * the live orbit camera, refold — stay in the hook and on the floating
 * toolbar.
 */

/**
 * The face folding holds fixed. Oriedita lets this be chosen and the kernel still
 * takes it per fold, but the product does not offer the choice: the picker was the
 * only thing that ever set it, so every fold was already from face 1.
 */
const FOLD_STARTING_FACE_ID = 1;

/**
 * Fold these creases into a new figure, as one entry: the viewport bar, `G` and
 * the selection toolbar all fold through here. A fold that is refused, fails or
 * is stopped leaves the figures as it found them, so it records nothing.
 */
export function foldCreases(
  lineIds: readonly number[],
  t: TFunction
): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.foldModelAction', 'Fold model'),
    () =>
      useWorkspaceStore.getState().foldOristudioCpDocument({
        startingFaceId: FOLD_STARTING_FACE_ID,
        lineIds: [...lineIds],
      })
  );
}

export function setFoldedFigureDisplayStyle(
  id: string,
  displayStyle: OristudioCpFoldedFigureDisplayStyle,
  t: TFunction
): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.changeFoldedDisplayStyle', 'Change folded display style'),
    () => useWorkspaceStore.getState().setOristudioCpFoldedFigureDisplayStyle(id, displayStyle)
  );
}

/** One discrete model change (side, shadows, anti-alias) as one entry. */
export function updateFoldedFigureModelAsEntry(
  id: string,
  patch: Partial<OristudioCpFoldedFigureModel>,
  t: TFunction
): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.changeFoldedModel', 'Change folded model'),
    () => useWorkspaceStore.getState().updateOristudioCpFoldedFigureModel(id, patch)
  );
}

/**
 * Move a 3D figure's eye, as one entry. Callers spread the figure's current
 * camera so `orient` survives a yaw or pitch edit — which way the model is up
 * is a property of the model, not of one look at it.
 */
export function setFolded3dCamera(
  id: string,
  camera: FoldedFigureCamera,
  t: TFunction
): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:cpProperties.folded.changeView', 'Change folded model view'),
    () => useWorkspaceStore.getState().setOristudioCpFolded3dCamera(id, camera)
  );
}

/** A typed placement edit (scale, rotation) as one entry, under the gesture's own label. */
export function setFoldedFigurePlacementAsEntry(
  id: string,
  patch: Partial<FoldedFigurePlacement>,
  label: string
): Promise<void | undefined> {
  return foldedFigureGesture.run('verb', label, () =>
    useWorkspaceStore.getState().setOristudioCpFoldedFigurePlacement(id, patch)
  );
}

export function deleteFoldedFigure(id: string, t: TFunction): Promise<void | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.deleteFoldedModelAction', 'Delete folded model'),
    () => useWorkspaceStore.getState().deleteOristudioCpFoldedFigure(id)
  );
}

export function duplicateFoldedFigure(id: string, t: TFunction): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.duplicateFoldedModelAction', 'Duplicate folded model'),
    () => useWorkspaceStore.getState().duplicateOristudioCpFoldedFigure(id)
  );
}

/** Let go of the layer constraints a reload found detached (Dismiss, beside Review…), as one entry. */
export function dismissFoldedFigureDetachedLayerOrder(id: string, t: TFunction): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:foldedFigureActions.dismissDetachedLayerOrderAction', 'Dismiss layer constraints'),
    () => useWorkspaceStore.getState().dismissOristudioCpFigureDetachedLayerOrder(id)
  );
}

/**
 * Refold a figure from its creases as they are now, as one entry: in its
 * chosen layer order when it has one (H4), saying what that came to
 * (`foldedFigureLayerOrderToasts.ts`).
 */
export function refoldFoldedFigure(id: string, t: TFunction): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.refoldFoldedModelAction', 'Refold folded model'),
    () =>
      useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(id, {
        onLayerOrder: (outcome) => {
          const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures.find((entry) => entry.id === id);
          sayFoldedFigureLayerOrderRefold(outcome, figure?.title ?? '', t);
        },
      })
  );
}

/**
 * On to the next layer order, or past the last back to the first, as one
 * entry. On a constrained figure, on to the next solution that fits its
 * constraints instead ({@link stepConstrainedFoldedSolution}).
 */
export function showAnotherFoldedSolution(id: string, t: TFunction): Promise<boolean | undefined> {
  if (isConstrainedFigure(id)) return stepConstrainedFoldedSolution(id, 'next', t);
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.anotherSolutionAction', 'Show another solution'),
    () => useWorkspaceStore.getState().foldAnotherOristudioCpFigure(id)
  );
}

/** Whether figure `id` shows a chosen layer order this build reads: it steps within its constraints (H6). */
function isConstrainedFigure(id: string): boolean {
  const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures.find((entry) => entry.id === id);
  return figure !== undefined && foldedFigureLayerOrderHold(figure) === 'record';
}

/**
 * Another solution, or back one, on a constrained figure (row H6, D9), as
 * one entry under the same labels as an unconstrained figure's: through the
 * solutions that fit its record, on the host engine's cursor, which the first
 * press makes (`foldedSolutionCursor.ts`). A press that moves nothing writes
 * nothing, and says why when the reason is news ({@link sayFoldedSolutionStep}).
 * `tries` counts the user's Keep trying after running out of time.
 */
export function stepConstrainedFoldedSolution(
  id: string,
  direction: 'next' | 'previous',
  t: TFunction,
  { tries = 0 }: { tries?: number } = {}
): Promise<boolean | undefined> {
  const label =
    direction === 'next'
      ? t('panels:creasePattern.anotherSolutionAction', 'Show another solution')
      : t('panels:creasePattern.previousSolutionAction', 'Show previous solution');
  return foldedFigureGesture.run('verb', label, async () => {
    const step = await useWorkspaceStore.getState().stepOristudioCpFigureLayerOrder(id, direction, { tries });
    sayFoldedSolutionStep(step, t, () => void stepConstrainedFoldedSolution(id, direction, t, { tries: tries + 1 }), tries);
    return step.status === 'moved';
  });
}

/**
 * The toast ids of a step's messages, by how many times the user has kept
 * trying: presses at the same try replace one another, and each Keep trying
 * gets a fresh one. Clicking Keep trying dismisses its toast, and a toast
 * shown again under that id while it leaves is lost in its exit.
 *
 * A calm message (running out of time) and an error each have an id of their
 * own: sonner keeps what an id last showed and merges a new toast into it, so
 * a message under an id that once held an error would be drawn as the error.
 * Showing either dismisses the other, so presses still replace one another.
 */
function stepToastIds(tries: number): { readonly error: string; readonly calm: string } {
  const error = `layer-order-step-${tries}`;
  return { error, calm: `${error}-timed-out` };
}

/**
 * What a constrained step that moved nothing says, if anything:
 *
 * - the engine didn't load, with Reload, the only retry there is (offline:
 *   reconnect first), or it stopped;
 * - the record couldn't be checked in time (D10), or the search for the next
 *   solution ran out (E9's `timed_out`): each a calm message, not an error,
 *   with Keep trying, which asks again that way with a longer deadline
 *   (`keepTrying`), and the step goes on from what it proved;
 * - its constraints need attention; or the next solution is too large to save.
 *
 * An end (proved since E9: asking again gains nothing), a Stop, a figure that
 * moved on, or one that can't step now says nothing: the pager waits at the
 * end and shows where it stands, and the rest the user did or already sees.
 * A fold the kernel couldn't draw said so through the store.
 */
export function sayFoldedSolutionStep(
  step: OristudioCpFigureSolutionStep,
  t: TFunction,
  keepTrying: () => void,
  tries = 0
): void {
  const keepTryingAction = {
    label: t('dialogs:layerOrder.keepTrying', 'Keep trying'),
    onClick: keepTrying,
  };
  const ids = stepToastIds(tries);
  const sayError = (text: string, action?: { label: string; onClick: () => void }) => {
    toast.dismiss(ids.calm);
    toast.error(text, { id: ids.error, ...(action ? { action } : {}) });
  };
  switch (step.status) {
    case 'lost':
      if (step.cause === 'load') {
        // Only a reload retries a load that failed (`layerOrderReloadAction`).
        sayError(
          layerOrderOffline()
            ? t(
                'toasts:layerOrder.stepLostLoadOffline',
                'Layer order couldn’t load while offline, so the figure wasn’t changed. Reconnect, then reload Ori Studio to try again.'
              )
            : t(
                'toasts:layerOrder.stepLostLoadReload',
                'Layer order couldn’t load, so the figure wasn’t changed. Reload Ori Studio to try again.'
              ),
          layerOrderReloadAction(t)
        );
        return;
      }
      sayError(t('toasts:layerOrder.stepLost', 'Layer order stopped unexpectedly, so the figure wasn’t changed.'));
      return;
    case 'timed_out':
      // Running out of time is an answer, not a fault: said calmly, as the press's other expected
      // stops are (`layerOrderPressToasts.ts`), under an id no error has held.
      toast.dismiss(ids.error);
      toast.message(
        step.stage === 'restore'
          ? t(
              'toasts:layerOrder.stepCheckTimedOut',
              'Couldn’t check this figure’s layer constraints in time, so it wasn’t changed.'
            )
          : t('toasts:layerOrder.stepNotFoundInTime', 'Couldn’t find another solution in time, so the figure wasn’t changed.'),
        { id: ids.calm, action: keepTryingAction }
      );
      return;
    case 'unrestored':
      sayError(
        t(
          'toasts:layerOrder.stepUnrestored',
          'This figure’s layer constraints need attention, so it can’t step through solutions. Open Layer order… to review them.'
        )
      );
      return;
    case 'too-large':
      sayError(
        t('errors:cp.layerOrderTooLarge', 'This layer order is too large to save with the figure, so it is unchanged.')
      );
      return;
    case 'moved':
    case 'end':
    case 'not-drawn':
    case 'stopped':
    case 'blocked':
      return;
  }
}

/**
 * Back one layer order on a flat figure, by fold case, as one entry: the
 * kernel restarts the enumeration and replays it to the case before
 * (`foldOristudioCpFigureToCase`), as the Diagram's ‹ goes back. Counted as
 * Another solution is (`fold solution cycled`), with the solutions known
 * once it lands. Refused on the first, and on a 3D figure, which has no
 * numbered solutions to go back to. On a constrained figure, back one
 * solution that fits its constraints instead ({@link stepConstrainedFoldedSolution}).
 */
export function showPreviousFoldedSolution(id: string, t: TFunction): Promise<boolean | undefined> {
  if (isConstrainedFigure(id)) return stepConstrainedFoldedSolution(id, 'previous', t);
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.previousSolutionAction', 'Show previous solution'),
    async () => {
      const store = useWorkspaceStore.getState();
      const figure = store.oristudioCpFoldedFigures.find((entry) => entry.id === id);
      const current = foldedFigureCurrentCase(figure);
      if (!figure || !foldedFigureCapabilities(figure).foldToCase || current <= 1) return false;
      const moved = await store.foldOristudioCpFigureToCase(id, current - 1);
      if (moved) {
        const landed = useWorkspaceStore
          .getState()
          .oristudioCpFoldedFigures.find((entry) => entry.id === id);
        track(ANALYTICS_EVENTS.foldSolutionCycled, {
          direction: 'previous',
          solution_count_bucket: bucketCount(foldedFigureFrontier(landed).cases, COUNT_BUCKETS),
        });
      }
      return moved;
    }
  );
}

/** Open the export dialog on the figure alone: not an undo step, since saving a file changes nothing. */
export function exportFoldedFigure(id: string, t: TFunction): void {
  void openFoldedFigureExport(id, t);
}
