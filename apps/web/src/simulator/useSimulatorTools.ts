import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { CameraUniforms } from '@treemaker/origami-simulator';
import {
  trackSimulatorPinnedFoldMoved,
  trackSimulatorPinsCleared,
  trackSimulatorPinsEdited,
  trackSimulatorSolverRecovered,
  trackSimulatorToolOptionChanged,
  trackSimulatorToolSelected,
  type SimulatorPinsClearSource,
  type SimulatorToolOptionSource,
  type SimulatorToolSelectSource,
} from '../analytics';
import { reportError } from '../monitoring';
import { useWorkspaceStore } from '../store/workspaceStore';
import { simulatorPinsFor } from '../store/workspaceStore/slices/simulatorSlice';
import type { SimulatorToolVerbs } from './tools/actions';
import { RESTING_SIMULATOR_TOOL, simulatorTool } from './tools/catalog';
import { pickQueryFor, pinIntentFor, pullIntentFor } from './tools/intents';
import {
  applyPinPick,
  EMPTY_PIN_SET,
  pinPickOutcome,
  pinSetsEqual,
  type PinSet,
} from './tools/pinSet';
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
import { pinnedHighlights, type SimulatorHighlights } from './canvas2dFrame';
import { classifySimulatorCallFailure, simulatorBackendTag } from './simulatorCallFailure';
import type { SimulatorPickQuery } from './pickQuery';
import type { SimulatorViewportToolInput } from './SimulatorViewport';
import type { SimulatorFrameView, SimulatorModelView, SimulatorRuntime } from './useSimulatorRuntime';
import type { SimulatorToolShortcutHandlers } from './useSimulatorShortcuts';
import { useSimulatorPull } from './useSimulatorPull';

/** The runtime calls the tools make. */
export interface SimulatorToolsRuntime {
  model: SimulatorModelView | null;
  gpuActive: boolean;
  pickFaces: SimulatorRuntime['pickFaces'];
  setPinnedFaces: SimulatorRuntime['setPinnedFaces'];
  beginPull: SimulatorRuntime['beginPull'];
  movePull: SimulatorRuntime['movePull'];
  endPull: SimulatorRuntime['endPull'];
  releasePose: SimulatorRuntime['releasePose'];
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
  /** The camera of the canvas-2D path's last frame, for a pull; null without one. */
  drawnCamera: () => CameraUniforms | null;
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
  /** What the viewport needs to run the tool in hand. */
  toolInput: SimulatorViewportToolInput;
  /** The pinned faces' tint, for the canvas-2D path; the worker tints its own. */
  highlights: SimulatorHighlights;
  verbs: SimulatorToolVerbs;
  shortcuts: SimulatorToolShortcutHandlers;
  /** Hand a canvas gesture to the tool in hand: a finished box or click, a step of a pull. */
  runGesture: (gesture: SimulatorGesture, surface: CssSize) => void;
  /** Every solver frame, for the notices that read the simulation. */
  observeFrame: (frame: SimulatorFrameView) => void;
}

/**
 * Above this strain in a settled frame with pins set, the window says the pins
 * are pulling against each other.
 *
 * Settled frames only, because a fold's transients are no evidence: the bird
 * base peaks at 0.11 folding with nothing pinned and at 0.14 with one face
 * pinned, and settles at 0 both times. Pins that hold faces on both sides of a
 * crease the fold needs settle it at 0.087 to 0.107; the plan's spike settled
 * the kabuto at 0.064 under an ordinary pin and 0.226 over-constrained.
 */
export const PIN_STRAIN_NOTICE_THRESHOLD = 0.08;
/** A settled frame under this takes the notice down, so it cannot flicker at the line. */
const PIN_STRAIN_NOTICE_CLEAR = 0.06;

/** How far the fold target has to move from where it was when the pins changed. */
const PINNED_FOLD_MOVE_PERCENT = 1;

/** Each option as the analytics event names it: the tool it belongs to, and itself. */
const OPTION_EVENT: Record<SimulatorToolOptionId, { tool: SimulatorToolId; option: 'through-layers' }> = {
  pinThroughLayers: { tool: 'pin', option: 'through-layers' },
};

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
 * the strain notice on its own once the model settles.
 */
export function nextPinNotices(
  current: readonly SimulatorToolNotice[],
  frame: Pick<SimulatorFrameView, 'recovered' | 'maxStrain' | 'converged'>
): readonly SimulatorToolNotice[] {
  let next = current;
  if (frame.recovered === 'reset' && !next.includes('recovered')) next = [...next, 'recovered'];
  if (!frame.converged) return next;
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
  const pull = useSimulatorPull({
    runtime,
    model: bound?.model ?? null,
    ready,
    pinnedCount: pinned.length,
    drawnCamera: options.drawnCamera,
  });
  const { run: runPull, springBack, posed, observeFrame: observePullFrame } = pull;

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
  // The model the worker last dropped unknown ids for, so it is reported once.
  const droppedForRef = useRef<SimulatorModelView | null>(null);
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
        // Ids this model does not have. The rest of the set applied, so the user
        // has nothing to act on; but a pin that names a face its model lacks
        // means ids crossed models somewhere, which is a bug worth seeing once.
        if (outcome.dropped > 0 && droppedForRef.current !== model) {
          droppedForRef.current = model;
          reportError(new Error('simulator pins named faces the model does not have'), {
            surface: 'simulator:pins',
            handled: true,
            tags: { backend: simulatorBackendTag(gpuActive), reason: 'unknown_face' },
          });
        }
      },
      (error: unknown) => {
        if (classifySimulatorCallFailure(error) === 'unexpected') {
          // The translator as of now: this settles long after the render.
          const { t } = live.current;
          toast.error(t('toasts:simulatorPins.updateFailed', "Couldn't pin those faces. Try again."));
          reportError(error, { surface: 'simulator:pins', tags: { backend: simulatorBackendTag(gpuActive) } });
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
      const { options: current, t } = live.current;
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
                t('toasts:simulatorPins.pickFailed', "Couldn't tell which faces are there. Try again.")
              );
              reportError(error, { surface: 'simulator:pick', tags: { backend: simulatorBackendTag(onGpu) } });
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
          trackSimulatorPinsEdited({
            gesture: intent.gesture,
            mode: intent.mode,
            depth: intent.reach,
            outcome: pinPickOutcome(before, after, picked),
            pinnedCount: after.length,
          });
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
          if (gesture.kind !== 'pull') runIntent(pinIntentFor(gesture, currentOptions, surface));
          return;
        case 'pull':
          if (gesture.kind === 'pull') runPull(pullIntentFor(gesture, surface));
          return;
        case 'orbit':
          // Orbit turns the camera in the viewport and finishes no gesture.
          return;
      }
    },
    [runIntent, runPull]
  );

  const selectTool = useCallback((id: SimulatorToolId, source: SimulatorToolSelectSource) => {
    const store = useWorkspaceStore.getState();
    if (store.simulatorActiveToolId === id) return;
    // A box half drawn under one tool means nothing to the next.
    live.current.options.cancelGesture();
    store.setSimulatorActiveTool(id);
    trackSimulatorToolSelected({ tool: id, source });
  }, []);

  const clearPins = useCallback((source: SimulatorPinsClearSource) => {
    const binding = live.current.bound;
    const before = binding ? pinsOf(binding) : EMPTY_PIN_SET;
    if (!binding || before.length === 0) return;
    useWorkspaceStore.getState().setSimulatorPins(binding.revision, binding.sourceKey, EMPTY_PIN_SET);
    trackSimulatorPinsCleared({ source, pinnedCount: before.length });
  }, []);

  const setOption = useCallback(
    (id: SimulatorToolOptionId, value: boolean, source: SimulatorToolOptionSource) => {
      const store = useWorkspaceStore.getState();
      if (store.simulatorToolOptions[id] === value) return;
      store.setSimulatorToolOption(id, value);
      trackSimulatorToolOptionChanged({ ...OPTION_EVENT[id], value, source });
    },
    []
  );

  const exitTool = useCallback((): boolean => {
    if (live.current.options.cancelGesture()) return true;
    if (live.current.activeToolId === RESTING_SIMULATOR_TOOL) return false;
    selectTool(RESTING_SIMULATOR_TOOL, 'escape');
    return true;
  }, [selectTool]);

  // What the frames have said, for the events that read them: where the fold
  // target was when the pins last changed, and which recoveries this model has
  // already reported.
  const framesRef = useRef<{
    pins: PinSet | null;
    lastFold: number | null;
    baseline: number | null;
    moved: boolean;
    model: SimulatorModelView | null;
    recovered: Set<string>;
  }>({ pins: null, lastFold: null, baseline: null, moved: false, model: null, recovered: new Set() });

  // Called once per solver frame, so it compares before it sets: a frame that
  // changes nothing must not cost the panel a render.
  const observeFrame = useCallback((frame: SimulatorFrameView) => {
    observePullFrame(frame);
    const { pinned: current, notices: shown, bound: binding } = live.current;
    const seen = framesRef.current;

    // Once per load per action, pinned or not: the guard used to act silently.
    const model = binding?.model ?? null;
    if (seen.model !== model) {
      seen.model = model;
      seen.recovered = new Set();
    }
    const recovered = frame.recovered ?? null;
    if (recovered && !seen.recovered.has(recovered)) {
      seen.recovered.add(recovered);
      trackSimulatorSolverRecovered({ action: recovered, pinned: current.length > 0 });
    }

    // The first move of the fold target after a pin edit, once per pin set.
    if (seen.pins !== current) {
      seen.pins = current;
      seen.baseline = seen.lastFold;
      seen.moved = false;
    }
    seen.lastFold = frame.foldPercent;
    if (
      current.length > 0 &&
      !seen.moved &&
      seen.baseline !== null &&
      Math.abs(frame.foldPercent - seen.baseline) >= PINNED_FOLD_MOVE_PERCENT
    ) {
      seen.moved = true;
      trackSimulatorPinnedFoldMoved({
        direction: frame.foldPercent > seen.baseline ? 'fold' : 'unfold',
        pinnedCount: current.length,
      });
    }

    if (current.length === 0) return;
    const next = nextPinNotices(shown, frame);
    if (next === shown) return;
    live.current.notices = next;
    setNotices(next);
  }, [observePullFrame]);

  const verbs = useMemo<SimulatorToolVerbs>(
    () => ({ selectTool, clearPins, setOption, springBack }),
    [selectTool, clearPins, setOption, springBack]
  );

  const shortcuts = useMemo<SimulatorToolShortcutHandlers>(
    () => ({
      selectTool: (tool, source) => selectTool(tool, source),
      exitTool,
      clearPins: (source) => clearPins(source),
      togglePinThroughLayers: (source) =>
        setOption('pinThroughLayers', !live.current.toolOptions.pinThroughLayers, source),
      springBack: (source) => springBack(source),
    }),
    [selectTool, exitTool, clearPins, setOption, springBack]
  );

  const view = useMemo<SimulatorToolsView>(
    () => ({ activeToolId, pinnedCount: pinned.length, options: toolOptions, notices, posed }),
    [activeToolId, pinned.length, toolOptions, notices, posed]
  );

  const tool = simulatorTool(activeToolId);
  const enabled = ready && bound !== null;
  // Pull pulls against the pins: with none, the cursor says so before a press.
  const refused = tool.input === 'pull' && pinned.length === 0;
  const toolInput = useMemo<SimulatorViewportToolInput>(
    () => ({ mode: tool.input, cursor: tool.cursor, enabled, refused, onGesture: runGesture }),
    [tool, enabled, refused, runGesture]
  );
  const boundModel = bound?.model ?? null;
  const highlights = useMemo(() => pinnedHighlights(boundModel, pinned), [boundModel, pinned]);

  return {
    view,
    tool,
    pinned,
    enabled,
    toolInput,
    highlights,
    verbs,
    shortcuts,
    runGesture,
    observeFrame,
  };
}
