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
const FOLD_WARNING_KEY = storageKey(STORAGE_KEYS.foldWarning);
const ANALYTICS_ENABLED_KEY = storageKey(STORAGE_KEYS.analyticsEnabled);

interface SettingsState {
  isSettingsOpen: boolean;
  settingsInitialTab: SettingsTab | null;
  bpTreeLayers: BpTreeViewLayers;
  bpPackingLayers: BpPackingViewLayers;
  /** Whether a cold start lands on the welcome screen (vs. straight into Edit). */
  showWelcomeOnStartup: boolean;
  /**
   * Whether to warn before folding a crease pattern with flat-foldability
   * violations (Oriedita's `ApplicationModel.foldWarning`, inverted: here `true`
   * means "warn"). The dialog's "Don't show this again" checkbox sets this false.
   */
  foldWarningEnabled: boolean;
  /**
   * Whether product analytics (PostHog) may capture. Opt-out preference, default
   * on. The analytics runtime reacts to this to opt in/out of the client; it is
   * a no-op when analytics never initialized (no build-time key).
   */
  analyticsEnabled: boolean;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setBpTreeLayer: (layer: BpTreeViewLayerKey, visible: boolean) => void;
  setBpPackingLayer: (layer: BpPackingViewLayerKey, visible: boolean) => void;
  setShowWelcomeOnStartup: (value: boolean) => void;
  setFoldWarningEnabled: (value: boolean) => void;
  setAnalyticsEnabled: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    (set) => ({
      isSettingsOpen: false,
      settingsInitialTab: null,
      bpTreeLayers: DEFAULT_BP_TREE_VIEW_LAYERS,
      bpPackingLayers: DEFAULT_BP_PACKING_VIEW_LAYERS,
      showWelcomeOnStartup: readBoolean(SHOW_WELCOME_ON_STARTUP_KEY, true),
      foldWarningEnabled: readBoolean(FOLD_WARNING_KEY, true),
      analyticsEnabled: readBoolean(ANALYTICS_ENABLED_KEY, true),
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
      setFoldWarningEnabled: (value) => {
        writeBoolean(FOLD_WARNING_KEY, value);
        set({ foldWarningEnabled: value });
      },
      setAnalyticsEnabled: (value) => {
        writeBoolean(ANALYTICS_ENABLED_KEY, value);
        set({ analyticsEnabled: value });
      },
    }),
    { name: 'SettingsStore' }
  )
);
