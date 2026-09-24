/** The system asks for a light interface. */
export const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

/**
 * Which preset the app opens in: the saved one while it still names a preset, otherwise
 * the default for the system's light or dark scheme.
 *
 * Pure and store-free, so `themeStore` and the landing page's inline head script
 * (`seo/staticPaintHead.ts`) answer it with the same code and cannot disagree.
 */
export function initialThemeName(
  saved: string | null,
  prefersLight: boolean,
  presetNames: readonly string[],
  defaults: { dark: string; light: string }
): string {
  if (saved && presetNames.includes(saved)) return saved;
  return prefersLight ? defaults.light : defaults.dark;
}
