import {
  clampSimulatorSetting,
  DEFAULT_SIMULATOR_SETTINGS,
  isSimulatorNumericSetting,
  normalizeSimulatorSettings,
  SIMULATOR_MATERIAL_KEYS,
  type SimulatorSettingKey,
  type SimulatorSettings,
} from '../../../lib/simulatorSettings';
import { readJson, STORAGE_KEYS, storageKey, writeJson } from '../../../lib/storage';
import { RESTING_SIMULATOR_TOOL } from '../../../simulator/tools/catalog';
import { EMPTY_PIN_SET, type PinSet } from '../../../simulator/tools/pinSet';
import { readSimulatorToolOptions, writeSimulatorToolOptions } from '../simulatorToolOptions';
import type { SimulatorPinsState, SimulatorSlice, WorkspaceSliceCreator } from '../types';

const SIMULATOR_SETTINGS_KEY = storageKey(STORAGE_KEYS.simulatorSettings);

/**
 * Simulate-workspace settings. Shared store state rather than panel-local, because
 * the simulator canvas and its options pane are sibling Dockview panels; the
 * canvas applies the values and the pane edits them.
 */
export function loadSimulatorSettings(): SimulatorSettings {
  return normalizeSimulatorSettings(readJson<unknown>(SIMULATOR_SETTINGS_KEY, null));
}

function persist(settings: SimulatorSettings): void {
  writeJson(SIMULATOR_SETTINGS_KEY, settings);
}

/** One source's pins, or none when the pins on record belong to another revision. */
export function simulatorPinsFor(
  pins: SimulatorPinsState,
  revision: number,
  sourceKey: string
): PinSet {
  if (pins.revision !== revision) return EMPTY_PIN_SET;
  return pins.bySource[sourceKey] ?? EMPTY_PIN_SET;
}

export const createSimulatorSlice: WorkspaceSliceCreator<SimulatorSlice> = (set, get) => ({
  simulatorSettings: loadSimulatorSettings(),

  setSimulatorSetting: <K extends SimulatorSettingKey>(key: K, value: SimulatorSettings[K]) => {
    const current = get().simulatorSettings;
    // Clamp here rather than at every call site, so a slider, a typed number, or
    // a restored preference all land in range.
    const next: SimulatorSettings = {
      ...current,
      [key]: isSimulatorNumericSetting(key)
        ? clampSimulatorSetting(key, value as number)
        : value,
    };
    set({ simulatorSettings: next });
    persist(next);
  },

  resetSimulatorMaterial: () => {
    const next = { ...get().simulatorSettings };
    for (const key of SIMULATOR_MATERIAL_KEYS) {
      next[key] = DEFAULT_SIMULATOR_SETTINGS[key];
    }
    set({ simulatorSettings: next });
    persist(next);
  },

  simulatorActiveToolId: RESTING_SIMULATOR_TOOL,
  simulatorPins: { revision: null, bySource: {} },
  simulatorToolOptions: readSimulatorToolOptions(),

  setSimulatorActiveTool: (id) => {
    if (get().simulatorActiveToolId === id) return;
    set({ simulatorActiveToolId: id });
  },

  setSimulatorPins: (revision, sourceKey, faces) => {
    const current = get().simulatorPins;
    const bySource = current.revision === revision ? current.bySource : {};
    set({ simulatorPins: { revision, bySource: { ...bySource, [sourceKey]: faces } } });
  },

  setSimulatorToolOption: (id, value) => {
    const current = get().simulatorToolOptions;
    if (current[id] === value) return;
    const next = { ...current, [id]: value };
    set({ simulatorToolOptions: next });
    writeSimulatorToolOptions(next);
  },
});
