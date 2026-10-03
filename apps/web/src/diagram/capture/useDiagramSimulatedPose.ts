import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { FoldDocument as SimulatorFoldDocument } from '@treemaker/origami-simulator';
import { resolveRegion } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments, type CpSegment } from '../../lib/creasePatternSegmentation';
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
import type { DiagramCpScope, DiagramSimulatedView } from '../document/diagramDocument';
import { diagramPaperStyle } from '../pictures/diagramPaperStyle';
import type { PaperScene } from '../../lib/paper/paperScene';
import { registerSimulatedRestNow } from './openLinkedPose';
import { ORBIT_SETTLE_MS, sameCamera, type SimulatedRest } from './poseController';
import { useCpSegmentationState } from './useLinkStatus';

/** Fold % per arrow press and per Step: Simulate's and an inline window's. */
const FOLD_STEP_PERCENT = 5;

/** How often the fold readout follows the playhead while it plays. */
const READOUT_INTERVAL_MS = 66;

/**
 * How long a rest waits for the solver to settle before it is captured as it
 * is: a model can oscillate above the solver's epsilon for good, and Pose must
 * still capture it.
 */
const MAX_SETTLE_WAIT_MS = 4000;

/** How often a rest looks again while the solver settles. */
const SETTLE_RECHECK_MS = 150;

/**
 * How far the worker settles a model before the scene Pose takes as it
 * closes: the solver's own bound for a settle, enough for a move it had no
 * time to finish.
 */
const CLOSING_SETTLE_STEPS = 20_000;

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

export interface DiagramSimulatedPose {
  status: DiagramSimulatedPoseStatus;
  error: string | null;
  viewportRef: RefObject<SimulatorViewportHandle | null>;
  runtime: Pick<SimulatorRuntime, 'gpuActive' | 'setRenderSettings'>;
  /** The viewport moved its camera: drawn, and captured once it rests. */
  pushCamera: (view: SimulatorOrbitView, width: number, height: number) => void;
  /** The camera the view shows, as the step would store it; null before the first draw. */
  view: DiagramSimulatedView | null;
  /** The view's size in the device px it draws at; null before the first draw. */
  size: { width: number; height: number } | null;
  /** Whether the view shows the pose the step's picture was captured at, settled. */
  atStored: boolean;
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
 * model in the simulator's worker, loaded at the step's fold % and camera, the
 * transport and the simulator's keys while it is shown, and every rest
 * captured — the fold and the camera still for a moment, the solver settled —
 * through `onRest`, which is the step's pose controller. A rest's scene is
 * taken the moment it rests, with the worker held until it answers, so a rest
 * that waits behind another is of its own pose, and one sent as Pose closes
 * is answered by a worker the closing would otherwise end. The rest is captured
 * only when it is not the picture the step has (`PoseController.simulate`), so
 * opening Pose writes nothing unless the step is out of date: that is "Pose
 * again". Leaving Pose with a rest still pending captures it then.
 *
 * The model is the one the step's 0% picture is drawn from
 * (`storeSimulationFold`), so 0% here and headless are one picture.
 */
export function useDiagramSimulatedPose({
  stepId,
  scope,
  render,
  onRest,
  wantsRest,
}: {
  stepId: string;
  scope: DiagramCpScope;
  /** The step's simulated pose: what the view opens at, and follows on an undo. */
  render: { foldPercent: number; view: DiagramSimulatedView };
  onRest: (rest: SimulatedRest) => Promise<void>;
  /** Whether a rest at this pose would be captured: asked before its scene is drawn. */
  wantsRest: (pose: Pick<SimulatedRest, 'foldPercent' | 'view'>) => boolean;
}): DiagramSimulatedPose {
  // The region's model, built as the 0% picture builds it, again whenever the
  // pattern's segmentation is.
  const segmentation = useCpSegmentationState(true);
  const artifacts = segmentation.status === 'ready' ? segmentation.artifacts : null;
  const segment = useMemo(
    () => (artifacts ? resolveRegion(scope.region, resolveCpSegments(artifacts)) : undefined),
    [artifacts, scope.region]
  );
  const [model, setModel] = useState<{ segment: CpSegment; fold: SimulatorFoldDocument | null } | null>(null);
  useEffect(() => {
    if (!segment) return undefined;
    let live = true;
    const store = { get: useWorkspaceStore.getState, set: useWorkspaceStore.setState };
    void storeSimulationFold(store, segment).then((fold) => {
      if (live) setModel({ segment, fold: fold as unknown as SimulatorFoldDocument | null });
    });
    return () => {
      live = false;
    };
  }, [segment]);
  const fold = segment && model?.segment === segment ? model.fold : undefined;

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

  // The rest, read when its timer fires: refs, so a frame or a drag re-renders nothing.
  const viewRef = useRef<DiagramSimulatedView | null>(null);
  const convergedRef = useRef(false);
  const playingRef = useRef(false);
  /** Since when a rest has waited for the solver: the last move, or the model coming up. */
  const waitFromRef = useRef(0);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A move not yet captured: what leaving Pose captures. */
  const dirtyRef = useRef(false);
  /**
   * The rests handed over and not yet seen come back, oldest first: a capture
   * of one of them landing is the view's own pose, or one it has moved on
   * from, never a change to follow.
   */
  const sentRef = useRef<{ foldPercent: number; view: DiagramSimulatedView }[]>([]);
  const lastPublishedRef = useRef(0);
  const restRef = useRef<() => void>(() => {});
  const stillRef = useRef<SimulatorRuntime['stillScene'] | null>(null);
  const handOver = useRef({ onRest, wantsRest });
  useLayoutEffect(() => {
    handOver.current = { onRest, wantsRest };
  }, [onRest, wantsRest]);

  /**
   * Hand a rest over with its scene asked for now — of this pose, from a live
   * session — and the worker held until it answers. Nothing for a rest that
   * would not be captured.
   */
  const sendRest = useCallback((rest: { foldPercent: number; view: DiagramSimulatedView }, settleSteps?: number) => {
    const still = stillRef.current;
    const { diagram } = useWorkspaceStore.getState();
    if (!still || !diagram || !handOver.current.wantsRest(rest)) return;
    retainSimulatorClient();
    const pending: Promise<PaperScene | null> = still({
      view: rest.view,
      size: SIMULATED_FRAME_PX,
      style: diagramPaperStyle(diagram.style),
      markHidden: true,
      settleSteps,
    })
      .catch(() => null)
      .finally(releaseSimulatorClient);
    sentRef.current.push(rest);
    void handOver.current.onRest({ ...rest, still: () => pending });
  }, []);

  const arm = useCallback((delay: number = ORBIT_SETTLE_MS) => {
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => {
      restTimer.current = null;
      restRef.current();
    }, delay);
  }, []);
  /** The user moved the fold or the camera: capture where it comes to rest. */
  const moved = useCallback(() => {
    waitFromRef.current = performance.now();
    dirtyRef.current = true;
    arm();
  }, [arm]);

  // Leaving Pose — Done, Escape, another step — with a move not yet captured
  // captures it, the solver settled first in the worker: there is no time to
  // wait for it here. Declared before the runtime, so this runs before the
  // runtime lets its model go: the scene is asked for first, and the worker
  // answers in order.
  useEffect(
    () => () => {
      if (restTimer.current) clearTimeout(restTimer.current);
      const shown = viewRef.current;
      if (!dirtyRef.current || !shown) return;
      sendRest({ foldPercent: storedPercent(playheadRef.current.value), view: shown }, CLOSING_SETTLE_STEPS);
    },
    [sendRest]
  );

  const handleFrame = useCallback(
    (frame: SimulatorFrameView) => {
      viewportRef.current?.showFrame(frame);
      // Not `playhead.report`: here the playhead alone says where the fold is
      // going, and a frame the worker began before a scrub reports the target
      // the scrub just left — read back, it would capture the old fold.
      const wasConverged = convergedRef.current;
      convergedRef.current = frame.converged;
      if (frame.converged !== wasConverged) setSettled(frame.converged);
    },
    []
  );

  const runtime = useSimulatorRuntime({
    fold: gpu === true && fold ? fold : null,
    // Read when a model loads: the step's pose at first, the playhead's after.
    solverOptions: { ...MATERIAL, foldPercent },
    triangulate: true,
    canvas: null,
    bitmapOutput,
    onFrame: handleFrame,
  });
  const { setFoldPercent, setCamera, reset, stillScene, status: runtimeStatus } = runtime;
  useLayoutEffect(() => {
    stillRef.current = stillScene;
  }, [stillScene]);

  // A rest: captured once the solver has settled, or has had long enough.
  useEffect(() => {
    restRef.current = () => {
      if (playingRef.current || runtimeStatus !== 'ready') return;
      const shown = viewRef.current;
      // The model up before the view has said where it looks: wait for it.
      if (!shown) {
        arm(SETTLE_RECHECK_MS);
        return;
      }
      if (!convergedRef.current && performance.now() - waitFromRef.current < MAX_SETTLE_WAIT_MS) {
        arm(SETTLE_RECHECK_MS);
        return;
      }
      dirtyRef.current = false;
      sendRest({ foldPercent: storedPercent(playheadRef.current.value), view: shown });
    };
  });

  // Pose Again from beside the open step: a rest now, waiting for the solver
  // if it is still on its way.
  useEffect(
    () =>
      registerSimulatedRestNow(stepId, () => {
        waitFromRef.current = performance.now();
        restRef.current();
      }),
    [stepId]
  );

  // The step's pose changed from outside — an undo, Reset — so the view goes
  // to it. A capture of a rest it sent is where the view is, or a pose it has
  // moved on from: not followed.
  useEffect(() => {
    const sent = sentRef.current;
    let match = -1;
    for (let index = sent.length - 1; index >= 0; index -= 1) {
      if (samePose(sent[index]!, render)) {
        match = index;
        break;
      }
    }
    if (match >= 0) {
      sent.splice(0, match + 1);
      return;
    }
    sentRef.current = [];
    const shown = viewRef.current;
    if (!shown || !sameCamera(shown, render.view)) viewportRef.current?.setView(render.view);
    if (Math.abs(playheadRef.current.value - render.foldPercent) >= 0.05) {
      playingRef.current = false;
      setPlaying(false);
      playheadRef.current.set(render.foldPercent);
      setFoldPercentShown(render.foldPercent);
      setFoldPercent(render.foldPercent);
    }
    dirtyRef.current = false;
    if (restTimer.current) clearTimeout(restTimer.current);
  }, [render, setFoldPercent]);

  // The model up: a first rest, which captures nothing unless the step's
  // picture is out of date — Pose again, for a model that settles or not.
  // After the effect above, which clears the rest timer as it follows: in
  // the same pass this one must come second, or the first rest goes with it.
  useEffect(() => {
    if (runtimeStatus !== 'ready') return;
    waitFromRef.current = performance.now();
    arm();
  }, [runtimeStatus, arm]);

  const pushCamera = useCallback(
    (orbit: SimulatorOrbitView, width: number, height: number) => {
      setCamera(orbit, width, height);
      const shown = poseView(orbit);
      const before = viewRef.current;
      viewRef.current = shown;
      setView(shown);
      setSize((was) => (was?.width === width && was.height === height ? was : { width, height }));
      // A resize or the view following the step moves nothing worth a capture.
      if (before && !sameCamera(before, shown)) moved();
    },
    [setCamera, moved]
  );

  const scrub = useCallback(
    (percent: number) => {
      playingRef.current = false;
      setPlaying(false);
      playheadRef.current.set(percent);
      const next = playheadRef.current.value;
      setFoldPercentShown(next);
      setFoldPercent(next);
      moved();
    },
    [setFoldPercent, moved]
  );

  const rewind = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    playheadRef.current.set(0);
    setFoldPercentShown(0);
    reset();
    moved();
  }, [reset, moved]);

  const step = useCallback(() => {
    scrub(Math.min(100, Math.floor(playheadRef.current.value / FOLD_STEP_PERCENT + 1) * FOLD_STEP_PERCENT));
  }, [scrub]);

  const togglePlay = useCallback(() => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    // Paused: where it stopped is a rest.
    if (!next) moved();
  }, [moved]);

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
        moved();
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
  }, [playing, runtimeStatus, setFoldPercent, reset, moved, percentPerSecond]);

  const status: DiagramSimulatedPoseStatus =
    segmentation.status === 'no-pattern'
      ? 'no-pattern'
      : segmentation.status === 'failed'
        ? 'unavailable'
        : segment === null
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

  const atStored = settled && view !== null && !playing && samePose({ foldPercent, view }, render);

  return {
    status,
    error: runtime.error,
    viewportRef,
    runtime: { gpuActive: runtime.gpuActive, setRenderSettings: runtime.setRenderSettings },
    pushCamera,
    view,
    size,
    atStored,
    playing,
    foldPercent,
    togglePlay,
    step,
    scrub,
    rewind,
  };
}
