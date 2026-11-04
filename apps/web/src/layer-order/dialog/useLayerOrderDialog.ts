/**
 * The Layer order dialog's inspector, bound (`implementation-plans/layer-order-dialog.md`,
 * row U10): U9's pure model (`model/layerOrderReducer.ts`) over U4's session
 * (`useLayerOrderSession`) and ways out (`useLayerOrderSettle`), its effects
 * run by `layerOrderEffects.ts`. The dialog's component composes what this
 * answers; nothing here draws.
 *
 * - **The session's status answers the model's opens.** The model's first
 *   open is the one the session makes as the dialog mounts; Try again and
 *   Keep trying ask the session to open again. Whatever the status lands on
 *   (ready, refused, lost) goes to the model as that open's answer, and a
 *   loss after it (a crash) as `engine_lost`.
 * - **The count** is the runtime's, sliced between calls once the model says
 *   it runs; each slice it publishes, with the position read again, goes to
 *   the model as `solutions_counted`, under the generation it was counted in.
 * - **The history** is the model's, registered with the dialog's frame
 *   (`ModalFrame`'s `history`), so ⌘Z, ⇧⌘Z and the menu bar's Undo and Redo
 *   act inside the dialog, through the shortcut runtime: nothing here listens
 *   for a key or depends on where focus is.
 * - **Apply** asks the model (its `applyBlocker`, and D16's verdict) and
 *   hands its answer to `useLayerOrderSettle.apply`: nothing to write, or a
 *   save of the session's order with the carried rows the model still lists,
 *   by record index. The save changes nothing in the session, so one the
 *   engine refuses keeps the dialog open, as it was, with the reason in the
 *   foot; only an Apply that went through closes the model and reports it.
 * - **Losses.** A call the engine rejects because the dialog is closing goes
 *   nowhere. One that lost the engine is the session's loss; any other is
 *   reported once, under `layer-order:dialog`, and the session counts as
 *   lost (Try again opens it again).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { trackLayerOrderFact } from '../../analytics/trackLayerOrder';
import type { ModalHistory } from '../../keyboard/dialogShortcuts';
import { reportError } from '../../monitoring';
import type { LayerFace } from '../engine/faceIndex';
import { isLayerOrderLoadFailure } from '../engine/layerOrderLoadFailure';
import { isLayerOrderEngineLost } from '../engine/layerOrderRuntime';
import type { LayerSidesStacks } from '../model/layerOrderEngineFacts';
import { currentStepBy, initLayerOrderDialog, layerOrderReducer } from '../model/layerOrderReducer';
import { listControls } from '../model/layerOrderSelectors';
import type { LayerOrderAction, LayerOrderDialogState } from '../model/layerOrderState';
import type { LayerPaneId, LayerPanesEvents } from '../panes/layerPaneInput';
import type { LayerFaceMarks, LayerPanesView } from '../panes/layerPaneMarks';
import { layerOrderRequestInit } from './layerOrderDialogInit';
import type { LayerOrderDialogOpening } from './layerOrderDialogStore';
import { runLayerOrderEffects, type LayerOrderEffectCall, type LayerOrderEffectHost } from './layerOrderEffects';
import { layerOrderFaceMarks, layerOrderPanesStacks, layerOrderPanesView } from './layerOrderPaneBinding';
import type { LayerOrderSession, LayerOrderSessionStatus } from './useLayerOrderSession';
import type { LayerOrderSettle } from './useLayerOrderSettle';

/** The faces on offer each pane leaves unlettered at its zoom (D7's addition). */
export type LayerOrderUnlettered = Readonly<Record<LayerPaneId, readonly LayerFace[]>>;

/**
 * Whether some face on offer has no letter on any pane in view (D7's
 * addition): a face lettered on one of them can be found by its letter, so
 * only one unlettered everywhere asks to zoom in. `inView` is the phone's one
 * pane, or null for both.
 */
export function lettersHidden(unlettered: LayerOrderUnlettered, inView: LayerPaneId | null): boolean {
  if (inView !== null) return unlettered[inView].length > 0;
  const folded = new Set(unlettered.folded);
  return unlettered.pattern.some((face) => folded.has(face));
}

export interface LayerOrderDialogBinding {
  readonly state: LayerOrderDialogState;
  readonly dispatch: (action: LayerOrderAction) => void;
  /**
   * What the frame and the panes are told: the session's status, or, while
   * the session stands but the model has none (a call it lost, a restore it
   * refused), the model's own loss or refusal.
   */
  readonly status: LayerOrderSessionStatus;
  /** The model's undo history, for the frame's keys and the menu bar. */
  readonly history: ModalHistory;
  readonly apply: () => void;
  readonly cancel: () => void;
  /** The notice's Try again or Keep trying. */
  readonly retry: () => void;
  readonly view: LayerPanesView;
  readonly setView: (view: LayerPanesView) => void;
  readonly marks: LayerFaceMarks;
  readonly stacks: LayerSidesStacks | null;
  readonly events: LayerPanesEvents;
  /** Each pane's faces on offer with no letter at its zoom. */
  readonly unlettered: LayerOrderUnlettered;
  readonly onUnlettered: (pane: LayerPaneId, faces: readonly LayerFace[]) => void;
  /** Pointing at D19's notice lights the face it names. */
  readonly setNoticeLit: (on: boolean) => void;
}

/** The model's status in the frame's terms (see {@link LayerOrderDialogBinding.status}). */
export function layerOrderFrameStatus(session: LayerOrderSessionStatus, state: LayerOrderDialogState): LayerOrderSessionStatus {
  if (session.kind !== 'ready') return session;
  switch (state.phase.kind) {
    case 'failed':
      return { kind: 'lost', cause: state.phase.unavailable ? 'load' : 'failed', limits: session.limits };
    case 'refused':
      return { kind: 'refused', refusal: state.phase.refusal, limits: session.limits };
    case 'opening':
      return { kind: 'opening', limits: session.limits };
    default:
      return session;
  }
}

const NO_UNLETTERED: LayerOrderUnlettered = { pattern: [], folded: [] };

export function useLayerOrderDialog(
  opening: LayerOrderDialogOpening,
  session: LayerOrderSession,
  settle: LayerOrderSettle
): LayerOrderDialogBinding {
  const { request } = opening;
  const [first] = useState(() =>
    initLayerOrderDialog({
      surface: request.surface ?? null,
      // What the request decides: a record to restore, whether an untouched
      // Apply still writes (D10, D12), the flagged rows from Review… (D14).
      ...layerOrderRequestInit(request),
      side: request.look.side,
      turnDeg: request.look.turnDeg,
      at: Date.now(),
    })
  );
  const [state, setState] = useState(first.state);
  const stateRef = useRef(first.state);
  const alive = useRef(false);
  const reported = useRef(false);
  /** The model's open the session's status answers next, and whether that open has begun. */
  const awaiting = useRef<{ request: number; begun: boolean } | null>(null);
  const applying = useRef(false);
  const { runtime, status } = session;
  /** The session and the ways out as of the last commit: what the effects and the callbacks read. */
  const latest = useRef({ status, runtime, session, settle });
  useLayoutEffect(() => {
    latest.current = { status, runtime, session, settle };
  });
  /** The request of the model's first open: the one the session makes as it mounts. */
  const firstOpen = first.state.phase.kind === 'opening' ? first.state.phase.request : null;

  // The effects' host: built once, it reads the runtime and the shell as of the last commit.
  const hostRef = useRef<LayerOrderEffectHost | null>(null);

  const dispatch = useCallback((action: LayerOrderAction) => {
    if (!alive.current) return;
    const step = layerOrderReducer(stateRef.current, action);
    if (step.state === stateRef.current && step.effects.length === 0) return;
    stateRef.current = step.state;
    setState(step.state);
    if (hostRef.current) runLayerOrderEffects(step.effects, step.state, hostRef.current);
  }, []);

  const failed = useCallback(
    (error: unknown, call: LayerOrderEffectCall) => {
      // The dialog closing has nothing to say, and a worker that went away is the session's to say
      // (its status turns `lost`, which the model hears): a call of that worker answers nothing more.
      if (!alive.current || isLayerOrderEngineLost(error)) return;
      const unavailable = isLayerOrderLoadFailure(error);
      if (!unavailable && !reported.current) {
        reported.current = true;
        reportError(error, { surface: 'layer-order:dialog', tags: { call } });
      }
      dispatch({ type: 'engine_lost', unavailable });
    },
    [dispatch]
  );

  /** Hand the model the open's answer, once the session's status has one. */
  const settleOpen = useCallback(() => {
    const waiting = awaiting.current;
    const now = latest.current.status;
    if (!waiting) return;
    if (now.kind === 'opening') {
      waiting.begun = true;
      return;
    }
    if (!waiting.begun) return;
    awaiting.current = null;
    if (now.kind === 'ready') dispatch({ type: 'opened', request: waiting.request, facts: now.open.facts });
    else if (now.kind === 'refused') dispatch({ type: 'open_refused', request: waiting.request, refusal: now.refusal });
    else dispatch({ type: 'engine_lost', unavailable: now.cause === 'load' });
  }, [dispatch]);

  const host = useMemo<LayerOrderEffectHost>(
    () => ({
      get engine() {
        const engineNow = latest.current.runtime;
        if (!engineNow) throw new Error('The layer order dialog has no engine yet.');
        return engineNow.engine;
      },
      request,
      dispatch: (action) => dispatch(action),
      reopen: (openRequest, limits) => {
        // The model's first open is the session's own, made as the dialog mounted: it has begun,
        // and may have answered already. A later one begins when the session says it is opening,
        // with the model's limits (Keep trying's, after one that ran out).
        const mounting = openRequest === firstOpen;
        awaiting.current = { request: openRequest, begun: mounting };
        if (mounting) settleOpen();
        else latest.current.session.reopen(limits);
      },
      setCounting: (on) => latest.current.runtime?.setCounting(on),
      count: () => latest.current.runtime?.count() ?? null,
      failed: (error, call) => failed(error, call),
      close: () => latest.current.settle.cancel(),
      track: (fact) => trackLayerOrderFact(fact),
    }),
    [request, dispatch, firstOpen, settleOpen, failed]
  );
  useLayoutEffect(() => {
    hostRef.current = host;
  }, [host]);

  // The model's first effects (its open), once, as the dialog mounts.
  const started = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      runLayerOrderEffects(first.effects, first.state, host);
    }
    return () => {
      alive.current = false;
    };
  }, [first, host]);

  // The session's status: an open's answer, or a loss after it.
  useEffect(() => {
    if (!alive.current) return;
    if (awaiting.current) {
      settleOpen();
      return;
    }
    if (status.kind === 'lost') dispatch({ type: 'engine_lost', unavailable: status.cause === 'load' });
  }, [status, settleOpen, dispatch]);

  // The count, as the runtime publishes it, with the position read again.
  useEffect(() => {
    if (!runtime) return;
    let asking = false;
    let latest: Parameters<Parameters<typeof runtime.onCount>[0]>[0] = null;
    const ask = () => {
      const count = latest;
      latest = null;
      const now = stateRef.current;
      if (!count || !now.solutions.runs || now.phase.kind !== 'open') return;
      const { generation } = now.solutions;
      const by = currentStepBy(now);
      asking = true;
      runtime.engine
        .position(by)
        .then(
          (position) => dispatch({ type: 'solutions_counted', generation, by, count, position }),
          (error: unknown) => failed(error, 'solutions')
        )
        .finally(() => {
          asking = false;
          if (latest) ask();
        });
    };
    return runtime.onCount((count) => {
      if (!count) return;
      latest = count;
      if (!asking) ask();
    });
  }, [runtime, dispatch, failed]);

  const history = useMemo<ModalHistory>(
    () => ({
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      canUndo: () => listControls(stateRef.current).undo,
      canRedo: () => listControls(stateRef.current).redo,
    }),
    [dispatch]
  );

  const apply = useCallback(() => {
    if (applying.current || !alive.current) return;
    const step = layerOrderReducer(stateRef.current, { type: 'apply', at: Date.now() });
    const asked = step.effects.find((effect) => effect.type === 'apply');
    if (!asked || asked.type !== 'apply' || !latest.current.runtime) return;
    applying.current = true;
    void (async () => {
      try {
        // The model's verdict (D16), and the carried rows it still lists, which the save writes back by
        // record index: nothing in the session changes before a save that can still be refused.
        const outcome = await latest.current.settle.apply(asked.result, asked.turnDeg);
        if (outcome !== 'applied' && outcome !== 'unchanged') return;
        // Answered: the model closes, and says so.
        stateRef.current = step.state;
        if (alive.current) setState(step.state);
        for (const effect of step.effects) if (effect.type === 'track') trackLayerOrderFact(effect.fact);
      } catch (error) {
        failed(error, 'apply');
      } finally {
        applying.current = false;
      }
    })();
  }, [failed]);

  const cancel = useCallback(() => {
    dispatch({ type: 'cancel', at: Date.now() });
    // Whatever the model says, Cancel closes: a model already closed answers nothing.
    latest.current.settle.cancel();
  }, [dispatch]);

  const retry = useCallback(() => {
    const phase = stateRef.current.phase.kind;
    if (phase === 'failed') dispatch({ type: 'retry_open' });
    else dispatch({ type: 'keep_trying' });
  }, [dispatch]);

  const setView = useCallback(
    (view: LayerPanesView) => {
      const was = stateRef.current.view;
      if (view.side !== was.side) dispatch({ type: 'side_set', side: view.side });
      if (view.xray !== was.xray) dispatch({ type: 'xray_set', on: view.xray });
      if (view.undecided !== was.openSpots) dispatch({ type: 'open_spots_set', on: view.undecided });
    },
    [dispatch]
  );

  const events = useMemo<LayerPanesEvents>(
    () => ({
      onFacePicked: ({ face, origin, input }) => {
        dispatch({ type: 'face_picked', face, origin });
        // A tap has no hover: the face it picked stays pointed at, so its hint shows (D6).
        if (input === 'tap') dispatch({ type: 'face_hovered', face });
      },
      onFaceHovered: ({ face, input }) => {
        // A finger's lift lets go of nothing: the tap's face stays pointed at until another tap.
        if (input === 'tap' && face === null) return;
        dispatch({ type: 'face_hovered', face });
      },
      onEmptyPaper: ({ input }) => {
        dispatch({ type: 'ground_clicked' });
        if (input === 'tap') dispatch({ type: 'face_hovered', face: null });
      },
      onFlashEnded: (n) => dispatch({ type: 'flash_ended', n }),
      onTurn: (direction) => dispatch({ type: 'turned', direction }),
    }),
    [dispatch]
  );

  const [unlettered, setUnlettered] = useState<LayerOrderUnlettered>(NO_UNLETTERED);
  const onUnlettered = useCallback((pane: LayerPaneId, faces: readonly LayerFace[]) => {
    setUnlettered((was) => (was[pane].join(',') === faces.join(',') ? was : { ...was, [pane]: faces }));
  }, []);

  const [noticeLit, setNoticeLit] = useState(false);
  const marks = useMemo(() => layerOrderFaceMarks(state, noticeLit), [state, noticeLit]);
  const stacks = useMemo(() => layerOrderPanesStacks(state), [state]);
  const view = useMemo(() => layerOrderPanesView(state.view), [state.view]);

  return {
    state,
    dispatch,
    status: layerOrderFrameStatus(session.status, state),
    history,
    apply,
    cancel,
    retry,
    view,
    setView,
    marks,
    stacks,
    events,
    unlettered,
    onUnlettered,
    setNoticeLit,
  };
}
