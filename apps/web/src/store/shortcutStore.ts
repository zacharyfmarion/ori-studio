import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  normalizeKeyChord,
  shortcutKeepsDefaultChords,
  type KeyChord,
  type ShortcutActionId,
  type ShortcutOverrides,
} from '../keyboard/shortcuts';
import { readJson, storageKey, STORAGE_KEYS, writeJson } from '../lib/storage';

export const SHORTCUT_STORAGE_KEY = storageKey(STORAGE_KEYS.shortcuts);

interface PersistedShortcutState {
  version: 1;
  bindings: Record<string, KeyChord | KeyChord[] | null>;
}

interface ShortcutState {
  overrides: ShortcutOverrides;
  setShortcut: (id: ShortcutActionId, chord: KeyChord) => void;
  clearShortcut: (id: ShortcutActionId) => void;
  resetShortcut: (id: ShortcutActionId) => void;
  resetAllShortcuts: () => void;
}

function loadShortcutOverrides(): ShortcutOverrides {
  const parsed = readJson<Partial<PersistedShortcutState>>(SHORTCUT_STORAGE_KEY, {});
  if (parsed.version !== 1 || !parsed.bindings || typeof parsed.bindings !== 'object') {
    return {};
  }
  const overrides: ShortcutOverrides = {};
  for (const [id, binding] of Object.entries(parsed.bindings)) {
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
  return overrides;
}

function saveShortcutOverrides(overrides: ShortcutOverrides): void {
  const persisted: PersistedShortcutState = {
    version: 1,
    bindings: Object.fromEntries(
      Object.entries(overrides).filter(
        (entry): entry is [string, KeyChord[] | null] => entry[1] !== undefined
      )
    ),
  };
  writeJson(SHORTCUT_STORAGE_KEY, persisted);
}

export const useShortcutStore = create<ShortcutState>()(
  devtools(
    (set, get) => ({
      overrides: loadShortcutOverrides(),

      setShortcut: (id, chord) => {
        const overrides = { ...get().overrides, [id]: [normalizeKeyChord(chord)] };
        saveShortcutOverrides(overrides);
        set({ overrides });
      },

      clearShortcut: (id) => {
        const overrides = { ...get().overrides };
        if (shortcutKeepsDefaultChords(id)) {
          delete overrides[id];
        } else {
          overrides[id] = null;
        }
        saveShortcutOverrides(overrides);
        set({ overrides });
      },

      resetShortcut: (id) => {
        const overrides = { ...get().overrides };
        delete overrides[id];
        saveShortcutOverrides(overrides);
        set({ overrides });
      },

      resetAllShortcuts: () => {
        saveShortcutOverrides({});
        set({ overrides: {} });
      },
    }),
    { name: 'ShortcutStore' }
  )
);
