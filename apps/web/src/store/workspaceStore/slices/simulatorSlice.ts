import {
  clampSimulatorSetting,
  DEFAULT_SIMULATOR_SETTINGS,
  isSimulatorNumericSetting,
  normalizeSimulatorSettings,
  SIMULATOR_MATERIAL_KEYS,
  SIMULATOR_STYLE_KEYS,
  type SimulatorSettingKey,
  type SimulatorSettings,
} from '../../../lib/simulatorSettings';
import { readJson, STORAGE_KEYS, storageKey, writeJson } from '../../../lib/storage';
import type { SimulatorSlice, WorkspaceSliceCreator } from '../types';

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

export const createSimulatorSlice: WorkspaceSliceCreator<SimulatorSlice> = (set, get) => ({
  simulatorSettings: loadSimulatorSettings(),

  setSimulatorSetting: <K extends SimulatorSettingKey>(key: K, value: SimulatorSettings[K]) => {
    const current = get().simulatorSettings;
    // Clamp here rather than at every call site, so a slider, a typed number, or
    // a restored preference all land in range.
    const next: SimulatorSettings = {
      ...current,
      [key]: isSimulatorNumericSetting(key) ? clampSimulatorSetting(key, value as number) : value,
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

  resetSimulatorStyle: () => {
    // Back to the theme's paper and the origami-convention creases: every style
    // default is either null (follow the theme) or the shared constant, so this
    // is the same loop the material reset uses.
    const next = { ...get().simulatorSettings };
    for (const key of SIMULATOR_STYLE_KEYS) {
      next[key] = DEFAULT_SIMULATOR_SETTINGS[key] as never;
    }
    set({ simulatorSettings: next });
    persist(next);
  },
});
