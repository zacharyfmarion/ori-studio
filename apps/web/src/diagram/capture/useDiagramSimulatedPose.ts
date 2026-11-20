import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { FoldDocument as SimulatorFoldDocument } from '@treemaker/origami-simulator';
import type { CpSheetRegion } from '../../cp-workspace/sheets/cpSheetRegions';
import type { KnownCreases } from './captureCreases';
import { stepSheet } from './linkStatus';
import { withRollAbsorbed, type SimulatorOrbitView } from '../../lib/simulatorOrbit';
import { DEFAULT_SIMULATOR_SETTINGS, simulatorMaterialOptions } from '../../lib/simulatorSettings';
import { FoldPlayhead } from '../../simulator/foldPlayhead';
import type { SimulatorViewportHandle } from '../../simulator/SimulatorViewport';
import { useSimulatorShortcuts } from '../../simulator/useSimulatorShortcuts';
import {
  useSimulatorRuntime,
  type SimulatorFrameView,
  type SimulatorRuntime,
} from '../../simulator/useSimulatorRuntime';
import { useWorkerGpuSupport } from '../../simulator/workerGpuSupport';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  SIMULATED_FRAME_PX,
  storeSimulationFold,
} from '../../store/workspaceStore/diagramCapture';
import {
  releaseSimulatorClient,
  retainSimulatorClient,
} from '../../store/workspaceStore/simulatorRuntime';
import type { DiagramCpScope, DiagramSimulatedShape, DiagramSimulatedView } from '../document/diagramDocument';
import { diagramPaperStyle } from '../pictures/diagramPaperStyle';
import { trackDiagramSimulationResumed } from '../../analytics';
import { registerSimulatedSaveNow } from './openLinkedPose';
import { sameCamera, type SimulatedCapture, type SimulatedSave } from './poseController';
import { savedShapeOf, simulatorShapeOf, storedSimulatedShape } from './simulatedShape';
import { useCpSheetIndexState } from '../../cp-workspace/sheets/useCpSheetIndexState';

/** Fold % per arrow press and per Step: Simulate's and an inline window's. */
const FOLD_STEP_PERCENT = 5;

/** How often the fold readout follows the playhead while it plays. */
const READOUT_INTERVAL_MS = 66;

/**
 * The simulator's own defaults, not the Simulate workspace's settings: a step's
 * picture must not change with a reader's preferences, and its 0% picture
 * takes none either.
 */
const MATERIAL = simulatorMaterialOptions(DEFAULT_SIMULATOR_SETTINGS);

/** The render edge the shared canvas opens at, before the view reports its size. */
const INITIAL_RENDER_EDGE = 512;

/** What a fold % is stored to: a tenth of a percent, so a pause mid-play is one pose. */
function storedPercent(percent: number): number {
  return Math.round(percent * 10) / 10;
}

/** Whether a pose is where another is, to well under what a drag or a slider step moves. */
function samePose(
  a: { foldPercent: number; view: DiagramSimulatedView },
  b: { foldPercent: number; view: DiagramSimulatedView }
): boolean {
  return Math.abs(a.foldPercent - b.foldPercent) < 0.05 && sameCamera(a.view, b.view);
}

/**
 * Whether a step Pose cannot put positions back on is, untouched, as the step
 * already is: at 0%, the flat sheet a fold from flat is; or one whose shape is
 * another build's, which an untouched Pose never replaces.
 */
function keptWithoutPositions(render: DiagramSimulatedPoseRender): boolean {
  return render.foldPercent === 0 || (render.shape !== undefined && savedShapeOf(render.shape) === null);
}

/** A step's camera as the viewport's orbit holds it: its roll kept in the orientation. */
function poseView(orbit: SimulatorOrbitView): DiagramSimulatedView {
  const kept = withRollAbsorbed(orbit);
  return kept.orient
    ? { yaw: kept.yaw, pitch: kept.pitch, zoom: kept.zoom, orient: kept.orient }
    : { yaw: kept.yaw, pitch: kept.pitch, zoom: kept.zoom };
}

/**
 * Where Pose's simulator is:
 * - `loading`: the region's model is being built, or the solver is loading it;
 * - `ready`: live, and the transport and the keys are its;
 * - `no-pattern`: no crease pattern is open to fold the region from;
 * - `missing`: the region is not in the crease pattern any more;
 * - `unavailable`: the region has no model the simulator can fold, or the
 *   pattern could not be segmented;
 * - `no-gpu`: the simulator's worker has no WebGL2, so nothing can be drawn
 *   live (an inline window is GPU-only for the same reason);
 * - `error`: the solver failed.
 */
export type DiagramSimulatedPoseStatus =
  | 'loading'
  | 'ready'
  | 'no-pattern'
  | 'missing'
  | 'unavailable'
  | 'no-gpu'
  | 'error';

/** A step's simulated render, as Pose opens it and follows it. */
export interface DiagramSimulatedPoseRender {
  foldPercent: number;
  view: DiagramSimulatedView;
  shape?: DiagramSimulatedShape;
}

export interface DiagramSimulatedPose {
  status: DiagramSimulatedPoseStatus;
  error: string | null;
  viewportRef: RefObject<SimulatorViewportHandle | null>;
  runtime: Pick<SimulatorRuntime, 'gpuActive' | 'setRenderSettings'>;
  /** The viewport moved its camera: drawn, and saved with the rest when Pose saves. */
  pushCamera: (view: SimulatorOrbitView, width: number, height: number) => void;
  /** The camera the view shows, as the step would store it; null before the first draw. */
  view: DiagramSimulatedView | null;
  /** The view's size in the device px it draws at; null before the first draw. */
  size: { width: number; height: number } | null;
  /** Whether the view shows the pose the step's picture was captured at, settled or held there. */
  atStored: boolean;
  /**
   * Opened on positions the step saved before its solver settled, and nothing
   * has moved them since: the model is held where it was saved, its solver
   * still, until {@link resume} — or play, a scrub, a step, Back to Flat.
   */
  held: boolean;
  /** Let held positions go on: the solver resumes from them, at rest, toward their fold %. */
  resume: () => void;
  playing: boolean;
  /** The fold %, as the slider and the readout show it. */
  foldPercent: number;
  togglePlay: () => void;
  /** Fold on to the next {@link FOLD_STEP_PERCENT}. */
  step: () => void;
  scrub: (percent: number) => void;
  /** Back to flat, the camera kept. */
  rewind: () => void;
}

/**
 * Pose's live simulator for a step shown as Simulated (D19): the region's
 * model in the simulator's worker, opened on the positions the step saved —
 * held there, still, as they were — or, for a step saved without them or one
 * whose creases changed since, folded from flat at the step's fold % and
 * camera; the transport and the simulator's keys while it is shown.
 *
 * Nothing is captured as the model moves or rests. Leaving Pose — Done,
 * Escape, another step — saves what it shows at that moment, through
 * `onSave`, which is the step's pose controller: the positions, the picture
 * drawn from them at the camera shown, the fold % and whether the solver had
 * settled, read in one worker call, the worker held until it answers. So does
 * Refresh on the step while it is open here (`registerSimulatedSaveNow`).
 * A view untouched since it opened on the step's own positions saves nothing,
 * unless the step's picture is out of date (`wantsSave`): what it shows is
 * the step as it is.
 *
 * The model is the one the step's 0% picture is drawn from
 * (`storeSimulationFold`), so 0% here and headless are one picture.
 */
export function useDiagramSimulatedPose({
  stepId,
  scope,
  known,
  render,
  onSave,
  wantsSave,
}: {
  stepId: string;
  scope: DiagramCpScope;
  /** What the step remembers of its creases: its sheet is found wherever it is now. */
  known: KnownCreases;
  /** The step's simulated pose: what the view opens at, and follows on an undo. */
  render: DiagramSimulatedPoseRender;
  onSave: (save: SimulatedSave) => Promise<void>;
  /** Whether a save would commit anything, `untouched` the view still the step's own positions. */
  wantsSave: (untouched: boolean) => boolean;
}): DiagramSimulatedPose {
  // The sheet's model, built as the 0% picture builds it, again whenever the
  // pattern's sheet index is.
  const sheets = useCpSheetIndexState(true);
  const index = sheets.status === 'ready' ? sheets.index : null;
  const document = useWorkspaceStore((state) => state.oristudioCpDocument?.document ?? null);
  const { fingerprint, drawn } = known;
  const sheet = useMemo(
    // Undefined while the index is not ready; null when the sheet is gone.
    () => (index ? stepSheet(scope, { fingerprint, drawn }, document, index) : undefined),
    [index, scope, fingerprint, drawn, document]
  );
  const [model, setModel] = useState<{ sheet: CpSheetRegion; fold: SimulatorFoldDocument | null } | null>(null);
  useEffect(() => {
    if (!sheet) return undefined;
    let live = true;
    const store = { get: useWorkspaceStore.getState, set: useWorkspaceStore.setState };
    void storeSimulationFold(store, sheet).then((fold) => {
      if (live) setModel({ sheet, fold: fold as unknown as SimulatorFoldDocument | null });
    });
    return () => {
      live = false;
    };
  }, [sheet]);
  const fold = sheet && model?.sheet === sheet ? model.fold : undefined;

  const gpu = useWorkerGpuSupport();
  const bitmapOutput = useMemo(
    () => (gpu === true ? { width: INITIAL_RENDER_EDGE, height: INITIAL_RENDER_EDGE } : null),
    [gpu]
  );

  const viewportRef = useRef<SimulatorViewportHandle | null>(null);
  const playheadRef = useRef(new FoldPlayhead(render.foldPercent));
  const [foldPercent, setFoldPercentShown] = useState(render.foldPercent);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<DiagramSimulatedView | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [settled, setSettled] = useState(false);
  const [held, setHeld] = useState(false);

  // Read when Pose saves: refs, so a frame or a drag re-renders nothing.
  const viewRef = useRef<DiagramSimulatedView | null>(null);
  const convergedRef = useRef(false);
  const playingRef = useRef(false);
  const readyRef = useRef(false);
  /** The render the view last went to: the one it opened on, or one it followed. */
  const followedRef = useRef(render);
  /** The model is in the step's own stored positions: put back, and nothing has moved the fold or let them go on since. */
  const ownShapeRef = useRef(false);
  /** The positions shown were saved unsettled and nothing has let them go on: {@link DiagramSimulatedPose.held}. */
  const heldRef = useRef(false);
  /**
   * The saves handed over and not yet seen come back, oldest first: a save of
   * one of them landing is the view's own pose, or one it has moved on from,
   * never a change to follow.
   */
  const sentRef = useRef<{ foldPercent: number; view: DiagramSimulatedView }[]>([]);
  const lastPublishedRef = useRef(0);
  const captureRef = useRef<SimulatorRuntime['stillCapture'] | null>(null);
  const handOver = useRef({ onSave, wantsSave });
  useLayoutEffect(() => {
    handOver.current = { onSave, wantsSave };
  }, [onSave, wantsSave]);

  const hold = useCallback((next: boolean) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  /**
   * Save the model as it is shown now: the worker asked at once for its
   * picture, its positions and whether it had settled, held until it answers,
   * and the save handed over with the fold % and camera shown — the stored
   * camera while the view is still at it, so float noise is no change.
   * Nothing when there is no model up, or nothing a save would commit.
   */
  const save = useCallback(() => {
    const capture = captureRef.current;
    const { diagram } = useWorkspaceStore.getState();
    const stored = followedRef.current;
    const shown = viewRef.current ?? stored.view;
    const atStoredCamera = sameCamera(shown, stored.view);
    const untouched = ownShapeRef.current && atStoredCamera;
    if (!capture || !diagram || !readyRef.current || !handOver.current.wantsSave(untouched)) return;
    const view = atStoredCamera ? stored.view : shown;
    const foldPercent = storedPercent(playheadRef.current.value);
    // Held positions are the unsettled ones they were saved as, whatever the still solver says.
    const unsettled = heldRef.current;
    retainSimulatorClient();
    const pending: Promise<SimulatedCapture | null> = capture({
      view,
      size: SIMULATED_FRAME_PX,
      style: diagramPaperStyle(diagram.style),
      markHidden: true,
    })
      .then((captured): SimulatedCapture | null => {
        if (!captured) return null;
        const shape = storedSimulatedShape(captured.shape, captured.settled && !unsettled);
        return shape ? { scene: captured.scene, shape } : { scene: captured.scene };
      })
      .catch(() => null)
      .finally(releaseSimulatorClient);
    sentRef.current.push({ foldPercent, view });
    void handOver.current.onSave({ foldPercent, view, capture: pending });
  }, []);

  // Leaving Pose — Done, Escape, another step — saves what it shows. Declared
  // before the runtime, so this runs before the runtime lets its model go:
  // the capture is asked for first, and the worker answers in order.
  useEffect(() => () => save(), [save]);

  /** The user moved the fold: the view is not the step's positions, and held ones go on. */
  const foldMoved = useCallback(() => {
    ownShapeRef.current = false;
    if (heldRef.current) hold(false);
  }, [hold]);

  const handleFrame = useCallback(
    (frame: SimulatorFrameView) => {
      viewportRef.current?.showFrame(frame);
      const wasConverged = convergedRef.current;
      convergedRef.current = frame.converged;
      if (frame.converged !== wasConverged) setSettled(frame.converged);
    },
    []
  );

  // The step's positions, for the model to open on: put back before its first
  // frame, and counted settled there, so nothing moves them until something
  // changes. Read at load, as the fold % is.
  const storedShape = render.shape;
  const initialShape = useMemo(() => simulatorShapeOf(storedShape), [storedShape]);

  const runtime = useSimulatorRuntime({
    fold: gpu === true && fold ? fold : null,
    // Read when a model loads: the step's pose at first, the playhead's after.
    solverOptions: { ...MATERIAL, foldPercent },
    triangulate: true,
    canvas: null,
    bitmapOutput,
    initialShape,
    onFrame: handleFrame,
  });
  const { setFoldPercent, setCamera, reset, restoreShape, stillCapture, status: runtimeStatus, model: loaded } = runtime;
  useLayoutEffect(() => {
    captureRef.current = stillCapture;
    readyRef.current = runtimeStatus === 'ready';
  }, [stillCapture, runtimeStatus]);

  // A model up: on the step's own positions when they were put back — held
  // there if they were saved unsettled — or folded from flat when the step has
  // none, or they are another sheet's.
  useEffect(() => {
    if (!loaded) return;
    const opened = loaded.restored !== null && loaded.restored !== 'mismatch';
    ownShapeRef.current = opened || keptWithoutPositions(followedRef.current);
    hold(opened && savedShapeOf(followedRef.current.shape)?.settled === false);
  }, [loaded, hold]);

  // Refresh from beside the open step: save what it shows now.
  useEffect(() => registerSimulatedSaveNow(stepId, save), [stepId, save]);

  // The step's pose changed from outside — an undo, Reset — so the view goes
  // to it: its positions put back, or for a render with none, folded freely
  // from flat to its fold %. A save it sent landing is where the view is, or a
  // pose it has moved on from: not followed.
  useEffect(() => {
    if (followedRef.current === render) return;
    const sent = sentRef.current;
    let match = -1;
    for (let index = sent.length - 1; index >= 0; index -= 1) {
      if (samePose(sent[index]!, render)) {
        match = index;
        break;
      }
    }
    followedRef.current = render;
    if (match >= 0) {
      sent.splice(0, match + 1);
      return;
    }
    sentRef.current = [];
    const shown = viewRef.current;
    if (!shown || !sameCamera(shown, render.view)) viewportRef.current?.setView(render.view);
    const moved = Math.abs(playheadRef.current.value - render.foldPercent) >= 0.05;
    playingRef.current = false;
    setPlaying(false);
    playheadRef.current.set(render.foldPercent);
    setFoldPercentShown(render.foldPercent);
    const shape = simulatorShapeOf(render.shape);
    ownShapeRef.current = shape !== null || keptWithoutPositions(render);
    hold(shape !== null && savedShapeOf(render.shape)?.settled === false);
    void (async () => {
      if (shape) {
        const restored = await restoreShape(render.foldPercent, shape);
        if (restored && restored !== 'mismatch') return;
        // Another sheet's: folded freely from flat, as a render with none is.
        if (followedRef.current !== render) return;
        ownShapeRef.current = keptWithoutPositions(render);
        hold(false);
      } else if (!moved) {
        // None, and already at its fold %: the paper stays as it is.
        return;
      }
      await restoreShape(render.foldPercent, null);
    })();
  }, [render, restoreShape, hold]);

  const pushCamera = useCallback(
    (orbit: SimulatorOrbitView, width: number, height: number) => {
      setCamera(orbit, width, height);
      const shown = poseView(orbit);
      viewRef.current = shown;
      setView(shown);
      setSize((was) => (was?.width === width && was.height === height ? was : { width, height }));
    },
    [setCamera]
  );

  const scrub = useCallback(
    (percent: number) => {
      playingRef.current = false;
      setPlaying(false);
      playheadRef.current.set(percent);
      const next = playheadRef.current.value;
      setFoldPercentShown(next);
      setFoldPercent(next);
      foldMoved();
    },
    [setFoldPercent, foldMoved]
  );

  const rewind = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    playheadRef.current.set(0);
    setFoldPercentShown(0);
    reset();
    foldMoved();
  }, [reset, foldMoved]);

  const step = useCallback(() => {
    scrub(Math.min(100, Math.floor(playheadRef.current.value / FOLD_STEP_PERCENT + 1) * FOLD_STEP_PERCENT));
  }, [scrub]);

  const togglePlay = useCallback(() => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    foldMoved();
  }, [foldMoved]);

  const resume = useCallback(() => {
    if (!heldRef.current) return;
    foldMoved();
    // The same fold target again, which sets the solver going from where it is held.
    setFoldPercent(playheadRef.current.value);
    trackDiagramSimulationResumed();
  }, [foldMoved, setFoldPercent]);

  // Play advances the fold target over time; the worker does the solving.
  const percentPerSecond = DEFAULT_SIMULATOR_SETTINGS.foldPlayPercentPerSecond;
  useEffect(() => {
    if (!playing || runtimeStatus !== 'ready') return undefined;
    const playhead = playheadRef.current;
    if (playhead.begin().rewound) reset();
    let previous: number | null = null;
    let raf = 0;
    const tick = (time: number) => {
      if (previous === null) previous = time;
      const elapsedSeconds = Math.min(0.08, (time - previous) / 1000);
      previous = time;
      const next = playhead.advance(elapsedSeconds, percentPerSecond);
      setFoldPercent(next);
      // The readout follows the playhead, which is this loop's: a solver's
      // frames come as fast as its device draws, which can be seldom.
      if (time - lastPublishedRef.current > READOUT_INTERVAL_MS || next >= 100) {
        lastPublishedRef.current = time;
        setFoldPercentShown(next);
      }
      if (next >= 100) {
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      playhead.end();
      setFoldPercentShown(playhead.value);
    };
  }, [playing, runtimeStatus, setFoldPercent, reset, percentPerSecond]);

  const status: DiagramSimulatedPoseStatus =
    sheets.status === 'no-pattern'
      ? 'no-pattern'
      : sheets.status === 'failed'
        ? 'unavailable'
        : sheet === null
          ? 'missing'
          : gpu === false
            ? 'no-gpu'
            : fold === null
              ? 'unavailable'
              : runtimeStatus === 'error'
                ? 'error'
                : runtimeStatus === 'ready'
                  ? 'ready'
                  : 'loading';

  // The simulator's keys while it is shown, as in Simulate: its scope sits
  // ahead of the Diagram's, so Space, the arrows, Home, R and the view keys
  // are its, and `[` / `]`, Escape and Undo are still Pose's.
  useSimulatorShortcuts({
    active: status === 'ready',
    foldStepPercent: FOLD_STEP_PERCENT,
    handlers: {
      playPause: togglePlay,
      nudgeFold: (delta) => scrub(playheadRef.current.value + delta),
      setFoldPercent: scrub,
      rewind,
      restart: () => {
        rewind();
        viewportRef.current?.resetView();
      },
      resetView: () => viewportRef.current?.resetView(),
      zoomBy: (factor) => viewportRef.current?.zoomBy(factor),
    },
  });

  const atStored = (settled || held) && view !== null && !playing && samePose({ foldPercent, view }, render);

  return {
    status,
    error: runtime.error,
    viewportRef,
    runtime: { gpuActive: runtime.gpuActive, setRenderSettings: runtime.setRenderSettings },
    pushCamera,
    view,
    size,
    atStored,
    held: held && status === 'ready',
    resume,
    playing,
    foldPercent,
    togglePlay,
    step,
    scrub,
    rewind,
  };
}
