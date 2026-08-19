import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DEFAULT_THEME,
  PRESET_THEMES,
} from '../themes';
import {
  resolveInitialTheme,
  resolveSystemDefaultTheme,
  THEME_STORAGE_KEY,
  useThemeStore,
} from './themeStore';

function mockSystemColorScheme(type: 'dark' | 'light') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === `(prefers-color-scheme: ${type})`,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  mockSystemColorScheme('dark');
  localStorage.clear();
  applyTheme(DEFAULT_THEME);
  useThemeStore.setState({
    currentTheme: DEFAULT_THEME,
    presetThemes: PRESET_THEMES,
  });
});

describe('themeStore', () => {
  it('exposes the Cascade preset theme set', () => {
    const names = useThemeStore.getState().presetThemes.map((theme) => theme.name);
    const firstDarkTheme = useThemeStore
      .getState()
      .presetThemes.find((theme) => theme.type === 'dark');
    const firstLightTheme = useThemeStore
      .getState()
      .presetThemes.find((theme) => theme.type === 'light');

    expect(names).toHaveLength(23);
    expect(firstDarkTheme?.name).toBe('One Dark');
    expect(firstLightTheme?.name).toBe('Atom One Light');
    expect(names).toContain('Solarized Dark');
    expect(names).toContain('GitHub Light');
    expect(names).toContain('Shades of Purple');
  });

  it('uses One Dark as the default dark theme', () => {
    mockSystemColorScheme('dark');

    expect(resolveSystemDefaultTheme()).toBe(DEFAULT_DARK_THEME);
    expect(resolveInitialTheme().name).toBe('One Dark');
  });

  it('uses Atom One Light as the default light theme', () => {
    mockSystemColorScheme('light');

    expect(resolveSystemDefaultTheme()).toBe(DEFAULT_LIGHT_THEME);
    expect(resolveInitialTheme().name).toBe('Atom One Light');
  });

  it('keeps a saved theme ahead of the system default', () => {
    mockSystemColorScheme('light');
    localStorage.setItem(THEME_STORAGE_KEY, 'Dracula');

    expect(resolveInitialTheme().name).toBe('Dracula');
  });

  it('applies and persists the selected theme', () => {
    const theme = PRESET_THEMES.find((preset) => preset.name === 'GitHub Light');
    expect(theme).toBeDefined();

    useThemeStore.getState().setTheme(theme ?? DEFAULT_THEME);

    expect(useThemeStore.getState().currentTheme.name).toBe('GitHub Light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('GitHub Light');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe(
      theme?.colors['bg.primary'],
    );
    expect(document.documentElement.getAttribute('data-theme-type')).toBe('light');
  });

  it('keeps M/V assignment colors semantic instead of theme-accent driven', () => {
    const lightTheme = PRESET_THEMES.find((preset) => preset.name === 'GitHub Light');
    const darkTheme = PRESET_THEMES.find((preset) => preset.name === 'Solarized Dark');
    expect(lightTheme).toBeDefined();
    expect(darkTheme).toBeDefined();

    useThemeStore.getState().setTheme(lightTheme ?? DEFAULT_THEME);
    expect(document.documentElement.style.getPropertyValue('--fold-mountain')).toBe('#d91f3a');
    expect(document.documentElement.style.getPropertyValue('--fold-valley')).toBe('#2563eb');

    useThemeStore.getState().setTheme(darkTheme ?? DEFAULT_THEME);
    expect(document.documentElement.style.getPropertyValue('--fold-mountain')).toBe('#ff4d5d');
    expect(document.documentElement.style.getPropertyValue('--fold-valley')).toBe('#60a5fa');
  });

  it('sets a theme by name and ignores unknown names', () => {
    useThemeStore.getState().setThemeByName('Dracula');
    expect(useThemeStore.getState().currentTheme.name).toBe('Dracula');

    useThemeStore.getState().setThemeByName('Not a Theme');
    expect(useThemeStore.getState().currentTheme.name).toBe('Dracula');
  });
});
