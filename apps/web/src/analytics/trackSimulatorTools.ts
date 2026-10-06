/**
 * The simulator tools' events, assembled in one place.
 *
 * Here rather than inline in `useSimulatorTools` because several carry the
 * same bucketed pin count, and a second hand-rolled `bucketCount(...)` is how
 * events that should be comparable stop being comparable. Every value is an
 * enum or a bucket: never a face id, a coordinate or an exact count.
 *
 * Every one says which host the tools ran in (`surface`): the same tools run
 * in Simulate and in a Diagram step's Pose, and without it Pose's pins and
 * recoveries would be counted as Simulate's. Events sent before it existed
 * have none, and were all Simulate's.
 */
import type { SimulationRecovery } from '@treemaker/origami-simulator';
import type { SimulatorToolSurface } from '../simulator/tools/toolState';
import type { PinMode, SimulatorPickReach, SimulatorToolId } from '../simulator/tools/types';
import {
  ANALYTICS_EVENTS,
  bucketCount,
  SIMULATOR_MOVED_CREASE_BUCKETS,
  SIMULATOR_PIN_COUNT_BUCKETS,
  type SimulatorPinsClearSource,
  type SimulatorPoseReleaseSource,
  type SimulatorPullRefusal,
  type SimulatorToolOptionSource,
  type SimulatorToolSelectSource,
} from './events';
import { track } from './runtime';

function pinBucket(count: number): string {
  return bucketCount(count, SIMULATOR_PIN_COUNT_BUCKETS);
}

/** Which host the tools ran in; on every event below. */
interface OnSurface {
  surface: SimulatorToolSurface;
}

export function trackSimulatorToolSelected(
  input: OnSurface & { tool: SimulatorToolId; source: SimulatorToolSelectSource }
): void {
  track(ANALYTICS_EVENTS.simulatorToolSelected, {
    surface: input.surface,
    tool: input.tool,
    source: input.source,
  });
}

export function trackSimulatorToolPickerOpened(input: OnSurface): void {
  track(ANALYTICS_EVENTS.simulatorToolPickerOpened, { surface: input.surface });
}

export function trackSimulatorPinsEdited(input: OnSurface & {
  gesture: 'box' | 'click' | 'tap';
  mode: PinMode;
  depth: SimulatorPickReach;
  outcome: 'changed' | 'unchanged' | 'empty';
  /** How many faces are pinned after the gesture. */
  pinnedCount: number;
}): void {
  track(ANALYTICS_EVENTS.simulatorPinsEdited, {
    surface: input.surface,
    gesture: input.gesture,
    mode: input.mode,
    depth: input.depth,
    outcome: input.outcome,
    pinned_count_bucket: pinBucket(input.pinnedCount),
  });
}

export function trackSimulatorPinsCleared(input: OnSurface & {
  source: SimulatorPinsClearSource;
  /** How many faces were pinned before the Clear. */
  pinnedCount: number;
}): void {
  track(ANALYTICS_EVENTS.simulatorPinsCleared, {
    surface: input.surface,
    source: input.source,
    pinned_count_bucket: pinBucket(input.pinnedCount),
  });
}

export function trackSimulatorToolOptionChanged(input: OnSurface & {
  tool: SimulatorToolId;
  option: 'through-layers';
  value: boolean;
  source: SimulatorToolOptionSource;
}): void {
  track(ANALYTICS_EVENTS.simulatorToolOptionChanged, {
    surface: input.surface,
    tool: input.tool,
    option: input.option,
    value: input.value ? 'on' : 'off',
    source: input.source,
  });
}

export function trackSimulatorPinnedFoldMoved(input: OnSurface & {
  direction: 'fold' | 'unfold';
  pinnedCount: number;
}): void {
  track(ANALYTICS_EVENTS.simulatorPinnedFoldMoved, {
    surface: input.surface,
    direction: input.direction,
    pinned_count_bucket: pinBucket(input.pinnedCount),
  });
}

export function trackSimulatorSolverRecovered(input: OnSurface & {
  action: SimulationRecovery;
  pinned: boolean;
}): void {
  track(ANALYTICS_EVENTS.simulatorSolverRecovered, {
    surface: input.surface,
    action: input.action,
    pinned: input.pinned ? 'yes' : 'no',
  });
}

export function trackSimulatorModelPulled(input: OnSurface & {
  outcome: 'kept' | 'cancelled';
  touch: boolean;
  pinnedCount: number;
  /** Fold creases the pull turned, as the solver counts them. */
  movedCreases: number;
}): void {
  track(ANALYTICS_EVENTS.simulatorModelPulled, {
    surface: input.surface,
    outcome: input.outcome,
    input: input.touch ? 'touch' : 'pointer',
    pinned_count_bucket: pinBucket(input.pinnedCount),
    moved_creases_bucket: bucketCount(input.movedCreases, SIMULATOR_MOVED_CREASE_BUCKETS),
  });
}

export function trackSimulatorPullRefused(input: OnSurface & { reason: SimulatorPullRefusal }): void {
  track(ANALYTICS_EVENTS.simulatorPullRefused, { surface: input.surface, reason: input.reason });
}

export function trackSimulatorPoseReleased(input: OnSurface & { source: SimulatorPoseReleaseSource }): void {
  track(ANALYTICS_EVENTS.simulatorPoseReleased, { surface: input.surface, source: input.source });
}
