/** The system asks for a light interface. */
export const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

export interface InitialThemeInputs {
  /** The preset name the reader saved, if any. */
  savedName: string | null;
  /** Whether the system asks for a light interface. */
  prefersLight: boolean;
  /** Every preset the app has, by name. */
  presetNames: readonly string[];
  /** The preset for each system scheme, when no saved one applies. */
  defaults: { dark: string; light: string };
}

/**
 * Which preset the app opens in: the saved one while it still names a preset, otherwise
 * the default for the system's light or dark scheme.
 *
 * Pure and store-free, so `themeStore` and the landing page's inline head script
 * (`seo/staticPaintHead.ts`) answer it with the same code and cannot disagree.
 */
export function initialThemeName({ savedName, prefersLight, presetNames, defaults }: InitialThemeInputs): string {
  if (savedName && presetNames.includes(savedName)) return savedName;
  return prefersLight ? defaults.light : defaults.dark;
}
