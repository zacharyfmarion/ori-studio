/**
 * Import CP and "Start from Edit's folded figure" as one flow (plan D16): a
 * file, a sample or Edit's figure in; a `cp-jump` step out, appended through
 * the session after the step on screen — or, for an empty sequence, one that
 * adopts the pattern's square or rectangle sheet.
 *
 * - **Open, choose, commit.** Opening reads the file with the CP kernel's
 *   loader and completes its layer order from its letters, a true ‹ n of m ›
 *   held in the engine. One order lands and commits at once; several wait
 *   for a choice. Edit's figure brings its own order and commits at once.
 * - **The choice is the Layer order dialog's** (`implementation-plans/layer-order-dialog.md`,
 *   row H10), when the app hands one in (`chooseLayerOrder`): the engine
 *   opens the import onto the dialog's faces, the dialog opens on the order
 *   the import would land by default, and its answer decides — Apply lands
 *   the order it chose (exactly: the engine seeds the import with it),
 *   an Apply that changed nothing lands that default, Cancel cancels the
 *   import. When the dialog can't take it (another is open, its code didn't
 *   load, or the engine can't open this import onto its faces), the import
 *   keeps its own chooser: one listed order per independent component, each
 *   order pictured by the state it lands (a preview, landed and let go).
 *   The dialog never outlives the import: a reset, a dispose (the dialog's
 *   Import CP leaving the screen), a newer request or a move of the step it
 *   goes after withdraws it, and it closes.
 * - **The step lands once.** The pick that is committed is the state the
 *   session's replay then takes (`commitLanded`); nothing is folded twice.
 * - **The engine is held while the flow lives**, so a menu or a drop can
 *   import with no Fold surface mounted; the import is let go when a new one
 *   opens, the flow is reset, or it is disposed.
 * - **Latest wins.** A new request, a reset or a dispose drops whatever an
 *   earlier one was still waiting for.
 *
 * Pure: no React, no store, no wasm. The session and Edit's figure are
 * handed in.
 */

import type { RegionReference } from '../../cp-workspace/regions/regionReference';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { WasmErrorEnvelope } from '../../engine/types';
import type { FoldCpJumpOp, FoldCpOrigin, FoldPaperShape } from '../document/foldSequenceDocument';
import { rectangleShape } from '../document/foldSequenceDocument';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import type { FoldSampleId } from '../engine/foldEngineIoSamples';
import type {
  FoldImportFingerprinted,
  FoldImportLayerOpening,
  FoldImportLimits,
  FoldImportOpened,
  FoldImportSource,
  FoldImportTarget,
} from '../engine/foldEngineIoWire';
import type { FoldEngineOutcome, FoldScene } from '../engine/foldEngineWire';
import type { FoldSession, FoldSessionWorker } from '../session/foldSession';
import { foldImportFaceCapRefusal, foldOverFaceCap } from '../foldFaceCap';
import { foldSample, foldSampleSource } from './foldImportFiles';
import type { FoldImportLocalCode, FoldImportRefusal } from './foldImportRefusal';
import { sameFoldState, selectFoldCursorNode } from '../session/foldSessionState';
import { foldCursorReady, type FoldCursorReady } from './foldSessionWaits';

/** What is imported: a file the user picked or dropped, a sample, or Edit's folded figure. */
export type FoldImportRequest =
  | {
      readonly kind: 'file';
      /** Shown in the dialog and its refusals; never stored, never sent. */
      readonly name: string;
      /** Null for a file whose extension names no format the kernel reads, or that could not be read. */
      readonly source: FoldImportSource | null;
      /** The platform could not read the file. */
      readonly unreadable?: boolean;
    }
  | { readonly kind: 'sample'; readonly sample: FoldSampleId }
  | { readonly kind: 'edit-folded-figure' }
  | { readonly kind: 'project-cp'; readonly stepId?: string; readonly region?: RegionReference };

/** Captured project CP and transaction guard, supplied by the app adapter. */
export interface FoldProjectCpImport {
  source: FoldImportSource;
  link: NonNullable<FoldCpJumpOp['source']>;
  at?: string | null;
  current: () => boolean;
  replace?: (landed: FoldImportFingerprinted) => boolean;
}

/** What the flow asks the Layer order dialog: the import, and the engine's opening of it onto the dialog's faces. */
export interface FoldImportLayerOrderAsk {
  readonly request: FoldImportRequest;
  readonly opening: FoldImportLayerOpening;
}

/**
 * How the Layer order dialog answered an import, as the flow acts on it:
 * Apply's order (`relations` over the faces of the opening's source, whose
 * digest is `digest`); an Apply that changed nothing; Cancel; or no dialog
 * (`fallback`: another one is open, or its code didn't load), and the
 * import keeps its own chooser. Apply carries `turnDeg` when the dialog's
 * Rotate turned the import, in its opening's `look` terms: the step lands
 * turned so.
 */
export type FoldImportLayerOrderAnswer =
  | { readonly kind: 'applied'; readonly relations: Uint32Array; readonly digest: string; readonly turnDeg?: number }
  | { readonly kind: 'unchanged'; readonly turnDeg?: number }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'fallback' };

/** One order's picture: the folded state it lands. */
export type FoldOrderPreview =
  | { readonly status: 'working' }
  | { readonly status: 'ready'; readonly scene: FoldScene }
  | { readonly status: 'failed' };

export type FoldImportFlowState =
  | { readonly phase: 'idle' }
  /** Reading the file, completing its order, or landing and committing it. */
  | { readonly phase: 'working'; readonly request: FoldImportRequest }
  | { readonly phase: 'refused'; readonly request: FoldImportRequest; readonly refusal: FoldImportRefusal; readonly searchLimited?: boolean }
  /** The Layer order dialog is choosing the import's order: the import's own dialog steps aside. */
  | { readonly phase: 'ordering'; readonly request: FoldImportRequest }
  | { readonly phase: 'failed'; readonly request: FoldImportRequest; readonly error: WasmErrorEnvelope }
  | {
      readonly phase: 'choosing';
      readonly request: FoldImportRequest;
      readonly opened: FoldImportOpened;
      /** One listed order per component. */
      readonly choice: readonly number[];
      /** By {@link foldOrderChoiceKey}. */
      readonly previews: ReadonlyMap<string, FoldOrderPreview>;
      /** The choice is being landed and committed. */
      readonly committing: boolean;
      readonly searching?: boolean;
      readonly searchFailed?: boolean;
      readonly searchLimited?: boolean;
      /** Last completed preview stays visible while the next candidate loads. */
      readonly displayed?: FoldScene;
      readonly confirmed: readonly boolean[];
      readonly component: number;
    }
  | { readonly phase: 'done'; readonly request: FoldImportRequest; readonly stepId: string; readonly origin: FoldCpOrigin };

export interface FoldImportFlowOptions {
  session: FoldSession;
  /** Edit's chosen flat folded figure as the CP kernel's paper scene, or null when Edit has none. */
  editFoldedFigure: () => Promise<OristudioCpFoldedPaperScene | null>;
  /** A step was imported: the analytics event, by the step's closed origin. */
  projectCp?: (stepId?: string, region?: RegionReference) => Promise<FoldProjectCpImport | null>;
  onImported?: (origin: FoldCpOrigin, action?: 'insert' | 'update') => void;
  /** The chooser asks about a part with `orders` layer orders: once per such part, as the import opens. */
  onChoiceOffered?: (orders: number) => void;
  onOrderResolved?: (result: 'accepted' | 'canceled', count: number) => void;
  /** An import was refused: the dialog now says why. Once per refusal, whichever step of the flow made it. */
  onRefused?: (refusal: FoldImportRefusal) => void;
  /**
   * Ask the Layer order dialog for the order of an import with several
   * (row H10). Left out, the import's own chooser asks, as before the dialog.
   * `signal` aborts when the flow lets the import go while the dialog is open
   * (a reset, a dispose, a newer request, or the step it goes after moved):
   * the dialog closes then, and its answer lands nothing.
   */
  chooseLayerOrder?: (ask: FoldImportLayerOrderAsk, signal: AbortSignal) => Promise<FoldImportLayerOrderAnswer>;
  /**
   * An import reported several orders, so `chooseLayerOrder` is about to be
   * asked: the dialog's code can start loading beside the engine's opening.
   * Never for a pattern with one order.
   */
  prefetchLayerOrder?: () => void;
}

export interface FoldImportFlow {
  readonly store: StoreApi<FoldImportFlowState>;
  /** Import `request`, after the step on screen. */
  open(request: FoldImportRequest): Promise<void>;
  /** Pick order `order` of component `component` (the chooser's cards). */
  choose(component: number, order: number): void;
  /** Land the chosen orders as a step and commit it. */
  commit(): Promise<void>;
  accept(component: number): Promise<void>;
  region(component: number): void;
  /** A refused search, asked again with a larger budget. */
  searchLonger(): Promise<void>;
  /** Back to choosing what to import; an opened import is let go. */
  reset(): void;
  /** Let the import and the engine go. */
  dispose(): void;
}

/** How much more a "Search longer" spends than the search that ran out. */
const SEARCH_LONGER_FACTOR = 8;

/** A choice's key in the previews. */
export function foldOrderChoiceKey(choice: readonly number[]): string {
  return choice.join(',');
}

/** `choice` with component `component` at `order`. */
export function withFoldOrder(choice: readonly number[], component: number, order: number): number[] {
  return choice.map((value, index) => (index === component ? order : value));
}

/** How many components the chooser has to ask about: the ones with more than one order. */
export function foldOrderChoices(opened: Pick<FoldImportOpened, 'components'>): number {
  return opened.components.filter((component) => (component.orders > 1 || component.truncated)).length;
}

/**
 * The sheet a state's outline is, as the document stores its shape: a square
 * when its sides agree, a rectangle otherwise; null for an outline with no
 * area. What an import of Edit's figure into an empty sequence adopts, since
 * that call says no sheet of its own.
 */
export function foldShapeOfOutline(outline: readonly (readonly [number, number])[]): FoldPaperShape | null {
  if (outline.length < 3) return null;
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!(width > 0 && height > 0)) return null;
  if (Math.abs(width - height) <= 1e-9 * Math.max(width, height)) return { kind: 'square' };
  return rectangleShape(width, height);
}

function errorEnvelope(error: unknown): WasmErrorEnvelope {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const message = 'message' in error ? String(error.message) : error.code;
    return { code: error.code, message };
  }
  return { code: 'fold_import', message: error instanceof Error ? error.message : String(error) };
}

/** An import the engine holds, and where it was opened. */
interface Held {
  readonly handle: number;
  readonly where: FoldCursorReady;
  readonly opened: FoldImportOpened;
  readonly project?: FoldProjectCpImport;
}

const IDLE: FoldImportFlowState = { phase: 'idle' };

export function createFoldImportFlow({
  session,
  editFoldedFigure,
  projectCp,
  onImported,
  onChoiceOffered,
  onOrderResolved,
  onRefused,
  chooseLayerOrder,
  prefetchLayerOrder,
}: FoldImportFlowOptions): FoldImportFlow {
  const store = createStore<FoldImportFlowState>(() => IDLE);
  // Every refusal is a new state, set once: heard here rather than at each place that sets one.
  const unsubscribeRefused = store.subscribe((next, before) => {
    if (next.phase === 'refused' && next !== before) onRefused?.(next.refusal);
  });
  const releaseHold = session.retain();
  let disposed = false;
  /** Bumped by every request, reset and dispose: work for an older one lands nothing. */
  let ticket = 0;
  let held: Held | null = null;
  let previewRunning = false;
  /** The limits the last request was opened with, for "Search longer". */
  let lastLimits: FoldImportLimits | undefined;
  let context: { cursor: string | null; state: FoldEngineStateHandle | null } | null = null;
  /** The Layer order dialog's ask while it is open (`ordering`): aborted, it closes the dialog. */
  let asking: AbortController | null = null;
  /** Close the Layer order dialog, if it is open for this flow: its answer then lands nothing. */
  const withdraw = () => {
    asking?.abort();
    asking = null;
  };
  // The step the import goes after moved (an undo, a branch picked): a choice in hand, the
  // chooser's or the dialog's, would land somewhere else, so it is let go, the dialog closed.
  const unsubscribe = session.store.subscribe((snapshot) => {
    const now = store.getState();
    const choosing = now.phase === 'choosing' && !now.committing;
    if ((!choosing && now.phase !== 'ordering') || !context) return;
    if (snapshot.cursor === context.cursor && sameFoldState(selectFoldCursorNode(snapshot).state, context.state)) return;
    ticket += 1;
    withdraw();
    letGo();
    if (now.phase === 'choosing') onOrderResolved?.('canceled', now.opened.count.orders);
    store.setState(IDLE, true);
  });

  const local = (request: FoldImportRequest, code: FoldImportLocalCode): FoldImportFlowState => ({
    phase: 'refused',
    request,
    refusal: { kind: 'local', code, ...(request.kind === 'file' ? { name: request.name } : {}) },
  });

  /** Ask the engine with `state` as the call's anchor; null when the state is no longer held. */
  const ask = async <T>(state: FoldEngineStateHandle, call: (engine: FoldSessionWorker, id: number) => Promise<T>) => {
    const answer = await session.withState(state, call);
    return answer.status === 'answered' ? answer.value : null;
  };

  const letGo = () => {
    const import_ = held;
    held = null;
    if (!import_) return;
    void ask(import_.where.state, (engine) => engine.releaseImports([import_.handle])).catch(() => {});
  };

  const targetOf = (where: FoldCursorReady, id: number): FoldImportTarget =>
    where.empty ? { kind: 'empty', startSide: where.paper.startSide } : { kind: 'after', state: id };

  /** Commit a landed step after `where`; the flow's state says how it went. */
  const commitLandedStep = async (
    request: FoldImportRequest,
    where: FoldCursorReady,
    landed: FoldImportFingerprinted,
    adopt: FoldPaperShape | null,
    mine: number,
    project?: FoldProjectCpImport
  ): Promise<void> => {
    if (project) {
      landed = { ...landed, op: { ...landed.op, origin: 'project_cp', source: project.link } };
      if (!project.current() || project.replace) {
        await ask(where.state, (engine) => engine.release([landed.state]));
        if (mine !== ticket) return;
        if (!project.current() || !project.replace?.(landed)) {
          store.setState(local(request, 'changed'), true);
          return;
        }
        letGo();
        store.setState({ phase: 'done', request, stepId: request.kind === 'project-cp' ? request.stepId! : '', origin: 'project_cp' }, true);
        onImported?.('project_cp', 'update');
        return;
      }
    }
    const state = { generation: where.state.generation, id: landed.state };
    const outcome = await session.commitLanded({
      state,
      parent: where.empty ? null : where.state,
      op: landed.op,
      fingerprint: landed.fingerprint,
      summary: landed.summary,
      ...(where.empty && adopt ? { adopt } : {}),
    });
    if (mine !== ticket) return;
    switch (outcome.status) {
      case 'committed':
        letGo();
        store.setState({ phase: 'done', request, stepId: outcome.stepId, origin: landed.op.origin }, true);
        onImported?.(landed.op.origin);
        return;
      case 'refused':
        store.setState({ phase: 'refused', request, refusal: { kind: 'engine', refused: outcome.refused } }, true);
        return;
      case 'failed':
        store.setState({ phase: 'failed', request, error: outcome.error }, true);
        return;
      case 'stale':
        store.setState(local(request, 'changed'), true);
        return;
      case 'unavailable':
        store.setState(local(request, outcome.reason === 'read-only' ? 'read_only' : 'no_state'), true);
        return;
    }
  };

  /**
   * Land the order `land` picks of the held import and commit it. A refusal
   * of the order the Layer order dialog chose says so (`via`): its words are
   * its own, with nothing to search again.
   */
  const landAndCommit = async (
    request: FoldImportRequest,
    import_: Held,
    land: (engine: FoldSessionWorker) => Promise<FoldEngineOutcome<FoldImportFingerprinted>>,
    mine: number,
    via?: 'layer_order'
  ) => {
    const picked = await ask(import_.where.state, land);
    if (mine !== ticket) {
      if (picked?.status === 'ok') {
        void ask(import_.where.state, (engine) => engine.release([picked.state])).catch(() => {});
      }
      return;
    }
    if (!picked) {
      store.setState(local(request, 'no_state'), true);
      return;
    }
    if (picked.status !== 'ok') {
      const refusal: FoldImportRefusal = { kind: 'engine', refused: picked, ...(via ? { via } : {}) };
      store.setState({ phase: 'refused', request, refusal }, true);
      return;
    }
    await commitLandedStep(request, import_.where, picked, import_.opened.paper, mine, import_.project);
  };

  /**
   * A land that turns the held import first, to the dialog's `turnDeg`, on
   * the same ask: the step it lands stores the turn, so it is drawn turned
   * with no rotate step after it. As it was with no turn.
   */
  const turnedFirst = <T>(
    import_: Held,
    turnDeg: number | undefined,
    land: (engine: FoldSessionWorker) => Promise<T>
  ): ((engine: FoldSessionWorker) => Promise<T>) =>
    turnDeg === undefined
      ? land
      : async (engine) => {
          await engine.importTurn(import_.handle, turnDeg);
          return land(engine);
        };

  /** Land `choice` of the held import and commit it. */
  const pickAndCommit = (request: FoldImportRequest, import_: Held, choice: readonly number[], mine: number) =>
    landAndCommit(request, import_, (engine) => engine.importPick(import_.handle, choice), mine);

  /**
   * Choose the held import's order in the Layer order dialog (row H10), and
   * act on its answer. Whether the dialog took the import (it committed,
   * cancelled, was refused, or a newer request took over); false hands it
   * to the import's own chooser, with nothing changed.
   */
  const chooseInDialog = async (
    choose: NonNullable<FoldImportFlowOptions['chooseLayerOrder']>,
    request: FoldImportRequest,
    import_: Held,
    choice: readonly number[],
    mine: number
  ): Promise<boolean> => {
    const opening = await ask(import_.where.state, (engine) => engine.importLayerOpening(import_.handle, choice)).catch(
      () => null
    );
    if (mine !== ticket) return true;
    // The engine can't open this import onto the dialog's faces: its own chooser can.
    if (opening?.status !== 'ok') return false;
    const snapshot = session.store.getState();
    context = { cursor: snapshot.cursor, state: selectFoldCursorNode(snapshot).state };
    const asked = new AbortController();
    asking = asked;
    store.setState({ phase: 'ordering', request }, true);
    const answer = await choose({ request, opening }, asked.signal);
    if (asking === asked) asking = null;
    // Withdrawn (a reset, a dispose, a newer request, the step it goes after moved): nothing lands.
    if (mine !== ticket || asked.signal.aborted) return true;
    switch (answer.kind) {
      case 'fallback':
        return false;
      case 'cancelled':
        letGo();
        store.setState(IDLE, true);
        return true;
      case 'unchanged': {
        // The dialog opened on the default choice and Apply kept it, turned as its Rotate left it.
        store.setState({ phase: 'working', request }, true);
        const land = turnedFirst(import_, answer.turnDeg, (engine) => engine.importPick(import_.handle, choice));
        await landAndCommit(request, import_, land, mine);
        return true;
      }
      case 'applied': {
        store.setState({ phase: 'working', request }, true);
        const { digest, relations } = answer;
        const pick = (engine: FoldSessionWorker) => engine.importPickLayerOrder(import_.handle, digest, relations);
        await landAndCommit(request, import_, turnedFirst(import_, answer.turnDeg, pick), mine, 'layer_order');
        return true;
      }
    }
  };

  /** Picture the orders the chooser shows, one at a time, the newest choice's first. */
  const runPreviews = async () => {
    if (previewRunning) return;
    previewRunning = true;
    try {
      for (;;) {
        const now = store.getState();
        const import_ = held;
        if (disposed || now.phase !== 'choosing' || !import_) return;
        const next = now.previews.has(foldOrderChoiceKey(now.choice)) ? null : [...now.choice];
        if (!next) return;
        const key = foldOrderChoiceKey(next);
        const mine = ticket;
        setPreview(key, { status: 'working' });
        const scene = await ask(import_.where.state, async (engine) => {
          const picked = await engine.importPick(import_.handle, next);
          if (picked.status !== 'ok') return null;
          try {
            return await engine.scene(picked.state);
          } finally {
            await engine.release([picked.state]);
          }
        }).catch(() => null);
        if (mine !== ticket) continue;
        setPreview(key, scene ? { status: 'ready', scene } : { status: 'failed' });
      }
    } finally {
      previewRunning = false;
    }
  };

  const setPreview = (key: string, preview: FoldOrderPreview) => {
    const now = store.getState();
    if (now.phase !== 'choosing') return;
    const previews = new Map(now.previews);
    previews.set(key, preview);
    if (previews.size > 16) previews.delete(previews.keys().next().value!);
    store.setState({ ...now, previews, ...(preview.status === 'ready' && key === foldOrderChoiceKey(now.choice) ? { displayed: preview.scene } : {}) }, true);
  };

  const open = async (request: FoldImportRequest, limits?: FoldImportLimits): Promise<void> => {
    if (disposed) return;
    const mine = ++ticket;
    withdraw();
    letGo();
    lastLimits = limits;
    store.setState({ phase: 'working', request }, true);
    if (request.kind === 'file' && request.source === null) {
      store.setState(local(request, request.unreadable ? 'unreadable_file' : 'unsupported_file'), true);
      return;
    }
    try {
      const project = request.kind === 'project-cp' ? await projectCp?.(request.stepId, request.region) : undefined;
      if (mine !== ticket) return;
      if (request.kind === 'project-cp' && !project) {
        store.setState(local(request, 'no_project_cp'), true);
        return;
      }
      const where = await foldCursorReady(session, project?.at);
      if (mine !== ticket) return;
      if (where.status !== 'ready') {
        store.setState(local(request, where.reason === 'read-only' ? 'read_only' : 'no_state'), true);
        return;
      }

      if (request.kind === 'edit-folded-figure') {
        const scene = await editFoldedFigure();
        if (mine !== ticket) return;
        if (!scene) {
          store.setState(local(request, 'no_folded_figure'), true);
          return;
        }
        // Its faces are the import's: over the cap, refused here as the
        // engine would refuse it, before the figure crosses to the worker.
        const over = foldOverFaceCap(scene.faces.length);
        if (over) {
          store.setState({ phase: 'refused', request, refusal: { kind: 'engine', refused: { refusal: foldImportFaceCapRefusal(over) } } }, true);
          return;
        }
        const landed = await ask(where.state, (engine, id) =>
          engine.importEditFoldedFigure(scene, targetOf(where, id), limits)
        );
        if (mine !== ticket) {
          if (landed?.status === 'ok') void ask(where.state, (engine) => engine.release([landed.state])).catch(() => {});
          return;
        }
        if (!landed) {
          store.setState(local(request, 'no_state'), true);
          return;
        }
        if (landed.status !== 'ok') {
          store.setState({ phase: 'refused', request, refusal: { kind: 'engine', refused: landed } }, true);
          return;
        }
        await commitLandedStep(request, where, landed, foldShapeOfOutline(landed.summary.sheet), mine);
        return;
      }

      const source = request.kind === 'sample' ? sampleSource(request.sample) : request.kind === 'project-cp' ? project?.source : request.source;
      if (!source) {
        store.setState(local(request, 'unsupported_file'), true);
        return;
      }
      const opened: FoldEngineOutcome<FoldImportOpened> | null = await ask(where.state, (engine, id) =>
        engine.importCp(source, targetOf(where, id), limits)
      );
      if (mine !== ticket || disposed) {
        if (opened?.status === 'ok') {
          void ask(where.state, (engine) => engine.releaseImports([opened.import])).catch(() => {});
        }
        return;
      }
      if (!opened) {
        store.setState(local(request, 'no_state'), true);
        return;
      }
      if (opened.status !== 'ok') {
        store.setState({ phase: 'refused', request, refusal: { kind: 'engine', refused: opened }, searchLimited: (limits?.maxNodes ?? 0) >= 12_800_000 }, true);
        return;
      }
      const import_: Held = { handle: opened.import, where, opened, ...(project ? { project } : {}) };
      held = import_;
      const choice = opened.components.map(() => 0);
      if (foldOrderChoices(opened) === 0 && opened.count.exact) {
        await pickAndCommit(request, import_, choice, mine);
        return;
      }
      if (chooseLayerOrder) prefetchLayerOrder?.();
      if (chooseLayerOrder && (await chooseInDialog(chooseLayerOrder, request, import_, choice, mine))) return;
      if (mine !== ticket) return;
      for (const component of opened.components) if (component.orders > 1) onChoiceOffered?.(component.orders);
      const snapshot = session.store.getState();
      context = { cursor: snapshot.cursor, state: selectFoldCursorNode(snapshot).state };
      store.setState({ phase: 'choosing', request, opened, choice, previews: new Map(), committing: false, confirmed: opened.components.map((c) => c.orders === 1 && !c.truncated), component: Math.max(0, opened.components.findIndex((c) => c.orders > 1 || c.truncated)) }, true);
      void runPreviews();
    } catch (error) {
      if (mine === ticket) store.setState({ phase: 'failed', request, error: errorEnvelope(error) }, true);
    }
  };

  return {
    store,
    open: (request) => open(request),

    choose(component, order) {
      const now = store.getState();
      if (now.phase !== 'choosing' || now.committing || now.searching) return;
      const listed = now.opened.components[component]?.orders ?? 0;
      if (!Number.isInteger(order) || order < 0 || order >= listed || now.choice[component] === order) return;
      store.setState({ ...now, choice: withFoldOrder(now.choice, component, order), confirmed: now.confirmed.map((value, i) => i === component ? false : value), component }, true);
      void runPreviews();
    },

    region(component) {
      const now = store.getState();
      if (now.phase !== 'choosing' || now.committing || now.searching || !now.opened.components[component]) return;
      store.setState({ ...now, component }, true);
    },

    async accept(component) {
      const now = store.getState();
      if (now.phase !== 'choosing' || now.committing || now.searching || now.component !== component || now.previews.get(foldOrderChoiceKey(now.choice))?.status !== 'ready') return;
      onOrderResolved?.('accepted', now.opened.components[component]?.orders ?? 1);
      const confirmed = now.confirmed.map((value, i) => value || i === component);
      const next = confirmed.findIndex((value) => !value);
      store.setState({ ...now, confirmed, component: next < 0 ? component : next }, true);
      if (next < 0) await this.commit();
    },

    async commit() {
      const now = store.getState();
      const import_ = held;
      if (now.phase !== 'choosing' || now.committing || now.searching || !import_ || now.confirmed.some((value) => !value) || now.previews.get(foldOrderChoiceKey(now.choice))?.status !== 'ready') return;
      const mine = ticket;
      store.setState({ ...now, committing: true }, true);
      try {
        await pickAndCommit(now.request, import_, now.choice, mine);
      } catch (error) {
        if (mine === ticket) store.setState({ phase: 'failed', request: now.request, error: errorEnvelope(error) }, true);
      }
    },

    async searchLonger() {
      const now = store.getState();
      if (now.phase === 'choosing' && !now.committing && !now.opened.count.exact) {
        const import_ = held;
        if (!import_ || now.searching || now.searchLimited) return;
        const limits = { perComponent: Math.min(64_000, (lastLimits?.perComponent ?? 1000) * 4), maxNodes: Math.min(12_800_000, (lastLimits?.maxNodes ?? 200_000) * 4) };
        const mine = ticket;
        const searchLimited = limits.perComponent >= 64_000 && limits.maxNodes >= 12_800_000;
        lastLimits = limits;
        store.setState({ ...now, searching: true, searchFailed: false, searchLimited }, true);
        try {
          const result = await ask(import_.where.state, (engine) => engine.importSearch(import_.handle, now.choice, limits));
          if (mine !== ticket) return;
          if (!result || result.status !== 'ok') {
            store.setState({ ...now, searching: false, searchFailed: true, searchLimited }, true);
            return;
          }
          lastLimits = limits;
          held = { ...import_, opened: result.opened };
          const previous = now.previews.get(foldOrderChoiceKey(now.choice));
          store.setState({ ...now, opened: result.opened, choice: result.choice,
            previews: new Map(previous ? [[foldOrderChoiceKey(result.choice), previous]] : []), searching: false,
            searchLimited,
          }, true);
          void runPreviews();
        } catch {
          if (mine === ticket) store.setState({ ...now, searching: false, searchFailed: true, searchLimited }, true);
        }
        return;
      }
      // The Layer order dialog's order refused has nothing to search again: the order was the dialog's.
      if (now.phase !== 'refused' || now.searchLimited || now.refusal.kind !== 'engine' || now.refusal.via) return;
      const { refusal } = now.refusal.refused;
      if (refusal.code !== 'import_budget_exceeded') return;
      const spent = (refusal as Readonly<Record<string, unknown>>).nodes;
      const nodes = typeof spent === 'number' && spent > 0 ? spent : 1;
      await open(now.request, { ...lastLimits, maxNodes: Math.min(12_800_000, Math.ceil(Math.max(nodes, lastLimits?.maxNodes ?? 0) * SEARCH_LONGER_FACTOR)) });
    },

    reset() {
      ticket += 1;
      withdraw();
      letGo();
      store.setState(IDLE, true);
    },

    dispose() {
      if (disposed) return;
      const now = store.getState();
      if (now.phase === 'choosing') onOrderResolved?.('canceled', now.opened.count.orders);
      disposed = true;
      ticket += 1;
      // The Layer order dialog goes with the import it was choosing for (the browser's Back, a
      // workspace switch): an Apply then would land nothing, and say nothing.
      withdraw();
      letGo();
      unsubscribe();
      unsubscribeRefused();
      releaseHold();
    },
  };
}

/** A sample as the engine imports it; null for an id this build does not ship. */
function sampleSource(id: FoldSampleId): FoldImportSource | null {
  const sample = foldSample(id);
  return sample ? foldSampleSource(sample) : null;
}
