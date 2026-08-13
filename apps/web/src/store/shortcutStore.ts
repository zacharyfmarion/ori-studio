import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  normalizeKeyChord,
  shortcutKeepsDefaultChords,
  type KeyChord,
  type ShortcutActionId,
  type ShortcutDefaultsSource,
  type ShortcutOverrides,
} from '../keyboard/shortcuts';
import { readJson, storageKey, STORAGE_KEYS, writeJson } from '../lib/storage';

export const SHORTCUT_STORAGE_KEY = storageKey(STORAGE_KEYS.shortcuts);

const PERSISTED_VERSION = 2;

interface PersistedShortcutState {
  version: number;
  bindings: Record<string, KeyChord | KeyChord[] | null>;
  /** Absent in version 1 payloads, which predate the Oriedita layout. */
  defaultsSource?: ShortcutDefaultsSource;
}

interface AssignShortcutOptions {
  /**
   * Bindings that must give up their chord for this assignment. Written in the
   * same update, so the chord is never claimed twice.
   */
  unbind?: readonly ShortcutActionId[];
}

interface ShortcutState {
  overrides: ShortcutOverrides;
  defaultsSource: ShortcutDefaultsSource;
  setShortcut: (id: ShortcutActionId, chord: KeyChord) => void;
  assignShortcut: (
    id: ShortcutActionId,
    chord: KeyChord,
    options?: AssignShortcutOptions
  ) => void;
  clearShortcut: (id: ShortcutActionId) => void;
  resetShortcut: (id: ShortcutActionId) => void;
  resetAllShortcuts: () => void;
  setDefaultsSource: (source: ShortcutDefaultsSource) => void;
  applyImportedShortcuts: (imported: ShortcutOverrides) => void;
}

interface LoadedShortcutState {
  overrides: ShortcutOverrides;
  defaultsSource: ShortcutDefaultsSource;
}

function loadShortcutState(): LoadedShortcutState {
  // `readJson` only guards against absent and unparseable values, so a stored
  // `null` — or any other valid JSON scalar — arrives here as-is. This runs
  // while the module body is still evaluating, so anything thrown takes the
  // whole app down with it rather than costing a preference.
  const parsed = readJson<unknown>(SHORTCUT_STORAGE_KEY, null);
  const empty: LoadedShortcutState = { overrides: {}, defaultsSource: 'ori-studio' };
  if (typeof parsed !== 'object' || parsed === null) return empty;
  const record = parsed as Partial<PersistedShortcutState>;
  if (record.version !== 1 && record.version !== 2) return empty;
  if (!record.bindings || typeof record.bindings !== 'object') return empty;

  const overrides: ShortcutOverrides = {};
  for (const [id, binding] of Object.entries(record.bindings)) {
    const actionId = id as ShortcutActionId;
    if (binding === null) {
      if (!shortcutKeepsDefaultChords(actionId)) {
        overrides[actionId] = null;
      }
      continue;
    }
    const chords = Array.isArray(binding) ? binding : [binding];
    overrides[actionId] = chords
      .map((chord) => normalizeKeyChord(chord))
      .filter((chord) => chord.key);
  }
  return {
    overrides,
    // Version 1 payloads have no source, and a value we do not recognize is not
    // one we can honour — both read as the layout we shipped first.
    defaultsSource: record.defaultsSource === 'oriedita' ? 'oriedita' : 'ori-studio',
  };
}

function saveShortcutState(state: LoadedShortcutState): void {
  const persisted: PersistedShortcutState = {
    version: PERSISTED_VERSION,
    bindings: Object.fromEntries(
      Object.entries(state.overrides).filter(
        (entry): entry is [string, KeyChord[] | null] => entry[1] !== undefined
      )
    ),
    defaultsSource: state.defaultsSource,
  };
  writeJson(SHORTCUT_STORAGE_KEY, persisted);
}

export const useShortcutStore = create<ShortcutState>()(
  devtools(
    (set, get) => ({
      ...loadShortcutState(),

      setShortcut: (id, chord) => {
        const overrides = { ...get().overrides, [id]: [normalizeKeyChord(chord)] };
        saveShortcutState({ overrides, defaultsSource: get().defaultsSource });
        set({ overrides });
      },

      // The single-assignment sibling of applyImportedShortcuts: taking a chord
      // from whoever holds it has to land in the same write as claiming it, or
      // there is a moment where two actions answer the same key.
      assignShortcut: (id, chord, options) => {
        const overrides = { ...get().overrides };
        for (const displaced of options?.unbind ?? []) {
          // An action whose defaults survive an unbind cannot be unbound at all,
          // and deleting its override would throw away a customization while
          // still leaving the chord bound. Leave it exactly as it is.
          if (shortcutKeepsDefaultChords(displaced)) continue;
          overrides[displaced] = null;
        }
        // Applied last so the assignment wins if it also names itself.
        overrides[id] = [normalizeKeyChord(chord)];
        saveShortcutState({ overrides, defaultsSource: get().defaultsSource });
        set({ overrides });
      },

      clearShortcut: (id) => {
        const overrides = { ...get().overrides };
        if (shortcutKeepsDefaultChords(id)) {
          delete overrides[id];
        } else {
          overrides[id] = null;
        }
        saveShortcutState({ overrides, defaultsSource: get().defaultsSource });
        set({ overrides });
      },

      // Deleting the override falls the action back to whichever source is
      // active, which is the point: a user on Oriedita defaults who resets must
      // not be dropped onto the layout they left.
      resetShortcut: (id) => {
        const overrides = { ...get().overrides };
        delete overrides[id];
        saveShortcutState({ overrides, defaultsSource: get().defaultsSource });
        set({ overrides });
      },

      resetAllShortcuts: () => {
        saveShortcutState({ overrides: {}, defaultsSource: get().defaultsSource });
        set({ overrides: {} });
      },

      // Overrides are deliberately untouched: a key the user set by hand is
      // theirs, and only unoverridden actions move with the source.
      setDefaultsSource: (source) => {
        if (get().defaultsSource === source) return;
        saveShortcutState({ overrides: get().overrides, defaultsSource: source });
        set({ defaultsSource: source });
      },

      // An import lands dozens of bindings at once; routing them through the
      // per-id setters would mean a localStorage write and a store notification
      // per binding. This merges over the current overrides so ids the import
      // does not mention keep their customizations, then persists once.
      applyImportedShortcuts: (imported) => {
        const overrides = { ...get().overrides };
        for (const [key, binding] of Object.entries(imported)) {
          const id = key as ShortcutActionId;
          if (binding === undefined) continue;
          if (binding === null) {
            // Same rule clearShortcut follows: actions whose defaults survive an
            // unbind cannot be expressed as null, so they fall back to default.
            if (shortcutKeepsDefaultChords(id)) {
              delete overrides[id];
            } else {
              overrides[id] = null;
            }
            continue;
          }
          overrides[id] = binding.map((chord) => normalizeKeyChord(chord));
        }
        saveShortcutState({ overrides, defaultsSource: get().defaultsSource });
        set({ overrides });
      },
    }),
    { name: 'ShortcutStore' }
  )
);
