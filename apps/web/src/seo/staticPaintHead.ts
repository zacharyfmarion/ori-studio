import { resolveInitialLanguage } from '../i18n/locales';
import { readString, storageKey, STORAGE_KEYS } from '../lib/storage';
import { isPhoneLayout } from '../platform/phoneLayoutQuery';
import { getRuntimeSurface } from '../platform/runtime';
import { applyThemeVariables } from '../themes/applyThemeVariables';
import { initialThemeName, LIGHT_SCHEME_QUERY } from '../themes/initialTheme';
import {
  STATIC_PAINT_ATTRIBUTE,
  type StaticPaintDecision,
  type StaticPaintHeadConfig,
  type StaticPaintTheme,
} from './staticPaint';

/**
 * The head half of the static first paint (see `staticPaint.ts`): whether this visitor gets
 * the copy, and which. Inline in `<head>`, after the viewport meta tag — before it, a phone
 * still measures the 980px layout viewport and would be answered as a desktop — and before
 * the stylesheet, which an inline script would otherwise wait for.
 */

function currentPath(win: Window): string {
  return win.location.pathname.replace(/\/+$/, '') || '/';
}

function mediaHost(win: Window): Window | null {
  return typeof win.matchMedia === 'function' ? win : null;
}

/**
 * The theme this visitor's live page opens in, if it is one the copy can wear — or `null`
 * when the live page will not be this copy at all.
 */
function liveTheme(config: StaticPaintHeadConfig, win: Window): (StaticPaintTheme & { name: string }) | null {
  // The desktop app serves this same file and renders no footer or download button.
  if (getRuntimeSurface(win as unknown as Record<string, unknown>) === 'desktop') return null;
  // The SPA fallback serves this file for every unknown path; only its own are this page.
  if (!config.paths.includes(currentPath(win))) return null;
  // Off, the index redirects to Edit — and on `/welcome` the checkbox would render unticked.
  const welcome = readString(storageKey(STORAGE_KEYS.showWelcomeOnStartup));
  if (welcome !== null && welcome !== 'true') return null;
  // The app renders in the reader's language, not the URL's.
  if (resolveInitialLanguage() !== config.locale) return null;
  const host = mediaHost(win);
  const name = initialThemeName(
    readString(storageKey(STORAGE_KEYS.theme)),
    host?.matchMedia(LIGHT_SCHEME_QUERY).matches ?? false,
    config.presetNames,
    config.defaultThemes
  );
  const theme = config.themes[name];
  return theme ? { name, ...theme } : null;
}

/**
 * Decide, apply the theme the live page will open in, and record the decision on `<html>`
 * — where the stylesheet beside this script hides the copy from then on. Never throws: a
 * failure is `off`, and the body script removes the copy.
 */
export function decideStaticPaint(config: StaticPaintHeadConfig, win: Window = window): StaticPaintDecision {
  const root = win.document.documentElement;
  let decision: StaticPaintDecision = 'off';
  try {
    const theme = liveTheme(config, win);
    if (theme) {
      const variant = isPhoneLayout(mediaHost(win)) ? 'phone' : 'desktop';
      applyThemeVariables(root, theme, theme.variables);
      decision = variant;
    }
  } catch {
    decision = 'off';
  }
  root.setAttribute(STATIC_PAINT_ATTRIBUTE, decision);
  return decision;
}
