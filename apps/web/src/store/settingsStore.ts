import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { ANALYTICS_EVENTS, bucketCount, CP_SNAP_RADIUS_BUCKETS, track } from '../analytics';
import {
  hasCoarsePointer,
  resolveCpSnapRadius,
  subscribeCoarsePointer,
} from '../lib/cpSnapRadiusSetting';
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
  normalizePaperStylePreset,
  paperPresetKey,
  parsePaperStylePreset,
  userPaperPresetKey,
  type PaperPresetParseResult,
  type PaperStylePreset,
} from '../lib/paper/paperPresets';
import {
  DEFAULT_PAPER_STYLE,
  effectivePaperStyle,
  paperStyleEquals,
  setPaperStyleField as withPaperStyleField,
  type PaperStyle,
  type PaperStyleField,
  type PaperStyleOverrides,
  type PaperStyleValue,
} from '../lib/paper/paperStyle';
import {
  normalizePaperExportSettings,
  paperExportFromSimulatorSettings,
  type PaperExportField,
  type PaperExportSettings,
} from '../lib/paperExportSettings';
import {
  normalizePaperStyleSettings,
  paperStyleFromSimulatorSettings,
  persistedPaperStyleSettings,
  type PaperStyleSettings,
  type PaperStyleSlot,
} from '../lib/paperStyleSettings';
import {
  readBoolean,
  readJson,
  readNumber,
  readOptionalBoolean,
  readString,
  storageKey,
  STORAGE_KEYS,
  writeBoolean,
  writeJson,
  writeNumber,
  writeOptionalBoolean,
  writeString,
} from '../lib/storage';
import type { WheelGesturePreference } from '../lib/wheelGesture';

export type SettingsTab = 'general' | 'appearance' | 'paper' | 'shortcuts' | 'workspace';

const SHOW_WELCOME_ON_STARTUP_KEY = storageKey(STORAGE_KEYS.showWelcomeOnStartup);
const CP_DETECT_SUGGESTIONS_KEY = storageKey(STORAGE_KEYS.cpDetectSuggestions);
const FOLD_WARNING_KEY = storageKey(STORAGE_KEYS.foldWarning);
const ANALYTICS_ENABLED_KEY = storageKey(STORAGE_KEYS.analyticsEnabled);
const CP_WHEEL_GESTURE_KEY = storageKey(STORAGE_KEYS.cpWheelGesture);
const CP_SNAP_RADIUS_KEY = storageKey(STORAGE_KEYS.cpSnapRadius);
const REFERENCES_AUTO_PLAY_FOLDS_KEY = storageKey(STORAGE_KEYS.referencesAutoPlayFolds);
const REFERENCES_SHOW_AUX_CREASES_KEY = storageKey(STORAGE_KEYS.referencesShowAuxCreases);
const PAPER_STYLE_KEY = storageKey(STORAGE_KEYS.paperStyle);
const PAPER_EXPORT_KEY = storageKey(STORAGE_KEYS.paperExport);
const SIMULATOR_SETTINGS_KEY = storageKey(STORAGE_KEYS.simulatorSettings);

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

/**
 * The radius someone actually chose, or `null` when nobody has.
 *
 * The key is only ever written by the settings field, so its absence is the
 * whole difference between "picked 10" and "never picked" — which is what lets
 * the coarse-pointer default move without overwriting a number set on a desktop.
 * Unreadable degrades the same way absent does: a hand-edited key is not a
 * choice either.
 */
function storedCpSnapRadius(): number | null {
  const stored = readNumber(CP_SNAP_RADIUS_KEY, Number.NaN);
  return Number.isFinite(stored) ? stored : null;
}

/** A choice if there is one; otherwise the default this pointer deserves. */
function readCpSnapRadius(): number {
  return resolveCpSnapRadius(storedCpSnapRadius(), hasCoarsePointer());
}

function persistPaperStyle(settings: PaperStyleSettings): void {
  writeJson(PAPER_STYLE_KEY, persistedPaperStyleSettings(settings));
}

/**
 * The persisted style, or — on the one read where there is none — a display
 * style seeded from the simulator settings that held the colours before there
 * was a style.
 *
 * A seed that carries the user's colours is written at once: the simulator
 * slice rewrites its own key without those retired fields on its next edit, so
 * the source does not survive to a second read. A seed that amounts to the
 * defaults is not written, so a user who never touched them keeps following
 * any later change to the defaults, the way an absent preference does
 * elsewhere here.
 */
function readPaperStyleSettings(): PaperStyleSettings {
  const stored = readJson<unknown>(PAPER_STYLE_KEY, null);
  if (stored !== null) return normalizePaperStyleSettings(stored);
  const seeded: PaperStyleSettings = {
    ...normalizePaperStyleSettings(null),
    display: paperStyleFromSimulatorSettings(readJson<unknown>(SIMULATOR_SETTINGS_KEY, null)),
  };
  if (!paperStyleEquals(seeded.display, DEFAULT_PAPER_STYLE)) persistPaperStyle(seeded);
  return seeded;
}

/**
 * The persisted export page, or — on the one read where there is none — a
 * page seeded from the simulator settings' retired `exportBackground`.
 *
 * Written at once when the seed differs from the defaults, for the same reason
 * the style's seed is: the simulator slice rewrites its own key without the
 * retired field on its next edit, so the source does not survive to a second
 * read. A seed that is the defaults is not written.
 */
function readPaperExportSettings(): PaperExportSettings {
  const stored = readJson<unknown>(PAPER_EXPORT_KEY, null);
  if (stored !== null) return normalizePaperExportSettings(stored);
  const seeded = paperExportFromSimulatorSettings(readJson<unknown>(SIMULATOR_SETTINGS_KEY, null));
  if (seeded.background !== null) writeJson(PAPER_EXPORT_KEY, seeded);
  return seeded;
}

/** The style a slot edits: export starts from display the moment it stops following. */
function slotStyle(settings: PaperStyleSettings, slot: PaperStyleSlot): PaperStyle {
  return slot === 'export' ? (settings.export ?? settings.display) : settings.display;
}

function withSlotStyle(
  settings: PaperStyleSettings,
  slot: PaperStyleSlot,
  style: PaperStyle
): PaperStyleSettings {
  return slot === 'export' ? { ...settings, export: style } : { ...settings, display: style };
}

/** The settings with one slot's remembered preset replaced. */
function withAppliedPreset(
  settings: PaperStyleSettings,
  slot: PaperStyleSlot,
  key: string | null
): PaperStyleSettings {
  return { ...settings, appliedPreset: { ...settings.appliedPreset, [slot]: key } };
}

/**
 * A field write to one slot. Editing the export slot while it still follows
 * display forks it, so the preset display was showing forks with it: the copy
 * came from that preset and is about to differ from it, which is exactly what
 * "modified" means.
 */
function withSlotEdit(
  settings: PaperStyleSettings,
  slot: PaperStyleSlot,
  style: PaperStyle
): PaperStyleSettings {
  const next = withSlotStyle(settings, slot, style);
  if (slot !== 'export' || settings.export !== null) return next;
  return withAppliedPreset(next, 'export', settings.appliedPreset.display);
}

/** Presets are keyed by name: saving under a taken name replaces that preset in place. */
function withPreset(presets: PaperStylePreset[], preset: PaperStylePreset): PaperStylePreset[] {
  const index = presets.findIndex((existing) => existing.name === preset.name);
  if (index === -1) return [...presets, preset];
  return presets.map((existing, i) => (i === index ? preset : existing));
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
   * Whether a reference image added to the Edit canvas that looks like a
   * crease pattern gets the "Detect creases" offer. Default on; the offer's
   * own × only retires one image, this retires the feature.
   */
  cpDetectSuggestions: boolean;
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
  /**
   * Play a step's fold as soon as its card is reached in the References
   * workspace. On by default (Zach, 2026-09-16): the fold is the card, and
   * a reader who finds the paper moving under the arrow keys has the switch.
   * A turn-over plays on arrival either way — see `FoldTransport.setScene`.
   */
  referencesAutoPlayFolds: boolean;
  /**
   * Whether the References workspace draws the pattern's auxiliary lines, or
   * `null` while it follows the paper style's own switch
   * (`auxCreases.visible`). A view option in the way a folded figure's
   * Properties are: set, it holds whatever the style says; reset, it follows
   * the style again. See `cp-workspace/references/referencesAuxCreases.ts`.
   */
  referencesShowAuxCreases: boolean | null;
  /**
   * The app-wide paper style every surface that draws paper reads: a display
   * style, an export style that is `null` while it follows display, and the
   * user's saved presets. Per-object overrides live on the document objects,
   * not here. See `implementation-plans/unified-paper-style-and-export.md`.
   */
  paperStyle: PaperStyleSettings;
  /**
   * The page every paper export is painted onto, and the PNG density. Export
   * options rather than style: the same picture goes out on any page.
   */
  paperExport: PaperExportSettings;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setBpTreeLayer: (layer: BpTreeViewLayerKey, visible: boolean) => void;
  setBpPackingLayer: (layer: BpPackingViewLayerKey, visible: boolean) => void;
  setShowWelcomeOnStartup: (value: boolean) => void;
  setFoldWarningEnabled: (value: boolean) => void;
  setAnalyticsEnabled: (value: boolean) => void;
  setCpDetectSuggestions: (value: boolean) => void;
  setCpWheelGesture: (value: WheelGesturePreference) => void;
  setCpSnapRadius: (value: number) => void;
  setReferencesAutoPlayFolds: (value: boolean) => void;
  /** `null` hands the choice back to the paper style. */
  setReferencesShowAuxCreases: (value: boolean | null) => void;
  /** Write one field of a slot's style. Editing export while it follows display detaches it. */
  setPaperStyleField: <F extends PaperStyleField>(
    slot: PaperStyleSlot,
    field: F,
    value: PaperStyleValue<F>
  ) => void;
  /**
   * Write several fields of a slot's style as one update — one store change,
   * one persist — for an edit that touches a set of fields together, such as
   * a reset. Fields left out keep their values.
   */
  setPaperStyleFields: (slot: PaperStyleSlot, fields: PaperStyleOverrides) => void;
  /** Replace a slot's whole style with a preset's (a built-in or a saved one). */
  applyPaperPreset: (slot: PaperStyleSlot, preset: PaperStylePreset) => void;
  /**
   * `true` makes the export style the display style again (the export slot is
   * cleared); `false` pins the export style as a copy of display, to edit apart.
   */
  setExportPaperStyleFollowsDisplay: (follows: boolean) => void;
  /**
   * Save a slot's current style as a named preset, replacing one of the same
   * name. Display unless told otherwise. A blank name saves nothing.
   */
  savePaperPreset: (name: string, slot?: PaperStyleSlot) => void;
  removePaperPreset: (name: string) => void;
  /**
   * Add a preset from a `.json` file's text, replacing one of the same name.
   * The parse result comes back so the caller can put words to a refusal.
   */
  importPaperPreset: (json: string) => PaperPresetParseResult;
  setPaperExportField: <F extends PaperExportField>(field: F, value: PaperExportSettings[F]) => void;
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    (set, get) => ({
      isSettingsOpen: false,
      settingsInitialTab: null,
      bpTreeLayers: DEFAULT_BP_TREE_VIEW_LAYERS,
      bpPackingLayers: DEFAULT_BP_PACKING_VIEW_LAYERS,
      showWelcomeOnStartup: readBoolean(SHOW_WELCOME_ON_STARTUP_KEY, true),
      foldWarningEnabled: readBoolean(FOLD_WARNING_KEY, true),
      analyticsEnabled: readBoolean(ANALYTICS_ENABLED_KEY, true),
      cpDetectSuggestions: readBoolean(CP_DETECT_SUGGESTIONS_KEY, true),
      cpWheelGesture: readCpWheelGesture(),
      cpSnapRadius: readCpSnapRadius(),
      referencesAutoPlayFolds: readBoolean(REFERENCES_AUTO_PLAY_FOLDS_KEY, true),
      referencesShowAuxCreases: readOptionalBoolean(REFERENCES_SHOW_AUX_CREASES_KEY),
      paperStyle: readPaperStyleSettings(),
      paperExport: readPaperExportSettings(),
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
      setCpDetectSuggestions: (value) => {
        writeBoolean(CP_DETECT_SUGGESTIONS_KEY, value);
        set({ cpDetectSuggestions: value });
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
        const radius = resolveCpSnapRadius(value, hasCoarsePointer());
        writeNumber(CP_SNAP_RADIUS_KEY, radius);
        set({ cpSnapRadius: radius });
        // Hand-placed because no chokepoint sees a preference change. Bucketed
        // because the raw number is a continuous per-user value; the bucket is
        // the whole question anyway — tighter than the default, or wider.
        track(ANALYTICS_EVENTS.cpSnapRadiusChanged, {
          snap_radius: bucketCount(radius, CP_SNAP_RADIUS_BUCKETS),
        });
      },
      setReferencesAutoPlayFolds: (value) => {
        writeBoolean(REFERENCES_AUTO_PLAY_FOLDS_KEY, value);
        set({ referencesAutoPlayFolds: value });
        // Hand-placed like the two above: no chokepoint sees a preference
        // change, and on/off is the whole question.
        track(ANALYTICS_EVENTS.referencesFoldAutoplayChanged, { enabled: value ? 'on' : 'off' });
      },
      setReferencesShowAuxCreases: (value) => {
        if (get().referencesShowAuxCreases === value) return;
        writeOptionalBoolean(REFERENCES_SHOW_AUX_CREASES_KEY, value);
        set({ referencesShowAuxCreases: value });
        // Hand-placed like the one above. `style` is a reset: whether readers
        // who set it come back to the style's own answer.
        track(ANALYTICS_EVENTS.referencesAuxCreasesChanged, {
          shown: value === null ? 'style' : value ? 'on' : 'off',
        });
      },
      setPaperStyleField: (slot, field, value) => {
        const current = get().paperStyle;
        const next = withSlotEdit(
          current,
          slot,
          withPaperStyleField(slotStyle(current, slot), field, value)
        );
        persistPaperStyle(next);
        set({ paperStyle: next });
      },
      setPaperStyleFields: (slot, fields) => {
        const current = get().paperStyle;
        const next = withSlotEdit(
          current,
          slot,
          effectivePaperStyle(slotStyle(current, slot), fields)
        );
        persistPaperStyle(next);
        set({ paperStyle: next });
      },
      applyPaperPreset: (slot, preset) => {
        const current = get().paperStyle;
        const next = withAppliedPreset(
          withSlotStyle(current, slot, preset.style),
          slot,
          paperPresetKey(preset)
        );
        persistPaperStyle(next);
        set({ paperStyle: next });
      },
      setExportPaperStyleFollowsDisplay: (follows) => {
        const current = get().paperStyle;
        if (follows === (current.export === null)) return;
        const next: PaperStyleSettings = {
          ...current,
          export: follows ? null : current.display,
          // Detaching copies display, preset and all; following again leaves
          // the export slot showing nobody's preset, because it shows display's.
          appliedPreset: {
            ...current.appliedPreset,
            export: follows ? null : current.appliedPreset.display,
          },
        };
        persistPaperStyle(next);
        set({ paperStyle: next });
      },
      savePaperPreset: (name, slot = 'display') => {
        const current = get().paperStyle;
        // The one validator: the same trim and length cap a file's name gets.
        const preset = normalizePaperStylePreset({
          version: 1,
          name,
          style: slotStyle(current, slot),
        });
        if (!preset) return;
        // The slot is now showing the preset it was just saved as, and is by
        // construction unmodified against it.
        const next = withAppliedPreset(
          { ...current, presets: withPreset(current.presets, preset) },
          slot,
          paperPresetKey(preset)
        );
        persistPaperStyle(next);
        set({ paperStyle: next });
      },
      removePaperPreset: (name) => {
        const current = get().paperStyle;
        if (!current.presets.some((preset) => preset.name === name)) return;
        // A slot that was showing it is showing nobody's preset now; the style
        // it is holding does not change.
        const gone = userPaperPresetKey(name);
        const next: PaperStyleSettings = {
          ...current,
          presets: current.presets.filter((preset) => preset.name !== name),
          appliedPreset: {
            display: current.appliedPreset.display === gone ? null : current.appliedPreset.display,
            export: current.appliedPreset.export === gone ? null : current.appliedPreset.export,
          },
        };
        persistPaperStyle(next);
        set({ paperStyle: next });
      },
      importPaperPreset: (json) => {
        const result = parsePaperStylePreset(json);
        if (result.ok) {
          const current = get().paperStyle;
          const next = { ...current, presets: withPreset(current.presets, result.preset) };
          persistPaperStyle(next);
          set({ paperStyle: next });
        }
        return result;
      },
      setPaperExportField: (field, value) => {
        // Through the normaliser, so a density typed past the range or a sheet
        // size below the minimum is held to it before it is stored.
        const next = normalizePaperExportSettings({ ...get().paperExport, [field]: value });
        writeJson(PAPER_EXPORT_KEY, next);
        set({ paperExport: next });
      },
    }),
    { name: 'SettingsStore' }
  )
);

// An unset radius follows the pointer, not just the pointer at boot: attaching an
// iPad's Magic Keyboard flips the primary pointer to `fine` in a live tab, and
// detaching it flips back. Once the key is written this stops mattering —
// `readCpSnapRadius` returns the stored number on either pointer — so the
// subscription only ever moves a default. It lasts as long as the store, which is
// the session, so nothing unsubscribes it.
subscribeCoarsePointer(() => {
  useSettingsStore.setState({ cpSnapRadius: readCpSnapRadius() });
});
