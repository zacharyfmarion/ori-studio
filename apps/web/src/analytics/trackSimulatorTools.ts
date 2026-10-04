/**
 * The simulator tools' events, assembled in one place.
 *
 * Here rather than inline in `useSimulatorTools` because several carry the
 * same bucketed pin count, and a second hand-rolled `bucketCount(...)` is how
 * events that should be comparable stop being comparable. Every value is an
 * enum or a bucket: never a face id, a coordinate or an exact count.
 */
import type { SimulationRecovery } from '@treemaker/origami-simulator';
import type { PinMode, SimulatorPickReach, SimulatorToolId } from '../simulator/tools/types';
import {
  ANALYTICS_EVENTS,
  bucketCount,
  SIMULATOR_PIN_COUNT_BUCKETS,
  type SimulatorPinsClearSource,
  type SimulatorToolOptionSource,
  type SimulatorToolSelectSource,
} from './events';
import { track } from './runtime';

function pinBucket(count: number): string {
  return bucketCount(count, SIMULATOR_PIN_COUNT_BUCKETS);
}

export function trackSimulatorToolSelected(input: {
  tool: SimulatorToolId;
  source: SimulatorToolSelectSource;
}): void {
  track(ANALYTICS_EVENTS.simulatorToolSelected, { tool: input.tool, source: input.source });
}

export function trackSimulatorToolPickerOpened(): void {
  track(ANALYTICS_EVENTS.simulatorToolPickerOpened);
}

export function trackSimulatorPinsEdited(input: {
  gesture: 'box' | 'click' | 'tap';
  mode: PinMode;
  depth: SimulatorPickReach;
  outcome: 'changed' | 'unchanged' | 'empty';
  /** How many faces are pinned after the gesture. */
  pinnedCount: number;
}): void {
  track(ANALYTICS_EVENTS.simulatorPinsEdited, {
    gesture: input.gesture,
    mode: input.mode,
    depth: input.depth,
    outcome: input.outcome,
    pinned_count_bucket: pinBucket(input.pinnedCount),
  });
}

export function trackSimulatorPinsCleared(input: {
  source: SimulatorPinsClearSource;
  /** How many faces were pinned before the Clear. */
  pinnedCount: number;
}): void {
  track(ANALYTICS_EVENTS.simulatorPinsCleared, {
    source: input.source,
    pinned_count_bucket: pinBucket(input.pinnedCount),
  });
}

export function trackSimulatorToolOptionChanged(input: {
  tool: SimulatorToolId;
  option: 'through-layers';
  value: boolean;
  source: SimulatorToolOptionSource;
}): void {
  track(ANALYTICS_EVENTS.simulatorToolOptionChanged, {
    tool: input.tool,
    option: input.option,
    value: input.value ? 'on' : 'off',
    source: input.source,
  });
}

export function trackSimulatorPinnedFoldMoved(input: {
  direction: 'fold' | 'unfold';
  pinnedCount: number;
}): void {
  track(ANALYTICS_EVENTS.simulatorPinnedFoldMoved, {
    direction: input.direction,
    pinned_count_bucket: pinBucket(input.pinnedCount),
  });
}

export function trackSimulatorSolverRecovered(input: {
  action: SimulationRecovery;
  pinned: boolean;
}): void {
  track(ANALYTICS_EVENTS.simulatorSolverRecovered, {
    action: input.action,
    pinned: input.pinned ? 'yes' : 'no',
  });
}
