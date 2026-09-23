import type { TreeMakerTheme } from './types';

/** On `<html>`: whether the applied theme is light or dark. */
export const THEME_TYPE_ATTRIBUTE = 'data-theme-type';

/**
 * Put a theme's variables and attributes on `root`. A leaf, so the landing page's inline
 * head script (`seo/staticPaintHead.ts`), which carries precomputed variables, applies them
 * the same way {@link applyTheme} does without bundling the derivations behind them.
 */
export function applyThemeVariables(
  root: HTMLElement,
  theme: Pick<TreeMakerTheme, 'name' | 'type'>,
  variables: Iterable<readonly [string, string]>
): void {
  for (const [name, value] of variables) {
    root.style.setProperty(name, value);
  }
  root.setAttribute(THEME_TYPE_ATTRIBUTE, theme.type);
  root.setAttribute('data-theme-name', theme.name);
}
