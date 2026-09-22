import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, SYSTEM_LOCALE } from '../i18n/locales';
import { useLocaleStore } from '../store/localeStore';
import { preloadLocale } from '../test/preloadLocale';
import { SiteFooter } from './SiteFooter';
import { CONTENT_PAGES, pagePath, SITE_PAGES } from './sitePages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(path = '/'): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <SiteFooter />
      </MemoryRouter>
    );
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  act(() => useLocaleStore.setState({ preference: SYSTEM_LOCALE }));
  localStorage.clear();
});

/**
 * Picking a language re-renders the page you are on; it is not a page you visited.
 *
 * Pushed, Back returns to the unprefixed URL — which is language-negotiated, so with the
 * preference now pinned it renders in the language just chosen, looks identical to the
 * page being left, and Back appears to do nothing. Reported 2026-09-22. A real router
 * here rather than `MemoryRouter`, because the whole assertion is what one step back
 * lands on.
 */
describe('the language switch and history', () => {
  it('replaces its entry, so Back returns to the page before, not to a twin', async () => {
    const download = CONTENT_PAGES.find((page) => page.id === 'download')!;
    const router = createMemoryRouter(
      [
        { path: '/', element: <div>landing</div> },
        { path: 'download/', element: <SiteFooter /> },
        { path: 'es/download/', element: <SiteFooter /> },
      ],
      { initialEntries: ['/', download.path], initialIndex: 1 }
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<RouterProvider router={router} />));

    const spanish = container.querySelector<HTMLAnchorElement>('.site-languages a[hreflang="es"]');
    await act(async () => spanish?.click());
    expect(router.state.location.pathname).toBe(pagePath(download, 'es'));

    await act(async () => {
      await router.navigate(-1);
    });

    expect(router.state.location.pathname).toBe('/');
    router.dispose();
  });
});

describe('SiteFooter', () => {
  it('links every page of the site, which is how a crawler on the landing finds them', () => {
    const rendered = render();
    for (const page of SITE_PAGES) {
      expect(rendered.querySelector(`a[href="${page.path}"]`), page.path).not.toBeNull();
    }
  });

  it('marks the links that leave the site, and only those', () => {
    // GitHub sits beside Download in the same type; the arrow is what says one is another
    // site. On-site links must not carry it, or it stops meaning anything.
    const rendered = render();
    const marked = Array.from(rendered.querySelectorAll('a.site-external-link')).map((a) =>
      a.getAttribute('href')
    );
    expect(marked).toHaveLength(3);
    for (const href of marked) expect(href).toMatch(/^https:\/\//);
    for (const page of SITE_PAGES) {
      expect(rendered.querySelector(`a[href="${page.path}"] .site-external-link__mark`)).toBeNull();
    }
  });

  it('marks the page it is on', () => {
    const rendered = render();
    expect(rendered.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/');
  });

  it('offers this page in every language, by its own name, as real links', () => {
    // How a crawler learns `/zh-CN/download/` exists: a `<select>` is a control it cannot
    // operate; an anchor is a link it follows.
    const download = CONTENT_PAGES.find((page) => page.id === 'download')!;
    const rendered = render(download.path);
    const links = Array.from(rendered.querySelectorAll<HTMLAnchorElement>('.site-languages a'));
    expect(links).toHaveLength(SUPPORTED_LOCALES.length);
    for (const locale of SUPPORTED_LOCALES) {
      const link = links.find((a) => a.getAttribute('hreflang') === locale.code);
      expect(link, locale.code).toBeDefined();
      expect(link?.getAttribute('href')).toBe(pagePath(download, locale.code));
      expect(link?.textContent).toBe(locale.nativeName);
      expect(link?.getAttribute('lang')).toBe(locale.code);
    }
  });

  it('marks the language it is in, and links the nav within it', () => {
    const download = CONTENT_PAGES.find((page) => page.id === 'download')!;
    const rendered = render(pagePath(download, 'zh-CN'));
    expect(rendered.querySelector('.site-languages a[aria-current="true"]')?.getAttribute('hreflang')).toBe(
      'zh-CN'
    );
    expect(rendered.querySelector('.site-nav a[href="/zh-CN/"]')).not.toBeNull();
    expect(rendered.querySelector('.site-nav a[href="/zh-CN/download/"][aria-current="page"]')).not.toBeNull();
  });

  /**
   * Arriving at `/ja/` is not a choice; picking 日本語 from a language menu is. The
   * first shows Japanese while you are there and forgets it when you open the app; the
   * second is the same act as choosing it in Settings, and persists the same way — so
   * "Open the app" from a page you chose the language of opens the app in that language.
   */
  it('pins the language when one is chosen from the switch, like Settings does', () => {
    preloadLocale('ja');
    localStorage.clear();
    act(() => useLocaleStore.setState({ preference: SYSTEM_LOCALE }));
    const rendered = render('/');
    expect(useLocaleStore.getState().preference).toBe(SYSTEM_LOCALE);

    const japanese = rendered.querySelector<HTMLAnchorElement>('.site-languages a[hreflang="ja"]');
    act(() => japanese?.click());

    expect(useLocaleStore.getState().preference).toBe('ja');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
  });

  it('renders nothing inside the desktop app, where the pages it links to do not exist', () => {
    vi.stubGlobal('window', { ...window, __TAURI_INTERNALS__: {} });
    const rendered = render();
    expect(rendered.textContent).toBe('');
  });
});
