import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  DEFAULT_BP_PACKING_VIEW_LAYERS,
  DEFAULT_BP_TREE_VIEW_LAYERS,
  setBpPackingLayerVisibility,
  setBpTreeLayerVisibility,
  type BpPackingViewLayerKey,
  type BpPackingViewLayers,
  type BpTreeViewLayerKey,
  type BpTreeViewLayers,
} from '../lib/oristudioBpViewportSettings';
import { readBoolean, storageKey, STORAGE_KEYS, writeBoolean } from '../lib/storage';

export type SettingsTab = 'appearance' | 'shortcuts' | 'workspace';

const SHOW_WELCOME_ON_STARTUP_KEY = storageKey(STORAGE_KEYS.showWelcomeOnStartup);

interface SettingsState {
  isSettingsOpen: boolean;
  settingsInitialTab: SettingsTab | null;
  bpTreeLayers: BpTreeViewLayers;
  bpPackingLayers: BpPackingViewLayers;
  /** Whether a cold start lands on the welcome screen (vs. straight into Edit). */
  showWelcomeOnStartup: boolean;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setBpTreeLayer: (layer: BpTreeViewLayerKey, visible: boolean) => void;
  setBpPackingLayer: (layer: BpPackingViewLayerKey, visible: boolean) => void;
  setShowWelcomeOnStartup: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    (set) => ({
      isSettingsOpen: false,
      settingsInitialTab: null,
      bpTreeLayers: DEFAULT_BP_TREE_VIEW_LAYERS,
      bpPackingLayers: DEFAULT_BP_PACKING_VIEW_LAYERS,
      showWelcomeOnStartup: readBoolean(SHOW_WELCOME_ON_STARTUP_KEY, true),
      openSettings: (tab) => set({ isSettingsOpen: true, settingsInitialTab: tab ?? null }),
      closeSettings: () => set({ isSettingsOpen: false, settingsInitialTab: null }),
      setBpTreeLayer: (layer, visible) =>
        set((state) => ({
          bpTreeLayers: setBpTreeLayerVisibility(state.bpTreeLayers, layer, visible),
        })),
      setBpPackingLayer: (layer, visible) =>
        set((state) => ({
          bpPackingLayers: setBpPackingLayerVisibility(state.bpPackingLayers, layer, visible),
        })),
      setShowWelcomeOnStartup: (value) => {
        writeBoolean(SHOW_WELCOME_ON_STARTUP_KEY, value);
        set({ showWelcomeOnStartup: value });
      },
    }),
    { name: 'SettingsStore' }
  )
);
