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

export type SettingsTab = 'appearance' | 'shortcuts' | 'workspace';

interface SettingsState {
  isSettingsOpen: boolean;
  settingsInitialTab: SettingsTab | null;
  bpTreeLayers: BpTreeViewLayers;
  bpPackingLayers: BpPackingViewLayers;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setBpTreeLayer: (layer: BpTreeViewLayerKey, visible: boolean) => void;
  setBpPackingLayer: (layer: BpPackingViewLayerKey, visible: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    (set) => ({
      isSettingsOpen: false,
      settingsInitialTab: null,
      bpTreeLayers: DEFAULT_BP_TREE_VIEW_LAYERS,
      bpPackingLayers: DEFAULT_BP_PACKING_VIEW_LAYERS,
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
    }),
    { name: 'SettingsStore' }
  )
);
