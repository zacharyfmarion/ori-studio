import type { DownloadOs } from '../platform/downloadOs';

/**
 * The prerendered welcome page as a first visit's first paint: what the build, the two inline
 * scripts and the app agree on.
 *
 * The prerender writes the page's copy into the HTML so crawlers read it. For a long time it
 * was removed before anything painted, because it was not the page React went on to render —
 * no start screen, the wrong palette — and swapping one for the other looked broken. Now the
 * copy *is* that page (`components/landing/WelcomePage.tsx` renders both), so it can stay,
 * but only for a visitor whose live page will be exactly it, and only once it has been
 * finished with what just the browser knows: the theme, phone or not, and the platform the
 * download button names.
 *
 * The parser may paint whatever it has parsed so far — Chrome was seen to paint the desktop
 * copy on a phone before a script after it could swap in the phone one — so no part of the
 * copy may show before it is finished. Hence two scripts, with a stylesheet between them:
 *
 * - `staticPaintHead.ts`, inline in `<head>`, runs before any of the copy exists. It
 *   decides, applies the theme, and records the decision in {@link STATIC_PAINT_ATTRIBUTE}.
 *   From that moment the stylesheet hides the copy.
 * - `staticPaintBody.ts`, inline after the copy, finishes it — or removes it — marks it
 *   {@link STATIC_PAINT_SHOWN}, which is the only state the stylesheet shows it in, and
 *   starts the app.
 *
 * So the first frame with the copy in it is the finished page, never a part of one. A reader
 * without JavaScript gets no attribute, and the copy as it was written. The app replaces the
 * copy with its own render of the same page in one frame (`staticCopy.ts`).
 *
 * Both scripts are bundled on their own by `scripts/prerender-landing.mjs`, so everything
 * they import is React-free and store-free. Anything they cannot guarantee, they answer by
 * removing the copy — the old behaviour — so the worst case is a blank first paint.
 * `scripts/static-paint-check.mjs` holds the rest to zero differing pixels.
 */

/** Holds the phone variant of the copy, inert until a phone asks for it. */
export const PHONE_COPY_TEMPLATE_ID = 'seo-content-phone';

/** On `<html>`: which copy this visitor gets, and then whether it is ready to be seen. */
export const STATIC_PAINT_ATTRIBUTE = 'data-static-paint';
export type StaticPaintDecision = 'desktop' | 'phone' | 'off';
/** The finished state, and the only one the stylesheet shows the copy in. */
export const STATIC_PAINT_SHOWN = 'shown';

/**
 * Where the body script records how far a reader scrolled the copy before the app arrived,
 * so the live page can open at the same place.
 */
export const STATIC_SCROLL_ATTRIBUTE = 'data-scroll-top';

export interface StaticPaintTheme {
  type: 'light' | 'dark';
  variables: ReadonlyArray<readonly [string, string]>;
}

/** What the head script is told by the build. */
export interface StaticPaintHeadConfig {
  /** The paths this HTML file is served for, with no trailing slash (`/` stays `/`). */
  paths: readonly string[];
  /** The language the copy is written in. */
  locale: string;
  /** The themes the copy can be painted in, by preset name: `themeCssVariables` of each. */
  themes: Record<string, StaticPaintTheme>;
  presetNames: readonly string[];
  defaultThemes: { dark: string; light: string };
}

/** What the body script is told by the build. */
export interface StaticPaintBodyConfig {
  /** The download button's label for each platform, in the copy's language. */
  downloadLabels: Record<DownloadOs | 'none', string>;
  /**
   * The app's entry module. On a painted page the HTML only preloads it, and the body script
   * starts it.
   */
  entry: string;
}
