import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { ANALYTICS_EVENTS, bucketCount, CP_SNAP_RADIUS_BUCKETS, track } from '../analytics';
import { clampCpSnapRadius, CP_DEFAULT_SNAP_RADIUS } from '../lib/cpSnapRadiusSetting';
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
import {
  readBoolean,
  readNumber,
  readString,
  storageKey,
  STORAGE_KEYS,
  writeBoolean,
  writeNumber,
  writeString,
} from '../lib/storage';
import type { WheelGesturePreference } from '../lib/wheelGesture';

export type SettingsTab = 'appearance' | 'shortcuts' | 'workspace';

const SHOW_WELCOME_ON_STARTUP_KEY = storageKey(STORAGE_KEYS.showWelcomeOnStartup);
const FOLD_WARNING_KEY = storageKey(STORAGE_KEYS.foldWarning);
const ANALYTICS_ENABLED_KEY = storageKey(STORAGE_KEYS.analyticsEnabled);
const CP_WHEEL_GESTURE_KEY = storageKey(STORAGE_KEYS.cpWheelGesture);
const CP_SNAP_RADIUS_KEY = storageKey(STORAGE_KEYS.cpSnapRadius);

/**
 * Anything unrecognised — absent, stale, hand-edited — reads as the default.
 *
 * The key is only ever written by picking a radio, so a stored `'pan'` is an
 * explicit choice and keeps panning across this default moving to `'zoom'`. An
 * absent key means nobody chose, and follows the default wherever it goes.
 */
function readCpWheelGesture(): WheelGesturePreference {
  return readString(CP_WHEEL_GESTURE_KEY) === 'pan' ? 'pan' : 'zoom';
}

/** Same contract, on a number: unreadable degrades, out-of-range clamps in. */
function readCpSnapRadius(): number {
  return clampCpSnapRadius(readNumber(CP_SNAP_RADIUS_KEY, CP_DEFAULT_SNAP_RADIUS));
}

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
  /**
   * What an *unmodified* scroll or two-finger drag does on the crease-pattern
   * canvas. `'zoom'` is the default: it is what the canvas shipped with, what
   * upstream Oriedita's canvas does, and what users asked to have back. `'pan'`
   * is the Figma model, and remains the better fit for a trackpad. Pinch and the
   * accel key zoom either way, so this only ever changes the unmodified gesture.
   */
  cpWheelGesture: WheelGesturePreference;
  /**
   * How close the pointer has to come to a vertex, crease or grid point before
   * drawing snaps to it, in Oriedita model units — the paper is 400 across.
   * Upstream's `mouseRadius`, same unit and same bounds, so the number means the
   * same thing in both apps.
   */
  cpSnapRadius: number;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setBpTreeLayer: (layer: BpTreeViewLayerKey, visible: boolean) => void;
  setBpPackingLayer: (layer: BpPackingViewLayerKey, visible: boolean) => void;
  setShowWelcomeOnStartup: (value: boolean) => void;
  setFoldWarningEnabled: (value: boolean) => void;
  setAnalyticsEnabled: (value: boolean) => void;
  setCpWheelGesture: (value: WheelGesturePreference) => void;
  setCpSnapRadius: (value: number) => void;
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
      cpWheelGesture: readCpWheelGesture(),
      cpSnapRadius: readCpSnapRadius(),
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
      setCpWheelGesture: (value) => {
        writeString(CP_WHEEL_GESTURE_KEY, value);
        set({ cpWheelGesture: value });
        // Hand-placed for the same reason as the snap radius below: no
        // chokepoint sees a preference change. Two enum members, and the
        // question is the one moving this default raised — whether trackpad
        // users go looking for the switch back.
        track(ANALYTICS_EVENTS.cpWheelGestureChanged, { wheel_gesture: value });
      },
      setCpSnapRadius: (value) => {
        const radius = clampCpSnapRadius(value);
        writeNumber(CP_SNAP_RADIUS_KEY, radius);
        set({ cpSnapRadius: radius });
        // Hand-placed because no chokepoint sees a preference change. Bucketed
        // because the raw number is a continuous per-user value; the bucket is
        // the whole question anyway — tighter than the default, or wider.
        track(ANALYTICS_EVENTS.cpSnapRadiusChanged, {
          snap_radius: bucketCount(radius, CP_SNAP_RADIUS_BUCKETS),
        });
      },
    }),
    { name: 'SettingsStore' },
  ),
);
