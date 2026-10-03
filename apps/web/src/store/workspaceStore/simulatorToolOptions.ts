import { readJson, STORAGE_KEYS, storageKey, writeJson } from '../../lib/storage';
import {
  DEFAULT_SIMULATOR_TOOL_OPTIONS,
  type SimulatorToolOptions,
} from '../../simulator/tools/types';

const KEY = storageKey(STORAGE_KEYS.simulatorToolOptions);

/**
 * The simulator tools' options as last saved, each key validated on its own so
 * a hand-edited or older value loses only itself.
 */
export function readSimulatorToolOptions(): SimulatorToolOptions {
  const raw = readJson<unknown>(KEY, null);
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    pinThroughLayers:
      typeof stored.pinThroughLayers === 'boolean'
        ? stored.pinThroughLayers
        : DEFAULT_SIMULATOR_TOOL_OPTIONS.pinThroughLayers,
  };
}

export function writeSimulatorToolOptions(options: SimulatorToolOptions): void {
  writeJson(KEY, options);
}
