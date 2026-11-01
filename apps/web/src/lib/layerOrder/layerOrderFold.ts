/**
 * A flat fold's Layer order source, and a fold in a chosen order, for every
 * host that folds through the CP kernel's runtime (`CpFoldRuntime`) rather
 * than holding an Edit figure: the Diagram's capture and Pose (rows H7, H8),
 * and the crease-pattern export and share card
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`).
 * Moved here from the Diagram's capture (`diagram/capture/captureLayerOrder.ts`),
 * which binds its step's paper frame; the export binds Edit's, the crease
 * pattern's own coordinates.
 *
 * - **The source** is read from the fold the host made, before it is freed,
 *   never re-derived from the document: the dialog's faces are then the
 *   host's, one for one (approach 2).
 * - **A chosen order** is folded again with its relations, into a new figure
 *   (`fold_with_order`), never a change to a fold the host already holds; a
 *   kernel that cannot draw it refuses with no figure (approach 4).
 *
 * Store-free and React-free: the kernel is injected.
 */
import type {
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldSource,
} from '../../engine/oristudioCpTypes';
import type { LayerOrderLossCause } from '../../layer-order/host/hostEngineGateway';
import { withLayerOrderAttention } from '../../layer-order/host/layerOrderResolution';
import { openFold, type CpFoldRuntime, type FoldedFigureState } from '../cpFoldRuntime';
import { encodeLayerOrderRecord, type LayerOrderAttention, type LayerOrderRecord } from './layerOrderRecord';
import type { LayerOrderApplied, LayerOrderSource } from './layerOrderRequest';
import { kernelFoldSourceOf, layerOrderSourceOf } from './layerOrderSource';
import { layerOrderRecordFromSource, type PaperFrame } from './paperFrame';

/** A record as a host holds it: read, and as it saves it. */
export interface HeldLayerOrder {
  readonly record: LayerOrderRecord;
  readonly json: string;
}

/** The record a host keeps, encoded once; a record past the budget is no answer a host can keep. */
export function keptLayerOrder(record: LayerOrderRecord): HeldLayerOrder {
  const encoded = encodeLayerOrderRecord(record);
  if (!encoded.ok) throw new Error(`The step's layer order cannot be saved (${encoded.reason})`);
  return { record, json: encoded.json };
}

/** `layerOrder` with its summary set (or cleared, for null), as its holder keeps it. */
export function flaggedLayerOrder(layerOrder: HeldLayerOrder, attention: LayerOrderAttention | null): HeldLayerOrder {
  return keptLayerOrder(withLayerOrderAttention(layerOrder.record, attention));
}

/**
 * Where a host keeps its record's points (`paperFrame.ts`), for a fold it
 * just read: from the fold's paper scene, or from the creases the kernel
 * folded when it drew no paper scene of it.
 */
export type PaperFrameOf = (paper: OristudioCpFoldedPaperScene | null, kernel: OristudioCpFoldSource) => PaperFrame;

/** What a fold was made from, as the host engine and the dialog take it. */
export interface FoldSource {
  readonly source: LayerOrderSource;
  /** The host's paper frame, for its record's points. */
  readonly frame: PaperFrame;
  /** The kernel's paper scene of the fold, in the order asked for; null for one it drew none of. */
  readonly scene: OristudioCpFoldedPaperScene | null;
}

/**
 * Fold creases as a capture does — stepped to `foldCase`, the kernel's layer
 * order the host shows, when that is past the first — read what the fold
 * was made from and the paper it lies on ({@link heldFoldSource}), and free
 * it. A fold's source is the same at every case; its scene is the case's.
 */
export async function stepFoldSource(
  runtime: CpFoldRuntime,
  lineIds: readonly number[],
  model: OristudioCpFoldedFigureModel,
  frameOf: PaperFrameOf,
  foldCase = 1
): Promise<FoldSource> {
  if (!runtime.source) throw new Error('This crease kernel cannot say what a fold was made from');
  const folded = await openFold(runtime, [...lineIds], model);
  try {
    if (foldCase > 1) await runtime.foldToCase(folded.handle, foldCase);
    return await heldFoldSource(runtime, folded.handle, model, frameOf);
  } finally {
    await runtime.free(folded.handle);
  }
}

/**
 * What a flat fold someone holds was made from, and the paper it lies on, as
 * it stands — Pose's held fold (H8), in the kernel's order at its case or in a
 * record's (`fold_with_order` folds exactly the source it is given, so its
 * source is the plain fold's). `model` is the one it was folded or last set
 * with; `scene`, its paper scene when the holder has read it already.
 */
export async function heldFoldSource(
  runtime: CpFoldRuntime,
  handle: number,
  model: OristudioCpFoldedFigureModel,
  frameOf: PaperFrameOf,
  scene?: OristudioCpFoldedPaperScene | null
): Promise<FoldSource> {
  if (!runtime.source) throw new Error('This crease kernel cannot say what a fold was made from');
  const kernel = await runtime.source(handle);
  const paper = scene === undefined ? await runtime.paperScene(handle) : scene;
  return { source: layerOrderSourceOf(kernel, model), frame: frameOf(paper, kernel), scene: paper };
}

/** Why a record's order was not drawn: the host engine's answer, or the kernel refusing to draw it. */
export type LayerOrderKeptOutcome = 'clash' | 'timed_out' | 'refused';

/** A fold in a record's order, or why the host keeps its picture. */
export type LayerOrderShown =
  /**
   * Drawn: the new figure, which the caller owns and frees; the record of
   * the order it shows (the host engine's save of it), and its summary.
   */
  | {
      readonly kind: 'shown';
      readonly state: FoldedFigureState;
      readonly layerOrder: HeldLayerOrder;
      readonly attention: LayerOrderAttention | null;
    }
  /** Not drawn (D10): the host keeps its picture, and this record, flagged. */
  | {
      readonly kind: 'kept';
      readonly layerOrder: HeldLayerOrder;
      readonly attention: LayerOrderAttention;
      readonly outcome: LayerOrderKeptOutcome;
    }
  /**
   * The host engine was not there to answer — offline, or it crashed. Nothing
   * was checked, so nothing is kept: the host stays as it was, its record
   * unflagged. `cause` is the host engine's, `load` when the browser did not
   * load it (`isLayerOrderLoadFailure`).
   */
  | { readonly kind: 'lost'; readonly cause: LayerOrderLossCause }
  /** A Stop: nothing to keep. */
  | { readonly kind: 'cancelled' };

/**
 * Fold an order the dialog applied, or the host engine restored, into a new
 * figure: `applied.relations` on `applied.source`, exactly what was analysed.
 * Its record is kept in the host's frame, with the summary it came with —
 * encoded first, so a record that cannot be saved never leaves a figure
 * behind. A kernel that cannot draw the order refuses (a typed refusal, no
 * figure): `kept`, the record flagged with every constraint, which a restore
 * keeps and the dialog's Apply does not.
 */
export async function foldAppliedOrder(
  runtime: CpFoldRuntime,
  applied: LayerOrderApplied,
  model: OristudioCpFoldedFigureModel,
  frame: PaperFrame
): Promise<Exclude<LayerOrderShown, { kind: 'lost' | 'cancelled' }>> {
  if (!runtime.foldWithOrder) throw new Error('This crease kernel cannot fold a given layer order');
  const layerOrder = keptLayerOrder(layerOrderRecordFromSource(applied.record, frame));
  const folded = await runtime.foldWithOrder(kernelFoldSourceOf(applied.source), applied.relations, model);
  if (folded.status === 'refused') {
    const attention: LayerOrderAttention = { reason: 'unresolved', count: applied.record.constraints.length };
    return { kind: 'kept', layerOrder: flaggedLayerOrder(layerOrder, attention), attention, outcome: 'refused' };
  }
  const { status: _folded, ...state } = folded;
  return { kind: 'shown', state, layerOrder, attention: applied.record.attention ?? null };
}
