/**
 * The tools' state as a port: what a host keeps for them, and what the tools
 * tell a host the hand did to the paper.
 *
 * The binding (`useSimulatorToolBinding`) is the one place a tool has effects,
 * and it reads and writes the tool in hand, the tools' options and the pins
 * only through this interface. Simulate keeps them in its workspace slice
 * (`simulateToolState.ts`); another host keeps its own, so picking Pin there
 * does not change Simulate's tool, and its pins live where its picture does.
 * See `implementation-plans/diagram-pose-simulator-tools.md`.
 */
import type { SimulatorPoseEnd } from '../simulatorSession';
import type { PinSet } from './pinSet';
import type { SimulatorToolId, SimulatorToolOptionId, SimulatorToolOptions } from './types';

/** Which host the tools are running in, as their analytics events say it. */
export type SimulatorToolSurface = 'simulate' | 'diagram-pose';

/** The tool in hand and the tools' options. */
export interface SimulatorToolSnapshot {
  activeToolId: SimulatorToolId;
  options: SimulatorToolOptions;
}

/**
 * What a host keeps for the tools, scoped by whatever its pins belong to:
 * Simulate's are per fold revision and source.
 *
 * Reads are synchronous, so a pick still in the queue reads the pins as they
 * are now rather than as they were at the last render. The binding reads both
 * through `useSyncExternalStore`, so `subscribe` must be stable for the life of
 * the host and each read must answer the same object until something changes:
 * a new object per call is a render per frame.
 */
export interface SimulatorToolState<Scope> {
  subscribe(listener: () => void): () => void;
  /** Stable identity between changes. */
  getSnapshot(): SimulatorToolSnapshot;
  /** Stable identity between changes. */
  getPins(scope: Scope): PinSet;
  setPins(scope: Scope, faces: PinSet): void;
  setActiveTool(id: SimulatorToolId): void;
  setOption(id: SimulatorToolOptionId, value: boolean): void;
}

/**
 * What the hand did to the paper, said once the worker has answered and never
 * on the gesture: a pick that is refused, or a set the worker rejects and the
 * binding rolls back, says nothing.
 *
 * - `pins`: the worker holds exactly these faces, including a model sent its
 *   source's pins when it loads.
 * - `pull-kept`: a pull was let go and kept, so the paper holds a pose.
 * - `spring-back`: a Spring back the tools asked for was done.
 * - `pose-ended`: the fold target moving, or a reset, took a kept pose back.
 *   Not a Spring back, said when it was done, nor a restore, which is the
 *   host's own doing.
 */
export type SimulatorHandChange =
  | { kind: 'pins'; faces: PinSet }
  | { kind: 'pull-kept' }
  | { kind: 'spring-back' }
  | { kind: 'pose-ended'; why: Extract<SimulatorPoseEnd, 'fold' | 'reset'> };
