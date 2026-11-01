/**
 * A Diagram step's chosen layer order, folded
 * (`implementation-plans/layer-order-dialog.md`, row H7): a linked step whose
 * source carries a record (`DiagramCpSource.layerOrder`) is drawn in the
 * record's order wherever its flat fold is captured — Refresh, Refresh All,
 * Show as, Duplicate, its faces on the paper, Pose's held fold — never in
 * the kernel's first order.
 *
 * - **Restore, then fold with the order.** The step's creases are folded as
 *   every capture folds them, for the source the kernel folded and the
 *   paper's frame; the host engine restores the record onto that source
 *   (`layer-order/host/`, injected as a {@link CaptureLayerOrderResolve}),
 *   and an order that applied is folded again with its relations, into a new
 *   figure (`fold_with_order`). That figure is what is drawn.
 * - **D10.** Anything else keeps the step's picture: the record comes back
 *   flagged with the summary the step shows at rest (`attention`); nothing is
 *   applied greedily and nothing is dropped. A Stop keeps nothing.
 * - **The paper frame.** A step keeps its record's points about the centre of
 *   its paper's box (`paperBoxCentre`), the frame its faces on the paper are
 *   kept in, so a step whose region moved keeps its record. The host engine
 *   and the dialog take them in the crease pattern's coordinates, through the
 *   frame, once, here.
 *
 * Store-free and React-free: the kernel and the host engine are injected.
 */
import type {
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldSource,
} from '../../engine/oristudioCpTypes';
import type { LayerOrderLossCause, LayerOrderResolution } from '../../layer-order/host/hostEngineGateway';
import { routed3dLayerOrderRecord, withLayerOrderAttention } from '../../layer-order/host/layerOrderResolution';
import { NEWER } from '../../lib/documentFile';
import { keyDigest } from '../../lib/keyDigest';
import { openFold, type CpFoldRuntime, type FoldedFigureState } from '../../lib/creaseExportFold';
import {
  encodeLayerOrderRecord,
  readLayerOrderRecord,
  type LayerOrderAttention,
  type LayerOrderRecord,
} from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderApplied, LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { kernelFoldSourceOf, layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import {
  layerOrderRecordFromSource,
  layerOrderRecordToSource,
  paperFrameAbout,
  type PaperFrame,
} from '../../lib/layerOrder/paperFrame';
import { paperBoxCentre } from './capturePaperFaces';

/** A step's record as this build reads it, and as its source keeps it. */
export interface StepLayerOrder {
  readonly record: LayerOrderRecord;
  readonly json: string;
}

/**
 * The record a step's source keeps, read; null when it keeps none. A newer
 * build's locks its step (`diagramFile.ts`), which is never captured, and
 * one that does not read was dropped as the file loaded: neither reaches a
 * capture, and both read as none here.
 */
export function stepLayerOrderOf(layerOrder: string | undefined): StepLayerOrder | null {
  if (layerOrder === undefined) return null;
  const read = readLayerOrderRecord(layerOrder);
  return read !== NEWER && read.ok ? { record: read.record, json: read.json } : null;
}

/** What a record says at rest: how many constraints, and its summary. */
export interface LayerOrderSummary {
  readonly constraints: number;
  readonly attention: LayerOrderAttention | null;
}

/** A source with a record or none: a step's `DiagramCpSource`, or any object that keeps one as it does. */
type LayerOrderHolder = { readonly layerOrder?: string };

/** What a source's record says, read once: its summary, and the order it draws as a key once asked. */
interface LayerOrderReading {
  /** The text it was read from: the source's own, so keeping it costs nothing. */
  readonly text: string;
  readonly summary: LayerOrderSummary | null;
  orderKey?: string;
}

/**
 * Readings by source object. A source is never changed in place, so its
 * reading holds while it does, and goes with it: nothing here outlives the
 * diagram's steps and their undo history.
 */
const readings = new WeakMap<LayerOrderHolder, LayerOrderReading>();

function readingOf(source: LayerOrderHolder, text: string): LayerOrderReading {
  const known = readings.get(source);
  if (known && known.text === text) return known;
  const read = stepLayerOrderOf(text);
  const reading: LayerOrderReading = {
    text,
    summary: read ? { constraints: read.record.constraints.length, attention: read.record.attention ?? null } : null,
  };
  readings.set(source, reading);
  return reading;
}

/**
 * What a source's record says at rest, read from saved data alone, for a
 * surface drawn often (a card, the Step pane): its constraints and its
 * summary; null for none, or one that does not read. Read once per source.
 */
export function layerOrderSummaryOf(source: LayerOrderHolder | null | undefined): LayerOrderSummary | null {
  const text = source?.layerOrder;
  return source && text !== undefined ? readingOf(source, text).summary : null;
}

/**
 * The order a source's record draws, as a key: a digest of its faces and
 * their order, which are all a picture is drawn from; null for a source with
 * none. What its constraints say, or a summary, draws nothing. One this build
 * cannot read keys by its text, so only the same text is the same order.
 */
export function layerOrderKeyOf(source: LayerOrderHolder): string | null {
  const text = source.layerOrder;
  if (text === undefined) return null;
  const reading = readingOf(source, text);
  if (reading.orderKey === undefined) {
    const read = stepLayerOrderOf(text);
    reading.orderKey = read
      ? keyDigest([JSON.stringify([read.record.faces, read.record.order])], 'loo1:')
      : `unread:${layerOrderDigestOf(text)}`;
  }
  return reading.orderKey;
}

/**
 * A short digest of a record's text (`keyDigest`, 64 bits): how a key names a
 * record, a few dozen characters however large it is. Every change to the
 * text is another digest. Kept for the texts asked about last, up to
 * {@link DIGESTED_CHARS} of them, so the step open in Pose, keyed as its
 * spread's sliders move, hashes its record once.
 */
export function layerOrderDigestOf(layerOrder: string): string {
  const known = digests.get(layerOrder);
  if (known !== undefined) return known;
  const digest = keyDigest([layerOrder], 'lo1:');
  digests.set(layerOrder, digest);
  digestedChars += layerOrder.length;
  // The oldest go first; the text just digested always stays.
  for (const [text] of digests) {
    if (digestedChars <= DIGESTED_CHARS || digests.size === 1) break;
    digests.delete(text);
    digestedChars -= text.length;
  }
  return digest;
}

const digests = new Map<string, string>();
let digestedChars = 0;
/** About 4 MB of record text: a few of the largest records, or hundreds of usual ones. */
const DIGESTED_CHARS = 2 * 1024 * 1024;

/** `layerOrder` with its summary set (or cleared, for null), as its source keeps it. */
export function flaggedLayerOrder(layerOrder: StepLayerOrder, attention: LayerOrderAttention | null): StepLayerOrder {
  return keptLayerOrder(withLayerOrderAttention(layerOrder.record, attention));
}

/**
 * A step's record once its creases fold in 3D (D13): kept, with every
 * constraint waiting until they fold flat again; already so, as it was.
 */
export function routed3dLayerOrder(layerOrder: StepLayerOrder): StepLayerOrder {
  const routed = routed3dLayerOrderRecord(layerOrder.record);
  return routed === layerOrder.record ? layerOrder : keptLayerOrder(routed);
}

/**
 * The host engine, as a capture asks it: restore `record` (its points in the
 * crease pattern's coordinates) onto `source`, the fold the kernel just made.
 * Bound by the store to a single resolve or to Refresh All's batch
 * (`hostEngineGateway.ts`); `stop` is the capture's fold run's, so its Stop
 * terminates the resolve's worker too.
 */
export type CaptureLayerOrderResolve = (
  source: LayerOrderSource,
  record: LayerOrderRecord,
  stop: AbortSignal | undefined
) => Promise<LayerOrderResolution>;

/** A Diagram step's paper frame: crease-pattern units about the centre of its paper's box, as its faces are kept. */
export function diagramLayerOrderFrame(scene: Pick<OristudioCpFoldedPaperScene, 'sheet_points'>): PaperFrame {
  return paperFrameAbout(paperBoxCentre(scene));
}

/** The same frame, for a fold the kernel drew no paper scene of: the box of the creases it folded. */
function segmentsFrame(source: OristudioCpFoldSource): PaperFrame {
  const sheet_points = source.segments.flatMap((segment) => [segment.a, segment.b]);
  return diagramLayerOrderFrame({ sheet_points });
}

/** What a fold of a step's creases was made from, as the host engine and the dialog take it. */
export interface StepFoldSource {
  readonly source: LayerOrderSource;
  /** The step's paper frame, for its record's points. */
  readonly frame: PaperFrame;
  /** The kernel's paper scene of the fold, in the order asked for; null for one it drew none of. */
  readonly scene: OristudioCpFoldedPaperScene | null;
}

/**
 * Fold a step's creases as a capture does — stepped to `foldCase`, the
 * kernel's layer order the step shows, when that is past the first — read
 * what the fold was made from and the paper it lies on ({@link heldFoldSource}),
 * and free it. A fold's source is the same at every case; its scene is the case's.
 */
export async function stepFoldSource(
  runtime: CpFoldRuntime,
  lineIds: readonly number[],
  model: OristudioCpFoldedFigureModel,
  foldCase = 1
): Promise<StepFoldSource> {
  if (!runtime.source) throw new Error('This crease kernel cannot say what a fold was made from');
  const folded = await openFold(runtime, [...lineIds], model);
  try {
    if (foldCase > 1) await runtime.foldToCase(folded.handle, foldCase);
    return await heldFoldSource(runtime, folded.handle, model);
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
  scene?: OristudioCpFoldedPaperScene | null
): Promise<StepFoldSource> {
  if (!runtime.source) throw new Error('This crease kernel cannot say what a fold was made from');
  const kernel = await runtime.source(handle);
  const paper = scene === undefined ? await runtime.paperScene(handle) : scene;
  return {
    source: layerOrderSourceOf(kernel, model),
    frame: paper && paper.sheet_points.length > 0 ? diagramLayerOrderFrame(paper) : segmentsFrame(kernel),
    scene: paper,
  };
}

/** Why a record's order was not drawn: the host engine's answer, or the kernel refusing to draw it. */
export type LayerOrderKeptOutcome = 'clash' | 'timed_out' | 'refused';

/** A fold in a record's order, or why the step keeps its picture. */
export type LayerOrderShown =
  /**
   * Drawn: the new figure, which the caller owns and frees; the record of
   * the order it shows (the host engine's save of it), and its summary.
   */
  | {
      readonly kind: 'shown';
      readonly state: FoldedFigureState;
      readonly layerOrder: StepLayerOrder;
      readonly attention: LayerOrderAttention | null;
    }
  /** Not drawn (D10): the step keeps its picture, and this record, flagged. */
  | {
      readonly kind: 'kept';
      readonly layerOrder: StepLayerOrder;
      readonly attention: LayerOrderAttention;
      readonly outcome: LayerOrderKeptOutcome;
    }
  /**
   * The host engine was not there to answer — offline, or it crashed. Nothing
   * was checked, so nothing is kept: the step stays as it was, its record
   * unflagged. `cause` is the host engine's, `load` when the browser did not
   * load it (`isLayerOrderLoadFailure`).
   */
  | { readonly kind: 'lost'; readonly cause: LayerOrderLossCause }
  /** A Stop: nothing to keep. */
  | { readonly kind: 'cancelled' };

/** The record a step saves, encoded once; a record past the budget is no answer the step can keep. */
function keptLayerOrder(record: LayerOrderRecord): StepLayerOrder {
  const encoded = encodeLayerOrderRecord(record);
  if (!encoded.ok) throw new Error(`The step's layer order cannot be saved (${encoded.reason})`);
  return { record, json: encoded.json };
}

/**
 * Fold a step's creases in its record's order: restore it, then fold its
 * relations into a new figure. `model` is the capture's (`captureModel`): its
 * side, at no turn and no scale.
 */
export async function foldWithLayerOrder(
  runtime: CpFoldRuntime,
  lineIds: readonly number[],
  model: OristudioCpFoldedFigureModel,
  layerOrder: StepLayerOrder,
  resolve: CaptureLayerOrderResolve,
  stop?: AbortSignal
): Promise<LayerOrderShown> {
  const { source, frame } = await stepFoldSource(runtime, lineIds, model);
  const resolution = await resolve(source, layerOrderRecordToSource(layerOrder.record, frame), stop);
  if (resolution.outcome === 'cancelled') return { kind: 'cancelled' };
  // Never saved as "couldn't be checked in time": nothing was checked.
  if (resolution.outcome === 'lost') return { kind: 'lost', cause: resolution.cause };
  if (resolution.outcome !== 'applied') {
    // The record asked about, as the step keeps it: its points never go through the frame and back.
    const attention = resolution.attention ?? { reason: 'unresolved', count: layerOrder.record.constraints.length };
    return { kind: 'kept', layerOrder: flaggedLayerOrder(layerOrder, attention), attention, outcome: resolution.outcome };
  }
  const shown = await foldAppliedOrder(runtime, resolution.applied, model, frame);
  if (shown.kind === 'shown') return { ...shown, attention: resolution.attention };
  // The record asked about, flagged, as for any order not drawn.
  return { ...shown, layerOrder: flaggedLayerOrder(layerOrder, shown.attention) };
}

/**
 * Fold an order the dialog applied, or the host engine restored, into a new
 * figure: `applied.relations` on `applied.source`, exactly what was analysed.
 * Its record is saved in the step's frame, with the summary it came with —
 * encoded first, so a record that cannot be saved never leaves a figure
 * behind. A kernel that cannot draw the order refuses (a typed refusal, no
 * figure): `kept`, the record flagged with every constraint, which a restore
 * keeps and the dialog's Apply does not (`captureInLayerOrder`).
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

/**
 * A fold that was asked for in a record's order and was not drawn in it,
 * thrown through a Pose verb, whose session holds the fold, for its
 * controller: `kept`, the step keeps its picture and the flagged record
 * (D10); `lost`, the host engine was not there and nothing is kept; null for
 * a Stop.
 */
export class LayerOrderNotShownError extends Error {
  constructor(readonly why: Extract<LayerOrderShown, { kind: 'kept' | 'lost' }> | null) {
    super(why ? 'The step’s layer order could not be drawn' : 'The step’s layer order was stopped');
    this.name = 'LayerOrderNotShownError';
  }
}
