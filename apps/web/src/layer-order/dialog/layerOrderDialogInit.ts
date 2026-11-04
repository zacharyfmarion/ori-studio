/**
 * What a host's request decides about the dialog, read in one place: the
 * inspector's reducer init (`LayerOrderDialogInit`, spread in by
 * `useLayerOrderDialog`), whose model alone decides what Apply writes (D16).
 * Read anywhere else, a decider could drift from it: an untouched Apply on a
 * stale figure's record (D12) or a flagged one (D10) must write, and an
 * opening from Review… (D14) must open on the flagged rows.
 *
 * Pure: a request in, plain values out.
 */
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { untouchedApplyWrites } from '../model/layerOrderDecisions';
import type { LayerOrderDialogInit } from '../model/layerOrderState';

/** The init fields a request decides; the host's surface and the hook's clock are the caller's. */
export type LayerOrderRequestInit = Pick<LayerOrderDialogInit, 'hasRecord' | 'recordNeedsAttention' | 'review' | 'xray'>;

/**
 * The reducer's init, as far as the request decides it:
 *
 * - `hasRecord`: the session restores a saved record, else opens on the host's order;
 * - `recordNeedsAttention`: even an untouched Apply writes
 *   (`untouchedApplyWrites`): the record was flagged after an edit, or the
 *   host's picture is of creases that changed since (`applyRefolds`);
 * - `review`: opened from the host's Review…, so on the flagged rows;
 * - `xray`: the host's look.
 */
export function layerOrderRequestInit(request: LayerOrderRequest): LayerOrderRequestInit {
  return {
    hasRecord: request.record !== null,
    recordNeedsAttention: untouchedApplyWrites(request.record, request.applyRefolds),
    review: request.review === true,
    xray: request.look.xray,
  };
}
