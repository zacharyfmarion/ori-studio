import type { ConnectedSpreadView } from '../../layer-spread/view';
import type { SpreadPresentation } from '../../layer-spread/presentation';
import { captureFlatScenePicture } from './captureFolded';
import { prepareConnected, type ConnectedLease } from '../../layer-spread/prepareConnected';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
/**
 * A fold held open while a linked step is posed (D4): the figure is folded once,
 * then turned over, stepped to another solution and read again on the same
 * kernel handle, where a Refresh folds from scratch every time. What it read
 * is kept until the fold changes, so turning the picture or spreading its
 * layers (Phase 13) draws it again with no call to the kernel at all.
 *
 * The session owns its handle through the shared registry (`retain` /
 * `release`), so a document replaced or an engine reset under it frees or
 * forgets it there; it checks the registry's epoch before every use and folds
 * again when the space it was folded in is gone. It never folds anything into
 * Edit: its figure is its own.
 *
 * React-free and store-free: the kernel and the registry are injected.
 */
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFold3dRefusal,
  OristudioCpFolded3dAuxLines,
} from '../../engine/oristudioCpTypes';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { hasFoldedLayerOrder, openFold, readFoldedPicture, type FoldedFigureState, type FoldedPicture } from '../../lib/creaseExportFold';
import type { LayerOrderAttention } from '../../lib/layerOrder/layerOrderRecord';
import {
  advanceSolutionFrontier,
  frontierSolutions,
  solutionFrontierKnowing,
  UNSEARCHED_FRONTIER,
  type SolutionFrontier,
} from '../../lib/layerOrderPlace';
import type { LayerOrderApplied } from '../../lib/layerOrder/layerOrderRequest';
import type { PaperFrame } from '../../lib/layerOrder/paperFrame';
import type { DiagramStyle } from '../document/diagramDocument';
import {
  foldAppliedOrder,
  foldWithLayerOrder,
  heldFoldSource,
  layerOrderDigestOf,
  LayerOrderNotShownError,
  type CaptureLayerOrderResolve,
  type StepFoldSource,
  type StepLayerOrder,
} from './captureLayerOrder';
import { foldedMirrorAxes } from './mirrorAxes';
import type { SanitizeEnv } from '../upload/svgSanitize';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import {
  capture3dPicture,
  captureModel,
  flatPicture,
  type CapturedPicture,
  type CpCaptureRuntime,
} from './captureFolded';

export interface CaptureSessionDeps {
  /**
   * Run a layer-ordering search as a visible, stoppable fold run: the kernel
   * calls, bound to that run, and the run's Stop, which a layer order's
   * restore listens to (H7).
   */
  search: <T>(work: (runtime: CpCaptureRuntime, stop?: AbortSignal) => Promise<T>) => Promise<T>;
  /** The kernel calls that search nothing — a model change, a read. */
  runtime: () => CpCaptureRuntime;
  retain: (handle: number) => void;
  release: (handle: number) => void;
  /** The handle registry's epoch: a change means every held handle is gone. */
  epoch: () => number;
  env?: SanitizeEnv;
}

/** Which fold a session holds: what it was folded from, so a change of any of it folds again. */
interface FoldKey {
  document: OristudioCpDocumentSnapshot;
  lineIds: string;
  /**
   * The layer order it is drawn in (H7, H8): the digest of the step's record
   * as asked (`layerOrderDigestOf`), or null for the kernel's own
   * enumeration — and always null for a 3D fold, which draws no record's
   * order. A digest, so the key stays short however large the record.
   */
  layerOrder: string | null;
}

/**
 * A layer order a flat fold is drawn in (H7): the step's record, and the host
 * engine that restores it onto the creases.
 */
export interface HeldLayerOrder {
  order: StepLayerOrder;
  resolve: CaptureLayerOrderResolve;
}

/** An order the Layer order dialog applied, and the step's paper frame its record is saved in (H8). */
export interface AppliedLayerOrder {
  applied: LayerOrderApplied;
  frame: PaperFrame;
}

/** The layer order a held flat fold shows: the record of what it shows, beside the one it was asked in (its key's). */
interface HeldOrder {
  shown: StepLayerOrder;
  /** The digest of {@link HeldOrder.shown}'s text: the hold is this fold for it too. */
  shownDigest: string;
  attention: LayerOrderAttention | null;
}

interface FlatHold extends FoldKey {
  kind: 'flat';
  connected?: PreparedConnectedSpread;
  spreadLease?: ConnectedLease;
  handle: number;
  epoch: number;
  side: 'front' | 'back';
  /** The record's order it is drawn in; null for the kernel's own enumeration. */
  order: HeldOrder | null;
  state: Omit<FoldedFigureState, 'handle'>;
  /**
   * The most layer orders this fold's search has reached, and whether it ran
   * out there. A jump back to an earlier one restarts the search (the kernel
   * replays it forward), which forgets every one past it: these do not
   * (`layerOrderPlace.ts`, which Edit's figures keep too).
   */
  reached: SolutionFrontier;
  /**
   * What the kernel drew of it as it stands — its paper scene, unturned — so
   * a turn or a spread of the same side and layer order is drawn again with
   * no call to the kernel. Null until read, and again after any change.
   */
  read: FoldedPicture | null;
}

interface SpatialHold extends FoldKey {
  kind: 'spatial';
  handle: number;
  epoch: number;
  fold: Extract<Awaited<ReturnType<CpCaptureRuntime['fold3d']>>, { status: 'placed' }>;
  aux: OristudioCpFolded3dAuxLines | null;
}

/** Where a flat fold stands: which solution it shows, and whether another can be found. */
export interface FlatFoldState {
  side: 'front' | 'back';
  foldCase: number;
  /** How many layer orders the search has found so far, this one or later. */
  discovered: number;
  /** Whether the search may find more than `discovered`. */
  hasNext: boolean;
  noLayerOrder: boolean;
  /**
   * The layer order it is drawn in (H7): the record of the order it shows
   * and its summary, and whether this call restored it (`fresh`), so a verb
   * that only turns a held fold says nothing new of it. Null for the
   * kernel's own enumeration.
   */
  layerOrder: { order: StepLayerOrder; attention: LayerOrderAttention | null; fresh: boolean } | null;
}

export interface CaptureSession {
  /**
   * The flat fold of these lines from this document, on `side` at `foldCase`,
   * folding it only when the session holds none of it. `knownCases` is how
   * many layer orders are known to exist already — the one a step leaves —
   * which a fold opened fresh cannot know.
   *
   * With `layerOrder` (H7), the fold is drawn in the record's order, held
   * for that record (or the one it showed), and never stepped to a case. A
   * record whose order cannot be drawn holds nothing and throws
   * `LayerOrderNotShownError`, for the caller to keep the step's picture.
   */
  flat: (
    document: OristudioCpDocumentSnapshot,
    lineIds: readonly number[],
    side: 'front' | 'back',
    foldCase: number,
    knownCases?: number,
    layerOrder?: HeldLayerOrder | null
  ) => Promise<FlatFoldState>;
  /**
   * The flat fold of these lines from this document, on `side`, in an order
   * the Layer order dialog applied (H8): `applied.relations` folded on
   * `applied.source` into a new figure (`fold_with_order`), which replaces
   * the fold held — never a change to it, so an undo finds the fold it had
   * gone, not redrawn in the undone order. It is held for the record it is
   * saved as, in the step's paper frame (`frame`). Null when the kernel
   * cannot draw the order (D3): nothing was made, and the fold held stays.
   */
  flatWithOrder: (
    document: OristudioCpDocumentSnapshot,
    lineIds: readonly number[],
    side: 'front' | 'back',
    applied: AppliedLayerOrder
  ) => Promise<FlatFoldState | null>;
  /**
   * What the held flat fold was made from and the paper it lies on, as it
   * stands (`heldFoldSource`): the Layer order dialog's source for it, read
   * with no fold (H8).
   */
  heldFlatSource: () => Promise<StepFoldSource>;
  /**
   * Whether the session holds the flat fold of these lines from this document
   * drawn in `layerOrder` — a record's text, or null for the kernel's own —
   * as `flat` would find it: no fold and no restore needed.
   */
  holdsFlat: (document: OristudioCpDocumentSnapshot, lineIds: readonly number[], layerOrder: string | null) => boolean;
  /**
   * Let go of the held flat fold unless it is drawn in `layerOrder` — a
   * record's text, or null for the kernel's own enumeration: after an undo or
   * redo, the fold of an order the step no longer has (H8). Whether it let go.
   */
  releaseUnlessIn: (layerOrder: string | null) => boolean;
  /** Turn the held flat fold over: a model change, no fold. */
  turnOver: () => Promise<FlatFoldState>;
  /** The held flat fold's next solution, on the same handle. */
  nextSolution: () => Promise<FlatFoldState>;
  /**
   * The held flat fold's picture, turned clockwise by `rotationDeg`, its
   * layers spread when asked: read from the kernel once per side and layer
   * order, then drawn from what was read.
   */
  connectedView: () => Promise<ConnectedSpreadView | null>;
  flatPicture: (rotationDeg: number, spread?: LayerSpreadOptions, presentation?: SpreadPresentation) => Promise<CapturedPicture>;
  /**
   * The held flat fold's mirror axes, unturned (`foldedMirrorAxes`): measured
   * on what the kernel read for its picture, so read once per side and layer
   * order with it.
   */
  flatMirrorAxes: () => Promise<number[]>;
  /**
   * The same picture now, with no call to the kernel, when the session holds
   * this flat fold of `document` on `side` at `foldCase` and has read it;
   * null otherwise. For a preview, never a commit: the caller says which
   * creases the fold is of, and it has no faces on the paper.
   */
  heldFlatPicture: (
    held: {
      document: OristudioCpDocumentSnapshot;
      side: 'front' | 'back';
      foldCase: number;
      /** The step's layer order record, which the held fold must be drawn in; absent or null for none. */
      layerOrder?: string | null;
    },
    rotationDeg: number,
    spread?: LayerSpreadOptions
  ) => CapturedPicture | null;
  /**
   * The 3D fold of these lines from this document — for the live view, and a
   * picture at any camera — or the kernel's refusal.
   */
  spatial: (
    document: OristudioCpDocumentSnapshot,
    lineIds: readonly number[]
  ) => Promise<SpatialHold | { kind: 'refused'; refusal: OristudioCpFold3dRefusal }>;
  /** The held 3D fold's picture at a camera, in the diagram's light. */
  spatialPicture: (camera: FoldedFigureCamera, style: DiagramStyle) => CapturedPicture;
  /**
   * Let the held fold go, and any fold still searching: it is freed as it
   * lands. Idempotent; the session can fold again afterwards.
   */
  dispose: () => void;
  /** Forget the held fold without freeing it: the engine that held it is gone. */
  forget: () => void;
}

export type { SpatialHold };

/**
 * A fold that landed after its session let go, or after a newer fold was
 * asked for: its handle is freed, not held, and the work that asked for it is
 * over. Nothing to tell the user — they moved on.
 */
export class CaptureSessionClosedError extends Error {
  constructor() {
    super('The pose session let go of this fold');
    this.name = 'CaptureSessionClosedError';
  }
}

export function createCaptureSession(deps: CaptureSessionDeps): CaptureSession {
  let held: FlatHold | SpatialHold | null = null;
  /**
   * Bumped by every fold asked for and by every let-go. A fold whose ticket is
   * not the current one when it lands is no longer wanted: a session disposed
   * while it searched (the detail closed) must not keep a handle nothing will
   * ever free.
   */
  let generation = 0;

  const release = () => {
    if (!held) return;
    if (held.kind === 'flat') held.spreadLease?.release();
    const { handle, epoch } = held;
    held = null;
    // A handle from before an engine reset is already freed, or belongs to a
    // slot the new kernel may have reused: the registry's reset dealt with it.
    if (epoch === deps.epoch()) deps.release(handle);
  };

  /** Whether `hold` is drawn in the order a step asks for (a record's digest, or null): its key's, or the one it showed. */
  const sameOrder = (hold: FlatHold, asked: string | null): boolean =>
    asked === hold.layerOrder || (hold.order !== null && asked === hold.order.shownDigest);

  /** Whether the fold held is the one `key` names: of its document and lines, a flat one in its layer order. */
  const live = (key: FoldKey): boolean =>
    held !== null &&
    held.epoch === deps.epoch() &&
    held.document === key.document &&
    held.lineIds === key.lineIds &&
    (held.kind === 'spatial' || sameOrder(held, key.layerOrder));

  /** A record's text as a key names it; null for none. */
  const orderKey = (layerOrder: string | null | undefined): string | null =>
    layerOrder == null ? null : layerOrderDigestOf(layerOrder);

  const take = (handle: number) => {
    deps.retain(handle);
    return deps.epoch();
  };

  /** Hold a fold that just landed, if it is still the one wanted; free it otherwise. */
  const adopt = (ticket: number, handle: number): number => {
    const epoch = take(handle);
    if (ticket === generation) return epoch;
    deps.release(handle);
    throw new CaptureSessionClosedError();
  };

  const letGo = () => {
    generation += 1;
    release();
  };

  const flatHold = (): FlatHold => {
    // Every verb folds before it reads, so nothing held here means it was let go mid-verb.
    if (!held) throw new CaptureSessionClosedError();
    if (held.kind !== 'flat' || held.epoch !== deps.epoch()) throw new Error('No flat fold is held');
    return held;
  };

  /** The fold's new state, and how far its search has reached (`advanceSolutionFrontier`). */
  const settle = (hold: FlatHold, state: Omit<FoldedFigureState, 'handle'>) => {
    hold.state = state;
    hold.read = null;
    hold.spreadLease?.release(); hold.spreadLease = undefined; hold.connected = undefined;
    hold.reached = advanceSolutionFrontier(hold.reached, {
      discovered: state.discoveredCases,
      hasNext: state.hasNext ?? false,
    });
  };

  const flatState = (hold: FlatHold, fresh = false): FlatFoldState => ({
    side: hold.side,
    foldCase: Math.max(1, hold.state.currentCase ?? hold.state.discoveredCases),
    ...frontierSolutions(hold.reached),
    noLayerOrder: !hasFoldedLayerOrder(hold.state),
    layerOrder: hold.order ? { order: hold.order.shown, attention: hold.order.attention, fresh } : null,
  });

  /** The order a hold shows, as it keeps it. */
  const heldOrder = (shown: StepLayerOrder, attention: LayerOrderAttention | null): HeldOrder => ({
    shown,
    shownDigest: layerOrderDigestOf(shown.json),
    attention,
  });

  /** A flat fold of these lines, in the kernel's first order or in a record's, held. */
  const foldFlat = async (
    key: FoldKey,
    lineIds: readonly number[],
    side: 'front' | 'back',
    layerOrder: HeldLayerOrder | null
  ): Promise<FlatHold> => {
    release();
    const ticket = ++generation;
    const model = captureModel(key.document, side);
    if (!layerOrder) {
      const folded = await deps.search((runtime) => openFold(runtime, [...lineIds], model));
      return {
        kind: 'flat',
        ...key,
        handle: folded.handle,
        epoch: adopt(ticket, folded.handle),
        side,
        order: null,
        state: folded,
        reached: UNSEARCHED_FRONTIER,
        read: null,
      };
    }
    const shown = await deps.search((runtime, stop) =>
      foldWithLayerOrder(runtime, lineIds, model, layerOrder.order, layerOrder.resolve, stop)
    );
    if (shown.kind !== 'shown') {
      // No figure was made for it: nothing to hold, or to free.
      if (ticket !== generation) throw new CaptureSessionClosedError();
      throw new LayerOrderNotShownError(shown.kind === 'kept' || shown.kind === 'lost' ? shown : null);
    }
    const { state } = shown;
    // Held through the registry, or let go through it when the session moved on while it was restored.
    const epoch = adopt(ticket, state.handle);
    return {
      kind: 'flat',
      ...key,
      handle: state.handle,
      epoch,
      side,
      order: heldOrder(shown.layerOrder, shown.attention),
      state,
      // Its order is the record's, not a step of an enumeration.
      reached: { cases: 1, complete: true },
      read: null,
    };
  };

  return {
    async flat(document, lineIds, side, foldCase, knownCases = 0, layerOrder = null) {
      const key: FoldKey = { document, lineIds: lineIds.join(','), layerOrder: orderKey(layerOrder?.order.json) };
      const fresh = !live(key) || held?.kind !== 'flat';
      if (fresh) {
        held = await foldFlat(key, lineIds, side, layerOrder);
        settle(held, held.state);
      }
      const hold = flatHold();
      // A record's order is one, not a place in the kernel's enumeration: nothing a step left is known of it.
      if (!hold.order) hold.reached = solutionFrontierKnowing(hold.reached, knownCases);
      if (hold.side !== side) {
        settle(hold, { ...hold.state, ...(await deps.runtime().setModel(hold.handle, captureModel(document, side))) });
        hold.side = side;
      }
      // A record's order is never stepped: its pager waits for the dialog's (D9).
      if (!hold.order && flatState(hold).foldCase !== foldCase && foldCase >= 1) {
        settle(hold, await deps.search((runtime) => runtime.foldToCase(hold.handle, foldCase)));
      }
      return flatState(hold, fresh);
    },

    async flatWithOrder(document, lineIds, side, { applied, frame }) {
      const ticket = ++generation;
      const model = captureModel(document, side);
      const shown = await deps.search((runtime) => foldAppliedOrder(runtime, applied, model, frame));
      // Let go of while it folded: a refusal made nothing to free; a figure is freed by `adopt`.
      if (shown.kind !== 'shown') {
        if (ticket !== generation) throw new CaptureSessionClosedError();
        return null;
      }
      const epoch = adopt(ticket, shown.state.handle);
      // The fold it replaces goes only once the new one is held: a refusal leaves it as it was.
      release();
      const { handle: _handle, ...state } = shown.state;
      const hold: FlatHold = {
        kind: 'flat',
        document,
        lineIds: lineIds.join(','),
        layerOrder: layerOrderDigestOf(shown.layerOrder.json),
        handle: shown.state.handle,
        epoch,
        side,
        order: heldOrder(shown.layerOrder, shown.attention),
        state,
        reached: { cases: 1, complete: true },
        read: null,
      };
      held = hold;
      settle(hold, state);
      return flatState(hold, true);
    },

    async heldFlatSource() {
      const hold = flatHold();
      return heldFoldSource(
        deps.runtime(),
        hold.handle,
        captureModel(hold.document, hold.side),
        // Its paper as read for its picture, when it has been: the fold as it stands.
        hold.read ? hold.read.scene : undefined
      );
    },

    holdsFlat(document, lineIds, layerOrder) {
      return held?.kind === 'flat' && live({ document, lineIds: lineIds.join(','), layerOrder: orderKey(layerOrder) });
    },

    releaseUnlessIn(layerOrder) {
      if (held?.kind !== 'flat' || sameOrder(held, orderKey(layerOrder))) return false;
      letGo();
      return true;
    },

    async turnOver() {
      const hold = flatHold();
      const side = hold.side === 'back' ? 'front' : 'back';
      settle(hold, { ...hold.state, ...(await deps.runtime().setModel(hold.handle, captureModel(hold.document, side))) });
      hold.side = side;
      return flatState(hold);
    },

    async nextSolution() {
      const hold = flatHold();
      settle(hold, await deps.search((runtime) => runtime.foldAnother(hold.handle)));
      return flatState(hold);
    },

    async connectedView() {
      const hold = flatHold();
      hold.read ??= await readFoldedPicture(deps.runtime(), hold.handle, hold.state.displayStyle);
      const scene = hold.read.scene;
      if (!scene) return null;
      const lease = hold.spreadLease ??= prepareConnected(scene);
      const prepared = await lease.promise;
      if (held !== hold || hold.spreadLease !== lease) throw new CaptureSessionClosedError();
      hold.connected = prepared;
      return {scene, prepared};
    },

    async flatPicture(rotationDeg, spread, presentation) {
      const hold = flatHold();
      hold.read ??= await readFoldedPicture(deps.runtime(), hold.handle, hold.state.displayStyle);
      if (spread?.kind === 'connected' && hold.read.scene) {
        const view = await this.connectedView();
        if (view) return captureFlatScenePicture(view.scene, rotationDeg, spread, view.prepared, presentation);
      }
      return flatPicture(hold.read, rotationDeg, deps.env, spread);
    },

    async flatMirrorAxes() {
      const hold = flatHold();
      hold.read ??= await readFoldedPicture(deps.runtime(), hold.handle, hold.state.displayStyle);
      return foldedMirrorAxes(hold.read);
    },

    heldFlatPicture({ document, side, foldCase, layerOrder = null }, rotationDeg, spread) {
      if (held?.kind !== 'flat' || held.epoch !== deps.epoch() || held.document !== document) return null;
      if (!held.read || held.side !== side || flatState(held).foldCase !== foldCase) return null;
      if (spread?.kind === 'connected') return null;
      if (!sameOrder(held, orderKey(layerOrder))) return null;
      // A preview, never stored: no faces on the paper, which only a stored capture is anchored by.
      return flatPicture(held.read, rotationDeg, deps.env, spread, { faces: false, connected: held.connected });
    },

    async spatial(document, lineIds) {
      const key: FoldKey = { document, lineIds: lineIds.join(','), layerOrder: null };
      if (live(key) && held?.kind === 'spatial') return held;
      release();
      const ticket = ++generation;
      const result = await deps.search((runtime) =>
        runtime.fold3d([...lineIds], captureModel(document, 'front'))
      );
      if (result.status === 'refused') return { kind: 'refused', refusal: result.refusal };
      const epoch = adopt(ticket, result.handle);
      const hold: SpatialHold = { kind: 'spatial', ...key, handle: result.handle, epoch, fold: result, aux: null };
      held = hold;
      hold.aux = await deps.runtime().aux3d(result.handle);
      // Let go while its aux lines were read: the release freed it.
      if (held !== hold) throw new CaptureSessionClosedError();
      return hold;
    },

    spatialPicture(camera, style) {
      if (!held) throw new CaptureSessionClosedError();
      if (held.kind !== 'spatial' || held.epoch !== deps.epoch()) throw new Error('No 3D fold is held');
      return capture3dPicture(held.fold, camera, style, held.aux);
    },

    dispose: letGo,

    forget() {
      if (held?.kind === 'flat') held.spreadLease?.release();
      held = null;
    },
  };
}
