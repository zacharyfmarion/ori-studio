import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { track } from '../analytics';
import {
  applyTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  PRESET_THEMES,
  type TreeMakerTheme,
} from '../themes';
import { readString, storageKey, STORAGE_KEYS, writeString } from '../lib/storage';
import { initialThemeName, LIGHT_SCHEME_QUERY } from '../themes/initialTheme';

export const THEME_STORAGE_KEY = storageKey(STORAGE_KEYS.theme);

function loadSavedThemeName(): string | null {
  return readString(THEME_STORAGE_KEY);
}

function saveThemeName(name: string): void {
  writeString(THEME_STORAGE_KEY, name);
}

export function resolveSystemDefaultTheme(): TreeMakerTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_DARK_THEME;
  }
  return window.matchMedia(LIGHT_SCHEME_QUERY).matches ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
}

export function resolveInitialTheme(): TreeMakerTheme {
  const name = initialThemeName(
    loadSavedThemeName(),
    resolveSystemDefaultTheme() === DEFAULT_LIGHT_THEME,
    PRESET_THEMES.map((theme) => theme.name),
    { dark: DEFAULT_DARK_THEME.name, light: DEFAULT_LIGHT_THEME.name }
  );
  return PRESET_THEMES.find((theme) => theme.name === name) ?? DEFAULT_DARK_THEME;
}

interface ThemeState {
  currentTheme: TreeMakerTheme;
  presetThemes: TreeMakerTheme[];
  setTheme: (theme: TreeMakerTheme) => void;
  setThemeByName: (name: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  devtools(
    (set, get) => {
      const initialTheme = resolveInitialTheme();
      applyTheme(initialTheme);

      return {
        currentTheme: initialTheme,
        presetThemes: PRESET_THEMES,

        setTheme: (theme) => {
          applyTheme(theme);
          saveThemeName(theme.name);
          set({ currentTheme: theme });
          // Preset theme names are a bounded enum. Init uses applyTheme directly,
          // so this fires only on a user-driven theme change.
          track('theme changed', { theme: theme.name });
        },

        setThemeByName: (name) => {
          const theme = get().presetThemes.find((preset) => preset.name === name);
          if (theme) get().setTheme(theme);
        },
      };
    },
    { name: 'ThemeStore' }
  )
);
