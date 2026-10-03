import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type {
  SimulatorPinsClearSource,
  SimulatorToolOptionSource,
  SimulatorToolSelectSource,
} from '../analytics/events';
import { reportError } from '../monitoring';
import { useWorkspaceStore } from '../store/workspaceStore';
import { simulatorPinsFor } from '../store/workspaceStore/slices/simulatorSlice';
import type { SimulatorToolVerbs } from './tools/actions';
import { RESTING_SIMULATOR_TOOL, simulatorTool } from './tools/catalog';
import { pickQueryFor, pinIntentFor } from './tools/intents';
import { applyPinPick, EMPTY_PIN_SET, pinSetsEqual, type PinSet } from './tools/pinSet';
import type {
  CssSize,
  SimulatorGesture,
  SimulatorIntent,
  SimulatorToolDefinition,
  SimulatorToolId,
  SimulatorToolNotice,
  SimulatorToolOptionId,
  SimulatorToolsView,
} from './tools/types';
import type { SimulatorPickQuery } from './pickQuery';
import type { SimulatorFrameView, SimulatorModelView, SimulatorRuntime } from './useSimulatorRuntime';
import type { SimulatorToolShortcutHandlers } from './useSimulatorShortcuts';

/** The runtime calls the tools make. */
export interface SimulatorToolsRuntime {
  model: SimulatorModelView | null;
  gpuActive: boolean;
  pickFaces: SimulatorRuntime['pickFaces'];
  setPinnedFaces: SimulatorRuntime['setPinnedFaces'];
}

export interface UseSimulatorToolsOptions {
  runtime: SimulatorToolsRuntime;
  /** Tools act only on a simulation that is ready. */
  ready: boolean;
  /** The fold revision, which pins are scoped to. */
  revision: number;
  /** Which source is simulated: a segment, or the whole pattern. */
  sourceKey: string;
  /** The canvas-2D path's own pick, from the frame it drew; null without one. */
  pickDrawn: (query: SimulatorPickQuery) => number[] | null;
  /** Abandon a gesture in flight on the canvas. True when there was one. */
  cancelGesture: () => boolean;
}

export interface SimulatorTools {
  view: SimulatorToolsView;
  tool: SimulatorToolDefinition;
  /** The faces pinned on the model on screen. */
  pinned: PinSet;
  /** Whether the canvas takes tool input: a model is loaded and ready. */
  enabled: boolean;
  verbs: SimulatorToolVerbs;
  shortcuts: SimulatorToolShortcutHandlers;
  /** Hand a finished canvas gesture to the tool in hand. */
  runGesture: (gesture: SimulatorGesture, surface: CssSize) => void;
  /** Every solver frame, for the notices that read the simulation. */
  observeFrame: (frame: SimulatorFrameView) => void;
}

/**
 * How a rejected worker call is treated.
 *
 * - `worker-lost`: the worker failed. The app's worker-failure sink already
 *   told the user and reported it, so saying so again would be noise.
 * - `unexpected`: a bug. Toasted, and reported as handled.
 *
 * A stale call is not a failure at all: it resolves null, and never gets here.
 */
export type SimulatorCallFailure = 'worker-lost' | 'unexpected';

export function classifySimulatorCallFailure(error: unknown): SimulatorCallFailure {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : null;
  return typeof code === 'string' && code.startsWith('worker_') ? 'worker-lost' : 'unexpected';
}

/**
 * Above this peak strain with pins set, the window says the pins are pulling
 * against each other. Between the spike's ordinary pinned runs (0.064) and its
 * over-constrained one (0.226); see the plan's error table.
 */
export const PIN_STRAIN_NOTICE_THRESHOLD = 0.15;
/** The notice goes once strain is back under this, so it cannot flicker at the line. */
const PIN_STRAIN_NOTICE_CLEAR = 0.12;

/**
 * The model on screen and the source it was loaded for.
 *
 * Paired because they change at different moments: a segment switch changes
 * the source at once and the model only when its load lands. Reading the new
 * source's pins against the old model would pin the wrong faces on it.
 */
interface BoundModel {
  model: SimulatorModelView;
  revision: number;
  sourceKey: string;
}

function backendTag(gpuActive: boolean): string {
  return gpuActive ? 'gpu' : 'canvas-2d';
}

/** The pins on record for a binding, read now rather than at the last render. */
function pinsOf(binding: BoundModel): PinSet {
  return simulatorPinsFor(
    useWorkspaceStore.getState().simulatorPins,
    binding.revision,
    binding.sourceKey
  );
}

/**
 * The notices after one solver frame, or the same array when nothing changed
 * so the caller can skip a render it does not need. Only `reset` is news: an
 * `arrest` keeps the fold where it is, and the strain that caused it raises
 * the strain notice on its own.
 */
export function nextPinNotices(
  current: readonly SimulatorToolNotice[],
  frame: Pick<SimulatorFrameView, 'recovered' | 'maxStrain'>
): readonly SimulatorToolNotice[] {
  let next = current;
  if (frame.recovered === 'reset' && !next.includes('recovered')) next = [...next, 'recovered'];
  if (frame.maxStrain > PIN_STRAIN_NOTICE_THRESHOLD) {
    if (!next.includes('strained')) next = [...next, 'strained'];
  } else if (frame.maxStrain < PIN_STRAIN_NOTICE_CLEAR && next.includes('strained')) {
    next = next.filter((notice) => notice !== 'strained');
  }
  return next;
}

/**
 * The simulator's tools, bound: the one place a tool has effects.
 *
 * Everything under `tools/` decides; this acts. It reads and writes the store's
 * tool state, puts picks and pins to the worker, keeps the worker's pins in step
 * with the store's, and says what went wrong. The panel composes what it
 * returns and holds no tool logic of its own.
 *
 * **Pins.** The store holds the set the user asked for, per source. The worker
 * holds the set it applied, per model. An effect keeps them in step: a new
 * model is sent its source's pins, and an edit is sent to the model on screen.
 * When the worker rejects a set, the store goes back to the last set the worker
 * acknowledged, so the tint never shows pins the paper does not have.
 */
export function useSimulatorTools(options: UseSimulatorToolsOptions): SimulatorTools {
  const { t } = useTranslation();
  const { runtime, ready, revision, sourceKey } = options;

  const activeToolId = useWorkspaceStore((state) => state.simulatorActiveToolId);
  const toolOptions = useWorkspaceStore((state) => state.simulatorToolOptions);
  const pinsState = useWorkspaceStore((state) => state.simulatorPins);

  // Bound when a model arrives, to the source current at that moment; see
  // `BoundModel`. Derived during render, React's pattern for state that follows
  // a prop, so no render ever sees a model paired with another source.
  const [bound, setBound] = useState<BoundModel | null>(null);
  if ((bound?.model ?? null) !== runtime.model) {
    setBound(runtime.model ? { model: runtime.model, revision, sourceKey } : null);
  }

  const pinned = bound ? simulatorPinsFor(pinsState, bound.revision, bound.sourceKey) : EMPTY_PIN_SET;
  const [notices, setNotices] = useState<readonly SimulatorToolNotice[]>([]);

  // Notices describe the pins they were raised for, so a new set or a new model
  // starts without any.
  const [noticesFor, setNoticesFor] = useState<{ pinned: PinSet; model: SimulatorModelView | null }>({
    pinned,
    model: runtime.model,
  });
  if (noticesFor.pinned !== pinned || noticesFor.model !== runtime.model) {
    setNoticesFor({ pinned, model: runtime.model });
    if (notices.length > 0) setNotices([]);
  }

  // What the callbacks below read. Assigned in an effect rather than during
  // render, which React may discard.
  const live = useRef({ options, bound, activeToolId, toolOptions, pinned, notices, t });
  useEffect(() => {
    live.current = { options, bound, activeToolId, toolOptions, pinned, notices, t };
  });

  // The worker's copy. `faces` is the set it last acknowledged for `model`.
  const heldRef = useRef<{ model: SimulatorModelView; faces: PinSet } | null>(null);
  const { setPinnedFaces, gpuActive } = runtime;

  useEffect(() => {
    if (!bound) return;
    const { model } = bound;
    const held = heldRef.current;
    if (held?.model === model) {
      if (pinSetsEqual(held.faces, pinned)) return;
    } else if (pinned.length === 0) {
      // A new session starts with nothing pinned, so there is nothing to send.
      heldRef.current = { model, faces: EMPTY_PIN_SET };
      return;
    }
    const faces = pinned;
    setPinnedFaces(faces, model).then(
      (outcome) => {
        // Null: the model was replaced before this reached it. The next model
        // is sent its own source's pins when it binds.
        if (outcome === null) return;
        heldRef.current = { model, faces };
      },
      (error: unknown) => {
        if (classifySimulatorCallFailure(error) === 'unexpected') {
          const { t: translate } = live.current;
          toast.error(
            translate('toasts:simulatorPins.updateFailed', "Couldn't pin those faces. Try again.")
          );
          reportError(error, { surface: 'simulator:pins', tags: { backend: backendTag(gpuActive) } });
        }
        // Back to what the paper actually has, unless a newer set has already
        // replaced the one that failed: that one is on its way.
        if (!pinSetsEqual(pinsOf(bound), faces)) return;
        const kept = heldRef.current?.model === model ? heldRef.current.faces : EMPTY_PIN_SET;
        useWorkspaceStore.getState().setSimulatorPins(bound.revision, bound.sourceKey, kept);
      }
    );
  }, [bound, pinned, setPinnedFaces, gpuActive]);

  // Picks run one at a time, so they apply in the order they were made even
  // when an earlier one is slower to answer.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const executeIntent = useCallback(
    async (intent: SimulatorIntent, binding: BoundModel): Promise<void> => {
      // The gesture was made on the picture of `binding`'s model. If another
      // has replaced it since, the region no longer means what was aimed at.
      if (live.current.bound !== binding) return;
      const { options: current, t: translate } = live.current;
      if (!current.ready) return;
      switch (intent.kind) {
        case 'pick-faces': {
          const query = pickQueryFor(intent);
          const onGpu = current.runtime.gpuActive;
          let picked: number[] | null;
          try {
            picked = onGpu ? await current.runtime.pickFaces(query) : current.pickDrawn(query);
          } catch (error) {
            if (classifySimulatorCallFailure(error) === 'unexpected') {
              toast.error(
                translate(
                  'toasts:simulatorPins.pickFailed',
                  "Couldn't tell which faces are there. Try again."
                )
              );
              reportError(error, { surface: 'simulator:pick', tags: { backend: backendTag(onGpu) } });
            }
            return;
          }
          // No frame to answer from, or a session gone while it was asked.
          if (picked === null) return;
          // And the model may have been replaced while the worker answered.
          if (live.current.bound !== binding) return;
          const before = pinsOf(binding);
          const after = applyPinPick(before, picked, intent.mode);
          if (!pinSetsEqual(before, after)) {
            useWorkspaceStore.getState().setSimulatorPins(binding.revision, binding.sourceKey, after);
          }
          return;
        }
      }
    },
    []
  );

  const runIntent = useCallback(
    (intent: SimulatorIntent) => {
      // Bound now, at the gesture, rather than when its turn in the queue comes.
      const binding = live.current.bound;
      if (!binding) return;
      const next = queueRef.current.then(() => executeIntent(intent, binding));
      queueRef.current = next.catch(() => undefined);
    },
    [executeIntent]
  );

  const runGesture = useCallback(
    (gesture: SimulatorGesture, surface: CssSize) => {
      const { activeToolId: toolId, toolOptions: currentOptions } = live.current;
      const tool = simulatorTool(toolId);
      switch (tool.input) {
        case 'pick-faces':
          runIntent(pinIntentFor(gesture, currentOptions, surface));
          return;
        case 'orbit':
          // Orbit turns the camera in the viewport and finishes no gesture.
          return;
      }
    },
    [runIntent]
  );

  const selectTool = useCallback((id: SimulatorToolId, _source: SimulatorToolSelectSource) => {
    const store = useWorkspaceStore.getState();
    if (store.simulatorActiveToolId === id) return;
    // A box half drawn under one tool means nothing to the next.
    live.current.options.cancelGesture();
    store.setSimulatorActiveTool(id);
  }, []);

  const clearPins = useCallback((_source: SimulatorPinsClearSource) => {
    const binding = live.current.bound;
    if (!binding || pinsOf(binding).length === 0) return;
    useWorkspaceStore.getState().setSimulatorPins(binding.revision, binding.sourceKey, EMPTY_PIN_SET);
  }, []);

  const setOption = useCallback(
    (id: SimulatorToolOptionId, value: boolean, _source: SimulatorToolOptionSource) => {
      useWorkspaceStore.getState().setSimulatorToolOption(id, value);
    },
    []
  );

  const exitTool = useCallback((): boolean => {
    if (live.current.options.cancelGesture()) return true;
    if (live.current.activeToolId === RESTING_SIMULATOR_TOOL) return false;
    selectTool(RESTING_SIMULATOR_TOOL, 'escape');
    return true;
  }, [selectTool]);

  // Called once per solver frame, so it compares before it sets: a frame that
  // changes nothing must not cost the panel a render.
  const observeFrame = useCallback((frame: SimulatorFrameView) => {
    const { pinned: current, notices: shown } = live.current;
    if (current.length === 0) return;
    const next = nextPinNotices(shown, frame);
    if (next === shown) return;
    live.current.notices = next;
    setNotices(next);
  }, []);

  const verbs = useMemo<SimulatorToolVerbs>(
    () => ({ selectTool, clearPins, setOption }),
    [selectTool, clearPins, setOption]
  );

  const shortcuts = useMemo<SimulatorToolShortcutHandlers>(
    () => ({
      selectTool: (tool, source) => selectTool(tool, source),
      exitTool,
      clearPins: (source) => clearPins(source),
      togglePinThroughLayers: (source) =>
        setOption('pinThroughLayers', !live.current.toolOptions.pinThroughLayers, source),
    }),
    [selectTool, exitTool, clearPins, setOption]
  );

  const view = useMemo<SimulatorToolsView>(
    () => ({ activeToolId, pinnedCount: pinned.length, options: toolOptions, notices }),
    [activeToolId, pinned.length, toolOptions, notices]
  );

  return {
    view,
    tool: simulatorTool(activeToolId),
    pinned,
    enabled: ready && bound !== null,
    verbs,
    shortcuts,
    runGesture,
    observeFrame,
  };
}
