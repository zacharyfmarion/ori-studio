import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANDING_SECTIONS } from '../../components/landing/WelcomeLanding';
import {
  CONTENT_PAGES,
  LANDING_PAGE,
  PAGE_LOCALES,
  pagePath,
  SITE_LOCALES,
  SITE_PAGES,
} from '../../site/sitePages';
import { escapeForScriptTag, landingJsonLd, landingJsonLdScript, pageJsonLd } from '../jsonLd';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, PRESET_THEMES, themeCssVariables } from '../../themes';
import {
  loadLocaleResources,
  pageMeta,
  prerenderSite,
  renderLandingMarkup,
  renderPageMarkup,
  staticPaintConfig,
} from '../prerenderEntry';
import { SEO_CONTENT_ID, SITE_NAME, SITE_ORIGIN, SITE_TITLE, siteUrl } from '../siteMeta';
import { PHONE_COPY_TEMPLATE_ID, STATIC_PAINT_ATTRIBUTE } from '../staticPaint';

/**
 * The PR-time gate on the prerender.
 *
 * CI never builds a `dist` — the web-client job lints, typechecks and tests — so nothing
 * else here would notice the prerender throwing or quietly rendering an empty string. The
 * post-deploy smoke test would, but only once it had shipped. This runs on every PR.
 */
describe('landing prerender', () => {
  const markup = renderLandingMarkup();

  it('renders the landing copy a crawler needs to see', () => {
    // The pitch, in the words the plan targets. If the marketing copy is rewritten these
    // should be updated deliberately — that is the point of asserting on them.
    expect(markup).toContain('crease pattern');
    expect(markup).toContain('open-source');
    expect(markup).toContain('Box Pleating');
    expect(markup).toContain('Circle Packing');
  });

  it('renders every landing section, not just the one above the fold', () => {
    // Both carousels map over all their items rather than mounting only the active one,
    // which is what puts every feature's text in the static HTML. A carousel rewritten to
    // render lazily would silently cut the indexable copy down to the first slide.
    for (const section of LANDING_SECTIONS) {
      expect(markup).toContain(`id="${section.id}"`);
    }
  });

  it('names the page in its first h1, ahead of the start screen’s own', () => {
    // The start screen's heading ("Start a new origami workspace") is the live page's, and
    // the copy has to carry it to paint as that page does. It heads a control panel, so the
    // copy opens with one that says what the page is.
    const h1s = markup.match(/<h1[^>]*>[^<]*<\/h1>/g) ?? [];
    expect(h1s).toHaveLength(2);
    expect(h1s[0]).toContain(SITE_TITLE);
    expect(h1s[1]).toContain('id="start-screen-title"');
  });

  it('carries everything the body script finishes, by the names it finds them by', () => {
    // `staticPaintBody.ts` finds these by class. A rename in the components would leave the
    // copy naming no platform, or in the wrong screenshots, and nothing else would notice.
    for (const needle of [
      'ui-split-button__primary',
      'class="landing-figure__image"',
      'loading="lazy"',
      'class="welcome-page"',
      'welcome-scroll-cue',
    ]) {
      expect(markup).toContain(needle);
    }
    expect(markup).not.toContain('data-surface="phone"');
    expect(renderPageMarkup(LANDING_PAGE, 'en', { phone: true })).toContain('data-surface="phone"');
  });

  it('hides that h1 by clipping, never by display:none', () => {
    // `display: none` is the form crawlers discount. Clip-based hiding is ordinary
    // content to them and is still announced by screen readers.
    expect(markup).toContain('clip-path:inset(50%)');
    expect(markup).not.toMatch(/<h1[^>]*display:\s*none/);
  });

  it('produces static markup with no hydration payload', () => {
    // `renderToStaticMarkup`, not `renderToString`: nothing hydrates this, so React's
    // hydration markers would be bytes shipped to every visitor for no reason.
    expect(markup).not.toContain('data-reactroot');
    expect(markup).not.toContain('<!--$-->');
  });

  it('links every other page of the site from the landing', () => {
    // The footer is the only place the landing points at its siblings, which makes it
    // the way a crawler on the homepage learns a download page exists. Sitelinks are
    // chosen from pages Google can reach; a page linked from nowhere is not one.
    for (const page of CONTENT_PAGES) {
      expect(markup).toContain(`href="${page.path}"`);
    }
  });
});

/**
 * The content pages, through the same gate.
 *
 * Every assertion here names one of the ways a page fails without a sound — a copy
 * with no words, a page that does not link back, a heading structure a crawler cannot
 * read — and each one still deploys, serves and 200s.
 */
describe('content page prerender', () => {
  it.each(CONTENT_PAGES)('renders $path with its own h1 and real copy', (page) => {
    const markup = renderPageMarkup(page);
    const h1s = markup.match(/<h1[\s>]/g) ?? [];
    expect(h1s).toHaveLength(1);
    expect(markup.length).toBeGreaterThan(2000);
  });

  it.each(CONTENT_PAGES)('marks $path as the current page in its own nav', (page) => {
    const markup = renderPageMarkup(page);
    const current = markup.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(current.length).toBeGreaterThan(0);
    for (const tag of current) expect(tag).toContain(`href="${page.path}"`);
  });

  it.each(CONTENT_PAGES)('links $path back to the landing and to every sibling', (page) => {
    const markup = renderPageMarkup(page);
    expect(markup).toContain('href="/"');
    for (const other of CONTENT_PAGES) {
      expect(markup).toContain(`href="${other.path}"`);
    }
  });
});

/**
 * What each page is *for*, pinned by the words that make it that page. The generic
 * checks above prove every page is well-formed; these prove the download page still
 * lists builds, the Oriedita page still explains the import, the FAQ still asks
 * questions, and the guide still names the start screen's actions with the start
 * screen's own strings.
 */
describe('each content page says what it is for', () => {
  const page = (id: string) => CONTENT_PAGES.find((candidate) => candidate.id === id)!;

  it('the Oriedita page explains the shortcut import and links to Oriedita', () => {
    const markup = renderPageMarkup(page('oriedita'));
    expect(markup).toContain('Settings › Shortcuts');
    expect(markup).toContain('href="https://oriedita.github.io/"');
    // A crawler-visible claim about the relationship, in so many words.
    expect(markup).toContain('not affiliated with Oriedita');
  });

  it('the FAQ is a list of questions, each an h2, each a real question', () => {
    const markup = renderPageMarkup(page('faq'));
    const questions = markup.match(/<h2[^>]*class="[^"]*site-faq__question[^"]*"[^>]*>([^<]*)<\/h2>/g) ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(8);
    for (const question of questions) expect(question).toMatch(/\?<\/h2>$/);
  });

  it('every content page links to at least one other content page', () => {
    // The pages form a small graph — guide → Oriedita → download, FAQ → both — and a page
    // linked only from the footer is a page a crawler weights as a footer link.
    for (const current of CONTENT_PAGES) {
      const markup = renderPageMarkup(current);
      const body = markup.slice(0, markup.indexOf('<footer'));
      const others = CONTENT_PAGES.filter((other) => other !== current);
      expect(others.some((other) => body.includes(`href="${other.path}"`)), current.id).toBe(true);
    }
  });
});

/**
 * The whole assembly, against a stand-in for the built `index.html`.
 *
 * A template rather than the real `dist/index.html`, which CI never builds — but with the
 * real `<head>` from `apps/web/index.html`, because the canonical it hardcodes is the
 * exact thing a content page has to overwrite.
 */
describe('prerenderSite', () => {
  const template = indexHtml().replace('<script type="module" src="/src/main.tsx"></script>', '');
  const files = prerenderSite(template);
  const fileFor = (path: string, locale = 'en') => {
    const match = files.find((entry) => entry.page.path === path && entry.locale === locale);
    if (!match) throw new Error(`no output for ${path} in ${locale}`);
    return match;
  };

  it('writes the landing to the root and to /welcome, and every content page to its directory', () => {
    const names = files.map(({ file }) => file);
    expect(names).toContain('index.html');
    expect(names).toContain('welcome/index.html');
    for (const page of CONTENT_PAGES) {
      expect(names).toContain(`${page.path.replace(/^\/|\/$/g, '')}/index.html`);
    }
  });

  it('writes every page once per locale, under the locale', () => {
    const names = files.map(({ file }) => file);
    // 9 locales × the registry, plus /welcome.
    expect(files).toHaveLength(PAGE_LOCALES.length * SITE_PAGES.length + 1);
    for (const locale of SITE_LOCALES) {
      expect(names).toContain(`${locale}/index.html`);
      for (const page of CONTENT_PAGES) {
        expect(names).toContain(`${locale}/${page.path.replace(/^\/|\/$/g, '')}/index.html`);
      }
    }
  });

  /**
   * The central trap. `index.html` says `canonical → /`, which is right for the landing
   * and for the app routes that fold into it. A content page shipped with it would tell a
   * crawler the page *is* the homepage, be consolidated into it, and never be indexed as
   * itself — while deploying, serving and 200ing exactly like a page that works.
   */
  it.each(CONTENT_PAGES)('gives $path its own canonical, not the homepage’s', (page) => {
    const { html } = fileFor(page.path);
    expect(html).toContain(`<link rel="canonical" href="${siteUrl(page.path)}" />`);
    expect(html).not.toContain(`<link rel="canonical" href="${SITE_ORIGIN}/" />`);
    expect(html).toContain(`<meta property="og:url" content="${siteUrl(page.path)}" />`);
  });

  it.each(CONTENT_PAGES)('gives $path its own title, description and card', (page) => {
    const { html } = fileFor(page.path);
    const { title, description } = pageMeta(page);
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta name="description" content="${description}" />`);
    expect(html).toContain(`<meta property="og:title" content="${title}" />`);
    expect(html).toContain(`<meta name="twitter:title" content="${title}" />`);
  });

  it('leaves the landing’s head as index.html wrote it', () => {
    const { html } = fileFor('/');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/" />`);
    expect(html).toContain(`<title>${SITE_TITLE}</title>`);
    // The card says more than the title on purpose; the template's is the right one.
    expect(html).toContain(
      '<meta property="og:title" content="Ori Studio — origami crease pattern editor and folding simulator" />'
    );
  });

  it('gives the landing the site graph and a content page only a WebPage', () => {
    expect(fileFor('/').html).toContain('"@type":"WebSite"');
    for (const page of CONTENT_PAGES) {
      const { html } = fileFor(page.path);
      // A `WebSite` node is homepage-only by definition; a download page carrying one
      // would be claiming to be the site from a URL that is not the site.
      expect(html).not.toContain('"@type":"WebSite"');
      expect(html).not.toContain('"@type":"SoftwareApplication"');
      expect(html).toContain('"@type":"WebPage"');
      expect(html).toContain(`"isPartOf":{"@id":"${SITE_ORIGIN}/#website"}`);
    }
  });

  it('puts every page’s copy before #root with the script that removes it', () => {
    for (const { html } of files) {
      expect(html).toContain(`<div id="${SEO_CONTENT_ID}">`);
      expect(html).toContain(`<script>document.getElementById("${SEO_CONTENT_ID}").remove()</script>`);
      expect(html.indexOf(`id="${SEO_CONTENT_ID}"`)).toBeLessThan(html.indexOf('<div id="root"></div>'));
    }
  });

  /**
   * The localized copies, through the same gate. Each assertion names a way a localized
   * page fails without a sound: a Chinese page still marked English, a page whose canonical
   * points at the English one and gets dropped as a duplicate, an `hreflang` set that names
   * eight of nine and is ignored as malformed, an English title over Chinese copy.
   */
  describe.each(SITE_LOCALES)('in %s', (locale) => {
    const resources = loadLocaleResources(locale)[locale] as { landing: { what: { title: string } } };
    const localizedHeading = resources.landing.what.title;

    it.each(SITE_PAGES)('marks $path with its own language', (page) => {
      const { html } = fileFor(page.path, locale);
      expect(html).toContain(`<html lang="${locale}">`);
      expect(html).not.toContain('<html lang="en">');
    });

    it.each(SITE_PAGES)('gives $path a canonical to itself, never to the English page', (page) => {
      // A translation is a different page for a different reader, not a duplicate. A
      // canonical at the English page would have a crawler drop it — the opposite of the
      // point — and still deploy, serve and 200.
      const { html } = fileFor(page.path, locale);
      const own = siteUrl(pagePath(page, locale));
      expect(html).toContain(`<link rel="canonical" href="${own}" />`);
      expect(html).not.toContain(`<link rel="canonical" href="${siteUrl(page.path)}" />`);
      expect(html).toContain(`<meta property="og:url" content="${own}" />`);
    });

    it.each(SITE_PAGES)('names every copy of $path in its hreflang set, plus x-default', (page) => {
      const { html } = fileFor(page.path, locale);
      for (const other of PAGE_LOCALES) {
        expect(html).toContain(
          `<link rel="alternate" hreflang="${other}" href="${siteUrl(pagePath(page, other))}" />`
        );
      }
      expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${siteUrl(page.path)}" />`);
      expect(html.match(/rel="alternate" hreflang=/g)).toHaveLength(PAGE_LOCALES.length + 1);
    });

    it.each(SITE_PAGES)('titles and describes $path in its own language', (page) => {
      const { html } = fileFor(page.path, locale);
      const localized = pageMeta(page, locale);
      const english = pageMeta(page);
      expect(localized.title).not.toBe(english.title);
      expect(html).toContain(`<title>${localized.title}</title>`);
      expect(html).toContain(`<meta name="description" content="${localized.description}" />`);
      expect(html).toContain(`<meta property="og:title" content="${localized.title}" />`);
    });

    it('carries the landing’s words in its language, and none of the English copy', () => {
      const { html } = fileFor('/', locale);
      expect(html).toContain(localizedHeading);
      expect(html).not.toContain('A free, open-source workspace for origami design');
    });

    it('links its own language’s pages from the nav, and every language from the switch', () => {
      const { html } = fileFor('/', locale);
      for (const page of CONTENT_PAGES) {
        expect(html).toContain(`href="${pagePath(page, locale)}"`);
      }
      for (const other of PAGE_LOCALES) {
        expect(html).toContain(`href="${pagePath(LANDING_PAGE, other)}"`);
      }
    });
  });

  it('gives the English page the same hreflang set, so the nine agree', () => {
    const { html } = fileFor('/');
    expect(html.match(/rel="alternate" hreflang=/g)).toHaveLength(PAGE_LOCALES.length + 1);
    expect(html).toContain(`<link rel="alternate" hreflang="zh-CN" href="${SITE_ORIGIN}/zh-CN/" />`);
    expect(html).toContain('<meta property="og:locale" content="en_US" />');
    expect(fileFor('/', 'zh-CN').html).toContain('<meta property="og:locale" content="zh_CN" />');
  });

  it('is idempotent over its own output', () => {
    // Running the script twice over the same `dist` is the obvious way to iterate on it,
    // and used to leave two copies of the landing and two JSON-LD blocks.
    const { html } = fileFor('/');
    const again = prerenderSite(html).find(({ file }) => file === 'index.html');
    expect(again?.html).toBe(html);
  });
});

/**
 * The landing as a first paint (`staticPaint.ts`), assembled from a stand-in for the *built*
 * `index.html` — the entry and stylesheet where Vite writes them — and stand-ins for the two
 * bundles, which `scripts/prerender-landing.mjs` builds and this test does not need to.
 */
describe('the painted landing', () => {
  const ENTRY = '/assets/index-abc.js';
  const built = indexHtml()
    .replace('<script type="module" src="/src/main.tsx"></script>', '')
    .replace(
      '</head>',
      `<script type="module" crossorigin src="${ENTRY}"></script>\n<link rel="stylesheet" crossorigin href="/assets/index-abc.css">\n</head>`
    );
  const scripts = { head: 'var HEAD_BUNDLE;', body: 'var BODY_BUNDLE;' };
  const files = prerenderSite(built, scripts);
  const landing = files.find(({ file }) => file === 'index.html')!.html;
  const painted = (html: string) => html.includes(`<template id="${PHONE_COPY_TEMPLATE_ID}">`);

  it('paints the English landing and /welcome, and removes every other page’s copy', () => {
    for (const { file, html } of files) {
      const expected = file === 'index.html' || file === 'welcome/index.html';
      expect(painted(html), file).toBe(expected);
      expect(html.includes(`<script>document.getElementById("${SEO_CONTENT_ID}").remove()</script>`), file).toBe(
        !expected
      );
    }
  });

  it('preloads the entry for the body script to start, rather than running it', () => {
    expect(landing).toContain(`<link rel="modulepreload" crossorigin fetchpriority="low" href="${ENTRY}">`);
    expect(landing).not.toContain(`<script type="module" crossorigin src="${ENTRY}">`);
    // A page that is not painted runs its entry as Vite wrote it.
    const download = files.find(({ file }) => file === 'download/index.html')!.html;
    expect(download).toContain(`<script type="module" crossorigin src="${ENTRY}"></script>`);
  });

  it('decides in the head: after the viewport meta tag, before the stylesheet', () => {
    const decide = landing.indexOf('<script id="static-paint-head">');
    expect(decide).toBeGreaterThan(landing.indexOf('name="viewport"'));
    expect(decide).toBeLessThan(landing.indexOf('rel="stylesheet"'));
    expect(landing.indexOf('<style id="static-paint">')).toBeLessThan(decide);
    expect(landing).toContain('var HEAD_BUNDLE;\n__oriStaticPaint.decideStaticPaint({"paths":["/","/welcome"]');
  });

  it('finishes after the copy and its phone variant, and before #root', () => {
    const copy = landing.indexOf(`<div id="${SEO_CONTENT_ID}"`);
    const template = landing.indexOf(`<template id="${PHONE_COPY_TEMPLATE_ID}">`);
    const finish = landing.indexOf('var BODY_BUNDLE;\n__oriStaticPaint.finishStaticPaint(');
    expect(copy).toBeGreaterThan(-1);
    expect(template).toBeGreaterThan(copy);
    expect(finish).toBeGreaterThan(template);
    expect(landing.indexOf('<div id="root"></div>')).toBeGreaterThan(finish);
    expect(landing).toContain(`"entry":"${ENTRY}"`);
  });

  it('hides the copy from the head’s decision until the body script has finished it', () => {
    const rule = /<style id="static-paint">([^<]*)<\/style>/.exec(landing)?.[1];
    expect(rule).toBeTruthy();
    const style = document.createElement('style');
    style.textContent = rule!;
    document.head.append(style);
    const copy = document.createElement('div');
    copy.id = SEO_CONTENT_ID;
    document.body.append(copy);
    const root = document.documentElement;
    try {
      // No decision: no JavaScript ran, and the copy shows as written.
      expect(getComputedStyle(copy).display).not.toBe('none');
      for (const decision of ['desktop', 'phone', 'off']) {
        root.setAttribute(STATIC_PAINT_ATTRIBUTE, decision);
        expect(getComputedStyle(copy).display, decision).toBe('none');
      }
      root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'shown');
      expect(getComputedStyle(copy).display).not.toBe('none');
    } finally {
      root.removeAttribute(STATIC_PAINT_ATTRIBUTE);
      style.remove();
      copy.remove();
    }
  });

  it('is idempotent over its own output', () => {
    const again = prerenderSite(landing, scripts).find(({ file }) => file === 'index.html');
    expect(again?.html).toBe(landing);
  });

  it('refuses a bundle that would end its own script tag', () => {
    expect(() => prerenderSite(built, { ...scripts, body: 'var s = "</script>";' })).toThrow('</script>');
  });

  it('can start in the desktop app, whose CSP allows an inline script only by its hash', () => {
    // The body script is what starts the app, and `tauri.conf.json`'s CSP has no
    // 'unsafe-inline'. Tauri hashes every inline script of the bundled HTML into it at
    // compile time — unless asset CSP modification is disabled for script-src, which would
    // leave the desktop app showing a copy that never starts. Measured under that CSP in
    // WebKit: with the hashes it boots; without them, it does not.
    const conf = JSON.parse(
      readFileSync(join(dirname(new URL(import.meta.url).pathname), '../../../../tauri/src-tauri/tauri.conf.json'), 'utf8')
    ) as { app: { security: { csp: string; dangerousDisableAssetCspModification?: boolean | string[] } } };
    const { csp, dangerousDisableAssetCspModification: disabled } = conf.app.security;
    const hashesInlineScripts =
      disabled === undefined || disabled === false || (Array.isArray(disabled) && !disabled.includes('script-src'));
    expect(hashesInlineScripts || /script-src[^;]*'unsafe-inline'/.test(csp)).toBe(true);
  });

  it('refuses a template with no entry for the body script to start', () => {
    expect(() => prerenderSite(indexHtml(), scripts)).toThrow('no module entry script');
  });
});

describe('staticPaintConfig', () => {
  const { head, body } = staticPaintConfig(LANDING_PAGE, 'en', '/assets/index-abc.js');

  it('knows the paths the landing is served at, as the router sees them', () => {
    expect(head.paths).toEqual(['/', '/welcome']);
    expect(head.locale).toBe('en');
  });

  it('carries both default themes as the app applies them, and knows every preset', () => {
    expect(head.defaultThemes).toEqual({ dark: DEFAULT_DARK_THEME.name, light: DEFAULT_LIGHT_THEME.name });
    expect(head.themes[DEFAULT_DARK_THEME.name]).toEqual({
      type: 'dark',
      variables: themeCssVariables(DEFAULT_DARK_THEME),
    });
    expect(head.themes[DEFAULT_LIGHT_THEME.name]?.type).toBe('light');
    expect(Object.keys(head.themes)).toHaveLength(2);
    expect(head.presetNames).toEqual(PRESET_THEMES.map((theme) => theme.name));
  });

  it('names the download button for every platform, as the live button does', () => {
    expect(body).toEqual({
      downloadLabels: {
        macos: 'Download for macOS',
        windows: 'Download for Windows',
        linux: 'Download for Linux',
        none: 'Download the desktop app',
      },
      entry: '/assets/index-abc.js',
    });
  });
});

/** `apps/web/index.html` — Vite's entry, read before any of our code runs. */
function indexHtml(): string {
  return readFileSync(join(dirname(new URL(import.meta.url).pathname), '../../../index.html'), 'utf8');
}

describe('site metadata', () => {
  it('keeps the id the prerender writes and main.tsx removes in one place', () => {
    // A drift here is the silent failure: the app would boot with the crawler copy still
    // on the page, underneath the real one.
    expect(SEO_CONTENT_ID).toBe('seo-content');
  });

  /**
   * The crawler must never see the title change under it.
   *
   * It saw exactly that until `useWindowTitle` learned about the landing route:
   * `index.html` served this sentence, Googlebot's render pass replaced it with
   * the blank project's name, and "Ori Studio: Untitled" is what got indexed.
   * The runtime title on the landing is now `SITE_TITLE`, so the two agree —
   * which makes this duplicated string load-bearing rather than cosmetic, and
   * nothing else compares them.
   *
   * Asserted rather than generated because `index.html` is Vite's entry: it is
   * read before any of our code runs, and the dev server serves it directly.
   */
  it('serves the same title from index.html that the app sets at runtime', () => {
    expect(indexHtml()).toContain(`<title>${SITE_TITLE}</title>`);
  });

  it('declares the site name in the markup as well as the graph', () => {
    // Google takes the site name from either, and `index.html` is the copy a crawler that
    // renders nothing receives. Same drift risk as the title above: nothing else compares
    // this string to `SITE_NAME`.
    expect(indexHtml()).toContain(`<meta property="og:site_name" content="${SITE_NAME}" />`);
  });

  it('keeps the title short enough for a result to print it whole', () => {
    // Google gives a title roughly 600px, near enough 60 characters. The previous title ran
    // to 76 and was cut mid-phrase; a title long enough to cut is also one Google is more
    // likely to replace with something we did not choose.
    expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
  });

  it('builds absolute sitemap URLs on the canonical origin', () => {
    expect(SITE_ORIGIN).not.toMatch(/\/$/);
    expect(siteUrl('/')).toBe(`${SITE_ORIGIN}/`);
    expect(siteUrl('/download/')).toBe(`${SITE_ORIGIN}/download/`);
  });
});

describe('landing JSON-LD', () => {
  const graph = landingJsonLd()['@graph'] as Record<string, unknown>[];
  const node = (type: string) => graph.find((entry) => entry['@type'] === type);
  const app = node('SoftwareApplication') as Record<string, unknown>;
  const site = node('WebSite') as Record<string, unknown>;

  it('declares a free SoftwareApplication Google can resolve to an entity', () => {
    expect(app).toBeDefined();
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.offers).toMatchObject({ price: '0' });
  });

  /**
   * The node behind the site name — the line above the URL in a result, which printed
   * `oristudio.dev` while nothing declared one. `og:site_name` is the other input, and
   * `index.html` carries it; Google reads both and still picks what it shows, so this
   * asserts the signal is sent, not the outcome.
   */
  it('names the site, so a result has something to print above the URL', () => {
    expect(site).toBeDefined();
    expect(site.name).toBe(SITE_NAME);
    expect(site.url).toBe(`${SITE_ORIGIN}/`);
  });

  it('ties the two nodes together rather than leaving two unrelated entities', () => {
    expect(site.publisher).toEqual({ '@id': app['@id'] });
  });

  it('links the entity to the repository and chat', () => {
    // `sameAs` is what ties this page to the GitHub project Google already indexes —
    // the strongest available disambiguation from the two design studios of the same name.
    expect(app.sameAs).toEqual(
      expect.arrayContaining([expect.stringContaining('github.com')])
    );
  });

  it('describes a content page as a WebPage of the site, in its language', () => {
    const [page] = CONTENT_PAGES;
    const node = pageJsonLd(page, 'zh-CN', pageMeta(page, 'zh-CN'));
    expect(node['@type']).toBe('WebPage');
    expect(node.url).toBe(siteUrl(pagePath(page, 'zh-CN')));
    expect(node.inLanguage).toBe('zh-CN');
    expect(node.isPartOf).toEqual({ '@id': `${SITE_ORIGIN}/#website` });
    expect(SITE_PAGES).toContain(LANDING_PAGE);
  });

  it('escapes < so a value can never close the script tag', () => {
    // Against a hostile string, because none of the live constants contains a `<` — so
    // asserting on the real output passes whether or not the escaper is wired up at all.
    // That was the previous version of this test, and it tested nothing.
    expect(escapeForScriptTag('{"x":"</script><img onerror=1>"}')).not.toContain('</script');
    expect(escapeForScriptTag('{"x":"</script>"}')).toContain('\\u003c/script');
    // And the shipped block carries no raw `<` either way.
    expect(landingJsonLdScript()).not.toContain('<');
  });
});
