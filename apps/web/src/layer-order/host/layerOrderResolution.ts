/**
 * What the host engine answers (`implementation-plans/layer-order-dialog.md`,
 * row H2): a saved record restored onto a host's creases as they are now,
 * with no dialog open. Edit's refold and reopen, the Diagram's capture and
 * Refresh, and Pose ask it (`hostEngineGateway.ts`), then fold the answer's
 * relations through their own kernel (approach 4).
 *
 * **Every answer is plain data, never a rejection.** A restore that applied,
 * one whose constraints clash, one that ran out of time, a refusal, an engine
 * that went away, and a Stop are each an outcome. All but a Stop say what the
 * host keeps: the record to store and the summary in its `attention`, which
 * the host shows at rest without the engine (D10, D11).
 *
 * **D10.** Only `applied` changes the picture. On a clash, a timeout, a
 * refusal or a lost engine the host keeps its old picture and stores the
 * record it had, flagged; nothing is applied greedily and nothing is dropped.
 * The dialog recomputes the statuses whenever it opens (D14), so only the
 * summary is stored.
 *
 * Types and pure helpers. React-free, store-free and engine-free.
 */
import type {
  LayerBudgetLimit,
  LayerCarriedRow,
  LayerOpenedOn,
  LayerRefusal,
  LayerSavedConstraintStatus,
} from '../engine/layerOrderEngine';
import type { LayerOrderAttention, LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderApplied } from '../../lib/layerOrder/layerOrderRequest';

/** What a restore found of the record, part by part: what the dialog shows as rows. */
export interface LayerOrderFound {
  /** Per saved constraint, in record order: intact, ambiguous, gone or clashing. */
  readonly saved_constraints: readonly LayerSavedConstraintStatus[];
  /** Every saved constraint not applied, in record order, as `save` writes it back. */
  readonly carried: readonly LayerCarriedRow[];
  /** Where the order the restore shows came from: the saved order held, or the closest that fits. */
  readonly opened_on: LayerOpenedOn;
}

/** What the host keeps, whatever the outcome but a Stop. */
export interface LayerOrderKept {
  /**
   * The record to store, with its points in the crease pattern's coordinates
   * (`paperFrame.ts`): on `applied`, the session's own save of the order
   * now shown; otherwise the record asked about. Either way its `attention`
   * is {@link LayerOrderKept.attention}, left out when that is null.
   */
  readonly record: LayerOrderRecord;
  /** The summary the host shows at rest; null when nothing needs a look. */
  readonly attention: LayerOrderAttention | null;
}

/** Why the engine was not there to answer. */
export type LayerOrderLossCause =
  /**
   * The browser failed to load the engine's code, its worker or its wasm
   * (offline, a stale deploy; `engine/layerOrderLoadFailure.ts`): reported to
   * no one, and what a host says "check your connection" for.
   */
  | 'load'
  /** The worker died or its engine trapped (reported by the runtime, `layer-order:engine`). */
  | 'crashed'
  /** The engine did not start for a defect, its code or its wasm there: reported once. */
  | 'unavailable'
  /** The engine failed a call for a defect, not the user's fold. */
  | 'failed';

export type LayerOrderResolution =
  /**
   * The intact constraints fit: `applied` is what the host folds and commits,
   * as it commits the dialog's Apply (`fold_with_order` on `applied.source`
   * with `applied.relations`, then `applied.record`, the same as `record`).
   */
  | (LayerOrderKept & {
      readonly outcome: 'applied';
      readonly applied: LayerOrderApplied;
      readonly found: LayerOrderFound;
    })
  /** The intact constraints have no order together; `clashing` are the record's indices of those the proof names. */
  | (LayerOrderKept & {
      readonly outcome: 'clash';
      readonly clashing: readonly number[];
      readonly found: LayerOrderFound;
    })
  /**
   * The check ran out, and so did every retry asked for. `found` is null when
   * the open itself ran out, before any face was looked for.
   */
  | (LayerOrderKept & {
      readonly outcome: 'timed_out';
      readonly limit: LayerBudgetLimit;
      readonly nodes: number;
      readonly found: LayerOrderFound | null;
    })
  /** The engine can't analyse the creases now (or the record): an answer, by code. */
  | (LayerOrderKept & { readonly outcome: 'refused'; readonly refusal: LayerRefusal })
  /** The engine went away, or never came: reported once, never thrown. */
  | (LayerOrderKept & { readonly outcome: 'lost'; readonly cause: LayerOrderLossCause })
  /** A Stop: the host puts back what it had, quietly, and stores nothing. */
  | { readonly outcome: 'cancelled' };

/** The outcomes that store something, with what the summary is read from. */
export type LayerOrderAttentionAsked =
  | { readonly outcome: 'applied' | 'clash'; readonly found: LayerOrderFound }
  | { readonly outcome: 'timed_out' | 'refused' | 'lost' };

/** How many of the record's constraints a restore did not find intact: clashing, ambiguous or gone. */
function notIntact(found: LayerOrderFound): number {
  return found.saved_constraints.filter((saved) => saved.status !== 'intact').length;
}

/**
 * The summary a host stores, by outcome (D10, D11):
 *
 * - `applied`: the constraints left out (ambiguous or gone) are `unresolved`;
 *   with none left out, nothing needs a look;
 * - `clash`: `conflict`, counting every constraint not intact, the clashing
 *   ones and any ambiguous or gone;
 * - `timed_out` and `lost`: `timeout` ("couldn't check"), counting every
 *   constraint, since none was applied;
 * - `refused`: `unresolved`, counting every constraint.
 */
export function layerOrderAttentionOf(
  asked: LayerOrderAttentionAsked,
  record: LayerOrderRecord
): LayerOrderAttention | null {
  switch (asked.outcome) {
    case 'applied': {
      const count = notIntact(asked.found);
      return count > 0 ? { reason: 'unresolved', count } : null;
    }
    case 'clash':
      return { reason: 'conflict', count: notIntact(asked.found) };
    case 'timed_out':
    case 'lost':
      return { reason: 'timeout', count: record.constraints.length };
    case 'refused':
      return { reason: 'unresolved', count: record.constraints.length };
  }
}

/** `record` with `attention` set, or with none when it is null. */
export function withLayerOrderAttention(record: LayerOrderRecord, attention: LayerOrderAttention | null): LayerOrderRecord {
  const { attention: _was, ...rest } = record;
  return attention ? { ...rest, attention } : rest;
}

/** Whether two stored summaries say the same: what a host's `layer constraints need attention` waits on changing. */
export function sameLayerOrderAttention(a: LayerOrderAttention | null, b: LayerOrderAttention | null): boolean {
  return a === b || (a !== null && b !== null && a.reason === b.reason && a.count === b.count);
}

/**
 * A record once its host's creases fold in 3D (D13): kept, with every
 * constraint waiting until they fold flat again; the very record when it says
 * so already.
 */
export function routed3dLayerOrderRecord(record: LayerOrderRecord): LayerOrderRecord {
  const count = record.constraints.length;
  if (record.attention?.reason === 'route-3d' && record.attention.count === count) return record;
  return withLayerOrderAttention(record, { reason: 'route-3d', count });
}

/** What the host keeps of `record` after `asked`: the record, flagged with its summary. */
export function keptLayerOrder(asked: LayerOrderAttentionAsked, record: LayerOrderRecord): LayerOrderKept {
  const attention = layerOrderAttentionOf(asked, record);
  return { record: withLayerOrderAttention(record, attention), attention };
}

/** The engine went away or never came: the host keeps `record`, flagged. */
export function lostLayerOrder(cause: LayerOrderLossCause, record: LayerOrderRecord): LayerOrderResolution {
  return { outcome: 'lost', cause, ...keptLayerOrder({ outcome: 'lost' }, record) };
}

/** A Stop's answer. */
export const LAYER_ORDER_CANCELLED: LayerOrderResolution = Object.freeze({ outcome: 'cancelled' });
