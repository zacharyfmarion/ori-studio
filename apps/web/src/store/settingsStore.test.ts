import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CP_COARSE_POINTER_QUERY,
  CP_COARSE_POINTER_SNAP_RADIUS,
  CP_DEFAULT_SNAP_RADIUS,
  CP_MAX_SNAP_RADIUS,
  CP_MIN_SNAP_RADIUS,
} from '../lib/cpSnapRadiusSetting';
import { builtInPaperPreset } from '../lib/paper/paperPresets';
import { PAPER_SHEET_MM_RANGE } from '../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE } from '../lib/paper/paperStyle';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../lib/paperExportSettings';
import { STORAGE_KEYS, storageKey } from '../lib/storage';
import { useSettingsStore } from './settingsStore';
import type { WorkspaceState } from './workspaceStore/types';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analytics')>();
  return { ...actual, track: analytics.track };
});

const initialSettingsState = useSettingsStore.getInitialState();

const CP_SNAP_RADIUS_KEY = 'oristudio:cp-snap-radius';
const CP_WHEEL_GESTURE_KEY = 'oristudio:cp-wheel-gesture';

/**
 * Stub `matchMedia` — jsdom has none — so {@link CP_COARSE_POINTER_QUERY} answers
 * as the given pointer would, and hand back a `set` that changes the answer and
 * fires the listener, the way attaching an iPad's Magic Keyboard does.
 */
function mockPointer(pointer: 'coarse' | 'fine') {
  const state = { pointer };
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === CP_COARSE_POINTER_QUERY && state.pointer === 'coarse',
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return {
    set(next: 'coarse' | 'fine') {
      state.pointer = next;
      for (const listener of listeners) listener();
    },
  };
}

/** Hydration runs once, at store creation, so a stored value needs a fresh one. */
async function freshSettingsStore(): Promise<typeof useSettingsStore> {
  vi.resetModules();
  const { useSettingsStore: freshStore } = await import('./settingsStore');
  return freshStore;
}

/** `null` stands for a snap-radius key nobody ever wrote. */
async function hydrateWith(
  stored: string | null,
  pointer: 'coarse' | 'fine' = 'fine'
): Promise<number> {
  if (stored === null) localStorage.removeItem(CP_SNAP_RADIUS_KEY);
  else localStorage.setItem(CP_SNAP_RADIUS_KEY, stored);
  mockPointer(pointer);
  return (await freshSettingsStore()).getState().cpSnapRadius;
}

/** Same, for the wheel preference; `null` stands for a key nobody ever wrote. */
async function hydrateWheelGestureWith(stored: string | null): Promise<string> {
  if (stored === null) localStorage.removeItem(CP_WHEEL_GESTURE_KEY);
  else localStorage.setItem(CP_WHEEL_GESTURE_KEY, stored);
  return (await freshSettingsStore()).getState().cpWheelGesture;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useSettingsStore.setState(initialSettingsState, true);
});

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('settingsStore', () => {
  it('opens and closes the settings modal', () => {
    useSettingsStore.getState().openSettings();

    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialTab).toBeNull();

    useSettingsStore.getState().closeSettings();

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(useSettingsStore.getState().settingsInitialTab).toBeNull();
  });

  it('tracks the requested initial tab', () => {
    useSettingsStore.getState().openSettings('workspace');

    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialTab).toBe('workspace');
  });

  it('plays folds on arrival by default, and remembers a reader turning that off', async () => {
    const key = storageKey(STORAGE_KEYS.referencesAutoPlayFolds);
    localStorage.removeItem(key);
    expect((await freshSettingsStore()).getState().referencesAutoPlayFolds).toBe(true);
    useSettingsStore.getState().setReferencesAutoPlayFolds(false);
    expect(localStorage.getItem(key)).toBe('false');
    expect((await freshSettingsStore()).getState().referencesAutoPlayFolds).toBe(false);
  });

  it('leaves References aux creases to the paper style until set, and a reset forgets the choice', async () => {
    const key = storageKey(STORAGE_KEYS.referencesShowAuxCreases);
    localStorage.removeItem(key);
    expect((await freshSettingsStore()).getState().referencesShowAuxCreases).toBeNull();
    useSettingsStore.getState().setReferencesShowAuxCreases(false);
    expect(localStorage.getItem(key)).toBe('false');
    expect((await freshSettingsStore()).getState().referencesShowAuxCreases).toBe(false);
    useSettingsStore.getState().setReferencesShowAuxCreases(null);
    expect(localStorage.getItem(key)).toBeNull();
    expect((await freshSettingsStore()).getState().referencesShowAuxCreases).toBeNull();
  });

  it('defaults the crease-pattern canvas to scroll-zooms and persists a change', () => {
    expect(useSettingsStore.getState().cpWheelGesture).toBe('zoom');

    useSettingsStore.getState().setCpWheelGesture('pan');
    expect(useSettingsStore.getState().cpWheelGesture).toBe('pan');
    expect(localStorage.getItem(CP_WHEEL_GESTURE_KEY)).toBe('pan');

    useSettingsStore.getState().setCpWheelGesture('zoom');
    expect(localStorage.getItem(CP_WHEEL_GESTURE_KEY)).toBe('zoom');
  });

  it('reports a wheel-gesture change as the chosen enum member', () => {
    useSettingsStore.getState().setCpWheelGesture('pan');

    expect(analytics.track).toHaveBeenCalledWith('cp wheel gesture changed', {
      wheel_gesture: 'pan',
    });
  });

  it('keeps an explicitly chosen scroll-pans across the default moving to zoom', async () => {
    // The key is only written by picking a radio, so a stored `pan` is somebody
    // who chose it and must not be flipped by the new default.
    expect(await hydrateWheelGestureWith('pan')).toBe('pan');
    expect(await hydrateWheelGestureWith('zoom')).toBe('zoom');
    // Never chosen, or unreadable, follows the default.
    expect(await hydrateWheelGestureWith(null)).toBe('zoom');
    expect(await hydrateWheelGestureWith('sideways')).toBe('zoom');
  });

  it('defaults the fold warning to enabled and toggles it', () => {
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(true);

    useSettingsStore.getState().setFoldWarningEnabled(false);
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(false);

    useSettingsStore.getState().setFoldWarningEnabled(true);
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(true);
  });

  it('defaults the snap radius to upstream’s mouseRadius and persists a change', () => {
    expect(useSettingsStore.getState().cpSnapRadius).toBe(CP_DEFAULT_SNAP_RADIUS);

    useSettingsStore.getState().setCpSnapRadius(24);

    expect(useSettingsStore.getState().cpSnapRadius).toBe(24);
    expect(localStorage.getItem(CP_SNAP_RADIUS_KEY)).toBe('24');
  });

  it('clamps what the setter is handed, so state never leaves the slider', () => {
    useSettingsStore.getState().setCpSnapRadius(1000);
    expect(useSettingsStore.getState().cpSnapRadius).toBe(CP_MAX_SNAP_RADIUS);

    useSettingsStore.getState().setCpSnapRadius(0);
    expect(useSettingsStore.getState().cpSnapRadius).toBe(CP_MIN_SNAP_RADIUS);

    useSettingsStore.getState().setCpSnapRadius(12.6);
    expect(useSettingsStore.getState().cpSnapRadius).toBe(13);
  });

  it('reports a snap-radius change as a bucket, never as the number', () => {
    useSettingsStore.getState().setCpSnapRadius(40);

    expect(analytics.track).toHaveBeenCalledWith('cp snap radius changed', {
      snap_radius: '<=50',
    });
  });

  it('hydrates a stored radius, and degrades a hand-edited one', async () => {
    expect(await hydrateWith('30')).toBe(30);
    // Out of range clamps in; unreadable falls back to the default.
    expect(await hydrateWith('9000')).toBe(CP_MAX_SNAP_RADIUS);
    expect(await hydrateWith('tiny')).toBe(CP_DEFAULT_SNAP_RADIUS);
    expect(await hydrateWith('')).toBe(CP_DEFAULT_SNAP_RADIUS);
  });

  it('starts a coarse pointer wider, and still lets a stored choice win', async () => {
    expect(await hydrateWith(null, 'coarse')).toBe(CP_COARSE_POINTER_SNAP_RADIUS);
    expect(await hydrateWith(null, 'fine')).toBe(CP_DEFAULT_SNAP_RADIUS);
    // Storing upstream's own number is the case a "is it still the default"
    // check would get wrong: this is a choice, and survives onto a touch screen.
    expect(await hydrateWith(String(CP_DEFAULT_SNAP_RADIUS), 'coarse')).toBe(
      CP_DEFAULT_SNAP_RADIUS
    );
    expect(await hydrateWith('9000', 'coarse')).toBe(CP_MAX_SNAP_RADIUS);
  });

  it('follows the pointer changing under a live session, until a choice is stored', async () => {
    const pointer = mockPointer('fine');
    const freshStore = await freshSettingsStore();
    expect(freshStore.getState().cpSnapRadius).toBe(CP_DEFAULT_SNAP_RADIUS);

    // Detaching an iPad's keyboard hands the session back to a fingertip.
    pointer.set('coarse');
    expect(freshStore.getState().cpSnapRadius).toBe(CP_COARSE_POINTER_SNAP_RADIUS);

    freshStore.getState().setCpSnapRadius(30);
    pointer.set('fine');
    expect(freshStore.getState().cpSnapRadius).toBe(30);
  });
});

describe('cpDetectSuggestions', () => {
  afterEach(() => {
    localStorage.removeItem('oristudio:cp-detect-suggestions');
    useSettingsStore.setState(initialSettingsState);
  });

  it('defaults on and persists the switch', () => {
    expect(useSettingsStore.getState().cpDetectSuggestions).toBe(true);
    useSettingsStore.getState().setCpDetectSuggestions(false);
    expect(useSettingsStore.getState().cpDetectSuggestions).toBe(false);
    expect(localStorage.getItem('oristudio:cp-detect-suggestions')).toBe('false');
  });
});

describe('paperStyle', () => {
  const PAPER_STYLE_KEY = storageKey(STORAGE_KEYS.paperStyle);
  const SIMULATOR_SETTINGS_KEY = storageKey(STORAGE_KEYS.simulatorSettings);

  it('starts from the default style with export following display and no presets', async () => {
    const { paperStyle } = (await freshSettingsStore()).getState();
    expect(paperStyle).toEqual({
      display: DEFAULT_PAPER_STYLE,
      export: null,
      presets: [],
      appliedPreset: { display: null, export: null },
    });
    // With nothing to migrate, nothing is persisted until the user edits.
    expect(localStorage.getItem(PAPER_STYLE_KEY)).toBeNull();
  });

  it('seeds the display style from the simulator settings when there is no style yet', async () => {
    localStorage.setItem(
      SIMULATOR_SETTINGS_KEY,
      JSON.stringify({ paperFront: '#ff8800', borderColor: '#112233', creaseStyle: 'mono', lighting: false })
    );
    const { display, export: exported } = (await freshSettingsStore()).getState().paperStyle;
    expect(display.paper.front).toBe('#ff8800');
    expect(display.mountainFolds.color).toBe('#112233');
    expect(display.light.enabled).toBe(false);
    expect(exported).toBeNull();
  });

  it('keeps a seeded style once the simulator settings are rewritten without it', async () => {
    localStorage.setItem(SIMULATOR_SETTINGS_KEY, JSON.stringify({ paperFront: '#ff8800' }));
    expect((await freshSettingsStore()).getState().paperStyle.display.paper.front).toBe('#ff8800');
    // The simulator slice persists its normalised settings, which no longer
    // carry the retired style keys, on any edit.
    const { createSimulatorSlice } = await import('./workspaceStore/slices/simulatorSlice');
    const state = {} as WorkspaceState;
    Object.assign(
      state,
      createSimulatorSlice((partial) => Object.assign(state, partial), () => state, {} as never)
    );
    state.setSimulatorSetting('showViewCube', false);
    expect(JSON.parse(localStorage.getItem(SIMULATOR_SETTINGS_KEY) ?? '{}')).not.toHaveProperty(
      'paperFront'
    );
    expect((await freshSettingsStore()).getState().paperStyle.display.paper.front).toBe('#ff8800');
  });

  it('writes nothing for a seed that amounts to the defaults', async () => {
    localStorage.setItem(SIMULATOR_SETTINGS_KEY, JSON.stringify({ showViewCube: false }));
    await freshSettingsStore();
    expect(localStorage.getItem(PAPER_STYLE_KEY)).toBeNull();
  });

  it('writes nothing for retired keys that only restate the defaults', async () => {
    // What every old build's persist wrote for a user who never touched the
    // look: all eight retired keys, at their defaults. Pinning that would stop
    // them following a later change to the defaults for no gain.
    localStorage.setItem(
      SIMULATOR_SETTINGS_KEY,
      JSON.stringify({
        paperFront: null,
        paperBack: null,
        mountainColor: null,
        valleyColor: null,
        borderColor: null,
        creaseWidth: 1.1,
        creaseStyle: 'color',
        lighting: true,
      })
    );
    expect((await freshSettingsStore()).getState().paperStyle.display).toEqual(DEFAULT_PAPER_STYLE);
    expect(localStorage.getItem(PAPER_STYLE_KEY)).toBeNull();
  });

  it('prefers a persisted style over the simulator settings beside it', async () => {
    localStorage.setItem(SIMULATOR_SETTINGS_KEY, JSON.stringify({ paperFront: '#ff8800' }));
    localStorage.setItem(
      PAPER_STYLE_KEY,
      JSON.stringify({ version: 1, display: { paper: { front: '#123456' } }, export: null, presets: [] })
    );
    expect((await freshSettingsStore()).getState().paperStyle.display.paper.front).toBe('#123456');
  });

  it('writes a field and reads it back on the next start', async () => {
    useSettingsStore.getState().setPaperStyleField('display', 'paper.back', '#abcdef');
    expect(useSettingsStore.getState().paperStyle.display.paper.back).toBe('#abcdef');
    const stored = JSON.parse(localStorage.getItem(PAPER_STYLE_KEY) ?? 'null');
    expect(stored.version).toBe(1);
    expect(stored.export).toBeNull();
    expect((await freshSettingsStore()).getState().paperStyle.display.paper.back).toBe('#abcdef');
  });

  it('writes several fields as one update, and persists once', () => {
    const updates = vi.fn();
    const unsubscribe = useSettingsStore.subscribe(updates);
    useSettingsStore
      .getState()
      .setPaperStyleFields('display', { 'paper.front': '#101010', erode: 0.1 });
    unsubscribe();
    expect(updates).toHaveBeenCalledTimes(1);
    const { display } = useSettingsStore.getState().paperStyle;
    expect(display).toEqual({
      ...DEFAULT_PAPER_STYLE,
      paper: { ...DEFAULT_PAPER_STYLE.paper, front: '#101010' },
      erode: 0.1,
    });
    const stored = JSON.parse(localStorage.getItem(PAPER_STYLE_KEY) ?? 'null');
    expect(stored.display.paper.front).toBe('#101010');
  });

  it('detaches the export style from display the moment it is edited', () => {
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#101010');
    useSettingsStore.getState().setPaperStyleField('export', 'erode', 0.1);
    const { display, export: exported } = useSettingsStore.getState().paperStyle;
    // Starts as a copy of display, so the one edit is the only difference.
    expect(exported).toEqual({ ...display, erode: 0.1 });
    // And display is no longer what export reads from.
    useSettingsStore.getState().setPaperStyleField('display', 'erode', 0.2);
    expect(useSettingsStore.getState().paperStyle.export?.erode).toBe(0.1);
  });

  it('makes export follow display again, and pins it as a copy when told not to', () => {
    const store = useSettingsStore.getState();
    store.setExportPaperStyleFollowsDisplay(false);
    expect(useSettingsStore.getState().paperStyle.export).toEqual(DEFAULT_PAPER_STYLE);
    useSettingsStore.getState().setExportPaperStyleFollowsDisplay(true);
    expect(useSettingsStore.getState().paperStyle.export).toBeNull();
    // Idempotent: asking for what is already the case writes nothing.
    localStorage.removeItem(PAPER_STYLE_KEY);
    useSettingsStore.getState().setExportPaperStyleFollowsDisplay(true);
    expect(localStorage.getItem(PAPER_STYLE_KEY)).toBeNull();
  });

  it('applies a preset to one slot only, and remembers which it was', () => {
    useSettingsStore.getState().applyPaperPreset('export', builtInPaperPreset('diagram'));
    const { display, export: exported, appliedPreset } = useSettingsStore.getState().paperStyle;
    expect(exported).toEqual(builtInPaperPreset('diagram').style);
    expect(display).toEqual(DEFAULT_PAPER_STYLE);
    expect(appliedPreset).toEqual({ display: null, export: 'builtin:diagram' });
  });

  it('carries the display slot’s preset over when the export slot is detached, and drops it when it follows again', () => {
    const store = useSettingsStore.getState();
    store.applyPaperPreset('display', builtInPaperPreset('diagram'));
    useSettingsStore.getState().setExportPaperStyleFollowsDisplay(false);
    expect(useSettingsStore.getState().paperStyle.appliedPreset).toEqual({
      display: 'builtin:diagram',
      export: 'builtin:diagram',
    });
    useSettingsStore.getState().setExportPaperStyleFollowsDisplay(true);
    expect(useSettingsStore.getState().paperStyle.appliedPreset.export).toBeNull();
  });

  it('forks the display slot’s preset when an edit is what detaches the export slot', () => {
    useSettingsStore.getState().applyPaperPreset('display', builtInPaperPreset('diagram'));
    useSettingsStore.getState().setPaperStyleField('export', 'erode', 0.1);
    expect(useSettingsStore.getState().paperStyle.appliedPreset).toEqual({
      display: 'builtin:diagram',
      export: 'builtin:diagram',
    });
  });

  it('remembers a saved preset as the slot’s own, and forgets it when it is deleted', () => {
    useSettingsStore.getState().savePaperPreset('Mine');
    expect(useSettingsStore.getState().paperStyle.appliedPreset.display).toBe('user:Mine');
    // An ordinary field edit is not a change of preset.
    useSettingsStore.getState().setPaperStyleField('display', 'erode', 0.02);
    expect(useSettingsStore.getState().paperStyle.appliedPreset.display).toBe('user:Mine');
    useSettingsStore.getState().removePaperPreset('Mine');
    expect(useSettingsStore.getState().paperStyle.appliedPreset.display).toBeNull();
    // The style the preset held is left where it is.
    expect(useSettingsStore.getState().paperStyle.display.erode).toBe(0.02);
  });

  it('saves, replaces, removes and imports presets by name', async () => {
    useSettingsStore.getState().setPaperStyleField('display', 'erode', 0.05);
    useSettingsStore.getState().savePaperPreset('  Mine ');
    expect(useSettingsStore.getState().paperStyle.presets).toEqual([
      { version: 1, name: 'Mine', style: { ...DEFAULT_PAPER_STYLE, erode: 0.05 } },
    ]);
    // A blank name is not a preset.
    useSettingsStore.getState().savePaperPreset('   ');
    expect(useSettingsStore.getState().paperStyle.presets).toHaveLength(1);

    // Same name replaces in place rather than adding a twin.
    useSettingsStore.getState().setPaperStyleField('display', 'erode', 0.1);
    useSettingsStore.getState().savePaperPreset('Mine');
    expect(useSettingsStore.getState().paperStyle.presets).toHaveLength(1);
    expect(useSettingsStore.getState().paperStyle.presets[0]?.style.erode).toBe(0.1);

    const imported = useSettingsStore
      .getState()
      .importPaperPreset(JSON.stringify({ name: 'Theirs', style: { erode: 0.2 } }));
    expect(imported.ok).toBe(true);
    expect(useSettingsStore.getState().importPaperPreset('{')).toEqual({
      ok: false,
      reason: 'invalid-json',
    });
    expect(useSettingsStore.getState().paperStyle.presets.map((preset) => preset.name)).toEqual([
      'Mine',
      'Theirs',
    ]);

    useSettingsStore.getState().removePaperPreset('Mine');
    expect(useSettingsStore.getState().paperStyle.presets.map((preset) => preset.name)).toEqual([
      'Theirs',
    ]);
    // Everything above survives a restart.
    expect((await freshSettingsStore()).getState().paperStyle.presets).toEqual([
      { version: 1, name: 'Theirs', style: { ...DEFAULT_PAPER_STYLE, erode: 0.2 } },
    ]);
  });
});

describe('paperExport', () => {
  const PAPER_EXPORT_KEY = storageKey(STORAGE_KEYS.paperExport);
  const SIMULATOR_SETTINGS_KEY = storageKey(STORAGE_KEYS.simulatorSettings);

  it('starts from the default page and writes nothing until the user edits', async () => {
    const { paperExport } = (await freshSettingsStore()).getState();
    expect(paperExport).toEqual(DEFAULT_PAPER_EXPORT_SETTINGS);
    expect(localStorage.getItem(PAPER_EXPORT_KEY)).toBeNull();
  });

  it('seeds a white page from the simulator settings’ retired export background, once', async () => {
    localStorage.setItem(SIMULATOR_SETTINGS_KEY, JSON.stringify({ exportBackground: 'white' }));
    expect((await freshSettingsStore()).getState().paperExport.background).toBe('#ffffff');
    // Written at once: the simulator slice drops the retired key on its next
    // edit, so the seed would otherwise be lost to the second read.
    expect(JSON.parse(localStorage.getItem(PAPER_EXPORT_KEY) ?? 'null')?.background).toBe(
      '#ffffff'
    );
    localStorage.setItem(SIMULATOR_SETTINGS_KEY, JSON.stringify({ showViewCube: false }));
    expect((await freshSettingsStore()).getState().paperExport.background).toBe('#ffffff');
  });

  it('reads a transparent or theme export background as a transparent page, and writes nothing', async () => {
    localStorage.setItem(SIMULATOR_SETTINGS_KEY, JSON.stringify({ exportBackground: 'theme' }));
    expect((await freshSettingsStore()).getState().paperExport.background).toBeNull();
    expect(localStorage.getItem(PAPER_EXPORT_KEY)).toBeNull();
  });

  it('prefers a persisted page over the simulator settings beside it', async () => {
    localStorage.setItem(SIMULATOR_SETTINGS_KEY, JSON.stringify({ exportBackground: 'white' }));
    localStorage.setItem(PAPER_EXPORT_KEY, JSON.stringify({ background: null, pngDpi: 300 }));
    const { paperExport } = (await freshSettingsStore()).getState();
    expect(paperExport.background).toBeNull();
    expect(paperExport.pngDpi).toBe(300);
  });

  it('writes a field, held to its range, and reads it back on the next start', async () => {
    useSettingsStore.getState().setPaperExportField('keepHiddenFaces', false);
    useSettingsStore.getState().setPaperExportField('sheet', { mm: 5 });
    useSettingsStore.getState().setPaperExportField('pngDpi', 300);
    const { paperExport } = useSettingsStore.getState();
    expect(paperExport.keepHiddenFaces).toBe(false);
    expect(paperExport.sheet).toEqual({ mm: PAPER_SHEET_MM_RANGE.min });
    expect(paperExport.pngDpi).toBe(300);
    expect((await freshSettingsStore()).getState().paperExport).toEqual(paperExport);
  });
});
