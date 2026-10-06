import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { CameraUniforms } from '@treemaker/origami-simulator';
import {
  trackSimulatorModelPulled,
  trackSimulatorPoseReleased,
  trackSimulatorPullRefused,
  type SimulatorPoseReleaseSource,
} from '../analytics';
import { reportError } from '../monitoring';
import type { SimulatorPullStart } from './pickQuery';
import { classifySimulatorCallFailure, simulatorBackendTag } from './simulatorCallFailure';
import type { SimulatorDrawnView } from './simulatorSession';
import type { SimulatorHandChange } from './tools/toolState';
import type { SimulatorPullIntent } from './tools/types';
import type { SimulatorFrameView, SimulatorModelView, SimulatorRuntime } from './useSimulatorRuntime';

/** The runtime calls a pull makes. */
export type SimulatorPullRuntime = Pick<
  SimulatorRuntime,
  'gpuActive' | 'beginPull' | 'movePull' | 'endPull' | 'releasePose'
>;

export interface UseSimulatorPullOptions {
  runtime: SimulatorPullRuntime;
  /** The model on screen: a pull is made on its picture, and ends with it. */
  model: SimulatorModelView | null;
  ready: boolean;
  /** Faces pinned on that model. A pull pulls against them, so none refuses it. */
  pinnedCount: number;
  /** The camera of the canvas-2D path's last frame; null on the GPU path or before one. */
  drawnCamera: () => CameraUniforms | null;
  /**
   * A pose kept, sprung back or taken back by the fold, once the worker has
   * said so. Read when the answer arrives, so it need not be stable.
   */
  onHandChange?: (change: SimulatorHandChange) => void;
}

export interface SimulatorPull {
  /** One step of a pull gesture: press, move, let go or abandon. */
  run: (intent: SimulatorPullIntent) => void;
  /** Let the pose a pull left go: the paper springs back to the fold. */
  springBack: (source: Exclude<SimulatorPoseReleaseSource, 'fold-control' | 'restart'>) => void;
  /** The paper holds a pose a pull left it in. */
  posed: boolean;
  /** Every solver frame: whether the paper is posed, and what ended a pose. */
  observeFrame: (frame: SimulatorFrameView) => void;
}

/** A pull in progress: the model it was pressed on, and how the press went. */
interface PullInHand {
  model: SimulatorModelView;
  start: Promise<SimulatorPullStart | null>;
  touch: boolean;
}

/**
 * The Pull tool, bound: the one place a pull has effects.
 *
 * A pull is a lane rather than a gesture: the press grips (or is refused, and
 * says why), moves draw the paper toward the cursor, and letting go keeps the
 * shape — or, abandoned, puts it back. Every step after the press waits on the
 * press's answer, so a quick drag cannot let go of a pull that has not started.
 * Whether the paper is posed comes from the solver's frames, the only owner of
 * that state.
 */
export function useSimulatorPull(options: UseSimulatorPullOptions): SimulatorPull {
  const { t } = useTranslation();
  const [posed, setPosed] = useState(false);
  // What the callbacks read. Assigned in an effect rather than during render,
  // which React may discard.
  const live = useRef({ options, posed, t });
  useEffect(() => {
    live.current = { options, posed, t };
  });
  const inHandRef = useRef<PullInHand | null>(null);

  const failed = useCallback((error: unknown, gpuActive: boolean) => {
    if (classifySimulatorCallFailure(error) !== 'unexpected') return;
    toast.error(live.current.t('toasts:simulatorPull.failed', "Couldn't pull the paper. Try again."));
    reportError(error, { surface: 'simulator:pull', tags: { backend: simulatorBackendTag(gpuActive) } });
  }, []);

  /**
   * The frame a pull is measured against: undefined on the GPU path, whose
   * camera the worker has; null on the canvas-2D path before anything is drawn.
   */
  const drawnView = useCallback((): SimulatorDrawnView | undefined | null => {
    const { runtime, drawnCamera } = live.current.options;
    if (runtime.gpuActive) return undefined;
    const camera = drawnCamera();
    return camera ? { camera, perspective: false } : null;
  }, []);

  const run = useCallback(
    (intent: SimulatorPullIntent) => {
      const { runtime, model, ready, pinnedCount } = live.current.options;
      switch (intent.phase) {
        case 'begin': {
          inHandRef.current = null;
          if (!model || !ready) return;
          if (pinnedCount === 0) {
            trackSimulatorPullRefused({ reason: 'no-pins' });
            return;
          }
          const drawn = drawnView();
          if (drawn === null) return;
          const gpuActive = runtime.gpuActive;
          const start = runtime.beginPull(intent.at, model, drawn).then(
            (outcome) => {
              if (outcome && outcome !== 'pulling') trackSimulatorPullRefused({ reason: outcome });
              return outcome;
            },
            (error: unknown) => {
              failed(error, gpuActive);
              return null;
            }
          );
          inHandRef.current = { model, start, touch: intent.touch };
          return;
        }
        case 'move': {
          const inHand = inHandRef.current;
          if (!inHand || model !== inHand.model) return;
          const drawn = drawnView();
          if (drawn !== null) runtime.movePull(intent.at, drawn);
          return;
        }
        case 'end':
        case 'cancel': {
          const inHand = inHandRef.current;
          inHandRef.current = null;
          if (!inHand) return;
          const keep = intent.phase === 'end';
          void inHand.start.then(async (outcome) => {
            if (outcome !== 'pulling') return;
            const current = live.current.options;
            try {
              // Null when the model has gone since the press, and the pull with it.
              const ended = await current.runtime.endPull(keep ? 'keep' : 'cancel', inHand.model);
              if (!ended) return;
              trackSimulatorModelPulled({
                outcome: keep ? 'kept' : 'cancelled',
                touch: inHand.touch,
                pinnedCount: current.pinnedCount,
                movedCreases: ended.movedCreases,
              });
              if (keep) live.current.options.onHandChange?.({ kind: 'pull-kept' });
            } catch (error) {
              failed(error, current.runtime.gpuActive);
            }
          });
          return;
        }
      }
    },
    [drawnView, failed]
  );

  const springBack = useCallback(
    (source: Exclude<SimulatorPoseReleaseSource, 'fold-control' | 'restart'>) => {
      const { options: current, posed: isPosed } = live.current;
      if (!isPosed) return;
      void current.runtime.releasePose().then(
        (released) => {
          if (!released) return;
          trackSimulatorPoseReleased({ source });
          live.current.options.onHandChange?.({ kind: 'spring-back' });
        },
        (error: unknown) => failed(error, current.runtime.gpuActive)
      );
    },
    [failed]
  );

  // Called once per solver frame, so it compares before it sets: a frame that
  // changes nothing must not cost the panel a render.
  const observeFrame = useCallback((frame: SimulatorFrameView) => {
    if (frame.posed !== undefined && frame.posed !== live.current.posed) {
      live.current.posed = frame.posed;
      setPosed(frame.posed);
    }
    // A Spring back asked for here was counted, and reported, when it was
    // asked, with where from.
    const why = frame.poseEnded;
    if (why !== 'fold' && why !== 'reset') return;
    trackSimulatorPoseReleased({ source: why === 'fold' ? 'fold-control' : 'restart' });
    live.current.options.onHandChange?.({ kind: 'pose-ended', why });
  }, []);

  // A new model is a new session, which holds no pose.
  const [posedFor, setPosedFor] = useState(options.model);
  if (posedFor !== options.model) {
    setPosedFor(options.model);
    if (posed) setPosed(false);
  }

  return { run, springBack, posed, observeFrame };
}
