/**
 * The one door into the Layer order dialog (`implementation-plans/layer-order-dialog.md`,
 * row U4). Edit's figures and selection (H3, H5), a Diagram step (H7), Pose
 * (H8) and Fold's Import CP (H10) each build a `LayerOrderRequest` and call
 * {@link openLayerOrderDialog}; nothing else outside the dialog imports any
 * of it, and nothing at all but this module imports the dialog's component
 * (`layerOrderBoundary.test.ts`).
 *
 * **Nothing loads with the page** (approach 5). This module is a few lines
 * and imports no engine and no dialog code: the dialog's chunk (its
 * component, the session hook, the engine runtime and comlink) comes in one
 * `import()` on the first open, and the engine's worker, with the Fold wasm,
 * only when the dialog mounts and opens its session. Opening and closing the
 * workspace, a file, a render or a selection load none of it.
 * {@link prefetchLayerOrderDialog} loads the code ahead of an intent (a menu
 * opening) and never spawns a worker.
 *
 * **Every open answers**, never rejects (`LayerOrderDialogOutcome`): only
 * `applied` writes. A host that gets anything else leaves its document as it
 * was.
 */
import i18n from '../../i18n';
import { lazyModule } from '../../lib/lazyModule';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { reportError } from '../../monitoring';
import type * as LayerOrderDialogChunk from '../../components/layer-order/LayerOrderDialog';
import { isLayerOrderLoadFailure, sayLayerOrderUnavailable } from '../engine/layerOrderLoadFailure';
import {
  beginLayerOrderDialog,
  settleLayerOrderDialog,
  useLayerOrderDialogStore,
  type LayerOrderDialogOpening,
  type LayerOrderDialogOutcome,
} from './layerOrderDialogStore';

export type { LayerOrderDialogOpening, LayerOrderDialogOutcome } from './layerOrderDialogStore';
export { registerLayerOrderDialogMount } from './layerOrderDialogStore';

/** The dialog's chunk, as the mount renders it. */
export type LayerOrderDialogModule = typeof LayerOrderDialogChunk;

// A plain `import()`: an open must not reload the page under the user's work;
// its failure is the `unavailable` outcome and the Reload toast below.
const dialog = lazyModule<LayerOrderDialogModule>(() => import('../../components/layer-order/LayerOrderDialog'), {
  reload: false,
});

const CANCELLED: LayerOrderDialogOutcome = { kind: 'cancelled' };

/**
 * Open the Layer order dialog on `request`, and answer how it ended.
 *
 * - `applied`: commit `outcome.applied` (one fold with its relations on its
 *   source, one undo step, its record saved);
 * - `unchanged`, `cancelled`: write nothing;
 * - `busy`: another Layer order dialog is open, and this ask opened nothing;
 * - `unavailable`: the dialog's code did not load (offline); the user has
 *   been told, so the host says nothing more.
 *
 * **A host can withdraw its ask** (`options.signal`): when the signal aborts,
 * the dialog closes and the ask answers `cancelled`, as Cancel does, unless
 * it has answered already. A host whose own state goes away under an open
 * dialog (Import CP's flow, let go) withdraws it, so the dialog never
 * outlives what its Apply would land in. A signal already aborted opens
 * nothing.
 */
export function openLayerOrderDialog(
  request: LayerOrderRequest,
  options: { readonly signal?: AbortSignal } = {}
): Promise<LayerOrderDialogOutcome> {
  const { signal } = options;
  if (signal?.aborted) return Promise.resolve(CANCELLED);
  const begun = beginLayerOrderDialog(request);
  if (!('opening' in begun)) return Promise.resolve(begun);
  const { id } = begun.opening;
  if (signal) {
    const withdraw = () => withdrawLayerOrderDialog(id);
    signal.addEventListener('abort', withdraw, { once: true });
    void begun.outcome.then(() => signal.removeEventListener('abort', withdraw));
  }
  dialog.load().catch((error: unknown) => {
    // A load that can't reach the server is the browser's, not a defect
    // (`layerOrderLoadFailure.ts`): said once, here, so no host has to, with
    // the user's Reload, never one of ours; reported only when it is something else.
    if (!settleLayerOrderDialog(id, { kind: 'unavailable' })) return;
    if (!isLayerOrderLoadFailure(error)) reportError(error, { surface: 'layer-order:dialog', tags: { call: 'load' } });
    sayLayerOrderUnavailable(i18n.t);
  });
  return begun.outcome;
}

/** Load the dialog's code ahead of a use, with nothing to report if it fails: the open that follows does. Spawns nothing. */
export function prefetchLayerOrderDialog(): void {
  void dialog.load().catch(() => undefined);
}

/** The dialog's code once it has loaded, for the mount's render; never asks for it. */
export function useLoadedLayerOrderDialog(): LayerOrderDialogModule | null {
  return dialog.useLoaded();
}

/**
 * Call `listener` whenever a Layer order dialog opens, from any host, so that
 * engine work a host keeps between presses (Edit's solutions cursor, H6) can
 * let go of its worker rather than sit beside the dialog's. Returns the
 * unsubscribe. Loads nothing.
 */
export function onLayerOrderDialogOpen(listener: () => void): () => void {
  return useLayerOrderDialogStore.subscribe((state, previous) => {
    if (state.opening && state.opening !== previous.opening) listener();
  });
}

/** The opening the app root's mount shows: null until a host opens the dialog, and again once it settles. */
export function useLayerOrderDialogOpening(): LayerOrderDialogOpening | null {
  return useLayerOrderDialogStore((state) => state.opening);
}

/**
 * The dialog of opening `id` crashed: its host hears `cancelled` at once, so
 * it never waits on a dialog that is gone and the next open is not `busy`.
 * For the mount's error boundary. Whether it was still waiting.
 */
export function abandonLayerOrderDialog(id: number): boolean {
  return settleLayerOrderDialog(id, CANCELLED);
}

/**
 * Close the dialog of opening `id` from outside it, as Cancel would: its
 * host hears `cancelled`. For a host withdrawing its ask (`signal`), and for
 * the mount when the route or the workspace changes under the dialog
 * (`LayerOrderDialogMount`). Whether it was still waiting.
 */
export function withdrawLayerOrderDialog(id: number): boolean {
  return settleLayerOrderDialog(id, CANCELLED);
}

export function resetLayerOrderDialogGatewayForTest(): void {
  dialog.resetForTest();
}
