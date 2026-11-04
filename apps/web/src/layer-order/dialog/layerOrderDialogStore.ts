/**
 * Whether the Layer order dialog is open, on which request, and who waits for
 * its answer (`implementation-plans/layer-order-dialog.md`, row U4).
 *
 * Its own store, as Import CP's and the paper export's are. A host opens the
 * dialog through its gateway (`layerOrderDialogGateway.ts`), never here; the
 * app root mounts the dialog while the store holds an opening
 * (`components/layer-order/LayerOrderDialogMount.tsx`). The promise the
 * gateway hands its host is settled here, exactly once, by
 * {@link settleLayerOrderDialog}, and the opening goes with it.
 *
 * **One at a time.** An open while one is open is refused at once (`busy`),
 * never stacked and never put in its place: the dialog holds work (the
 * constraints being built) that a second ask must not throw away. The
 * barrier keeps the workspace's own verbs from asking while it is up; this
 * catches whatever else does.
 *
 * React-free and engine-free: zustand and the contract's types only.
 */
import { create } from 'zustand';
import { dialogOpener } from '../../components/ui/useModalDialog';
import type { LayerOrderApplied, LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';

/**
 * How a Layer order dialog ended, as its host hears it. **Only `applied`
 * writes anything:** a host commits `applied.applied` (one fold with the
 * chosen order, one undo step, the record saved) and does nothing at all for
 * every other outcome.
 *
 * **The turn.** `applied` and `unchanged` carry `turnDeg` when Rotate left the
 * folded pane turned from the request's `look.turnDeg`: the host's convention,
 * degrees clockwise on screen from `look.side`, in [0, 360). The host turns
 * its picture to it with the Apply (one undo step with the order where it
 * can, or its own when Apply wrote no order). A turn writes no record: an
 * Apply that only turned is still `unchanged` (D16). Left out when the turn is
 * the request's; never on any other outcome.
 */
export type LayerOrderDialogOutcome =
  /** Apply, with something to write. */
  | { readonly kind: 'applied'; readonly applied: LayerOrderApplied; readonly turnDeg?: number }
  /** Apply that changed no order: the host writes no layer order (D16), only the turn when there is one. */
  | { readonly kind: 'unchanged'; readonly turnDeg?: number }
  /** Cancel, the close button, Escape, a press on the backdrop, or the app letting go of the dialog. */
  | { readonly kind: 'cancelled' }
  /** Another Layer order dialog is open; this ask never opened one. */
  | { readonly kind: 'busy' }
  /** The dialog could not open: its code would not load (the user is told), or nothing mounts it. */
  | { readonly kind: 'unavailable' };

/** One opening of the dialog: what it opens on and where focus goes back. */
export interface LayerOrderDialogOpening {
  /** Tells one opening from the next, so the dialog starts fresh each time and a late answer finds no one. */
  readonly id: number;
  readonly request: LayerOrderRequest;
  /** Where focus goes back to when the dialog closes: what had it when the host asked. */
  readonly returnFocus: HTMLElement | null;
}

interface LayerOrderDialogState {
  readonly opening: LayerOrderDialogOpening | null;
}

export const useLayerOrderDialogStore = create<LayerOrderDialogState>()(() => ({ opening: null }));

let nextOpeningId = 1;
let pending: { readonly id: number; readonly settle: (outcome: LayerOrderDialogOutcome) => void } | null = null;
let mounts = 0;

const BUSY: LayerOrderDialogOutcome = { kind: 'busy' };
const UNAVAILABLE: LayerOrderDialogOutcome = { kind: 'unavailable' };
const CANCELLED: LayerOrderDialogOutcome = { kind: 'cancelled' };

/** An opening begun: it, and the answer its host waits on. */
export interface LayerOrderDialogBegun {
  readonly opening: LayerOrderDialogOpening;
  readonly outcome: Promise<LayerOrderDialogOutcome>;
}

/**
 * Open the dialog on `request`: the opening, and its answer to come. Or, at
 * once, why not: `busy` while another is open, `unavailable` while nothing
 * mounts the dialog (no app root, as in a host's unit test), so a host's
 * await never hangs.
 */
export function beginLayerOrderDialog(request: LayerOrderRequest): LayerOrderDialogBegun | LayerOrderDialogOutcome {
  if (pending || useLayerOrderDialogStore.getState().opening) return BUSY;
  if (mounts === 0) return UNAVAILABLE;
  const opening: LayerOrderDialogOpening = {
    id: nextOpeningId++,
    request,
    returnFocus: typeof document === 'undefined' ? null : dialogOpener(),
  };
  const outcome = new Promise<LayerOrderDialogOutcome>((resolve) => {
    pending = { id: opening.id, settle: resolve };
  });
  useLayerOrderDialogStore.setState({ opening });
  return { opening, outcome };
}

/**
 * End the opening `id` with `outcome`: its host hears it and the dialog
 * closes. Once only: a second settle, or one for an opening already gone,
 * does nothing. Whether this one settled it.
 */
export function settleLayerOrderDialog(id: number, outcome: LayerOrderDialogOutcome): boolean {
  if (!pending || pending.id !== id) return false;
  const { settle } = pending;
  pending = null;
  if (useLayerOrderDialogStore.getState().opening?.id === id) useLayerOrderDialogStore.setState({ opening: null });
  settle(outcome);
  return true;
}

/**
 * The app root's mount says it is there (`LayerOrderDialogMount`). Returns
 * its leaving: when the last mount goes, an open dialog goes with it and its
 * host hears `cancelled`.
 */
export function registerLayerOrderDialogMount(): () => void {
  mounts += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    mounts = Math.max(0, mounts - 1);
    if (mounts === 0 && pending) settleLayerOrderDialog(pending.id, CANCELLED);
  };
}

export function resetLayerOrderDialogStoreForTest(): void {
  pending = null;
  mounts = 0;
  useLayerOrderDialogStore.setState({ opening: null });
}
