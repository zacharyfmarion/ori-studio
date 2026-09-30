import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { useLocaleStore } from '../store/localeStore';
import { preloadLocale } from '../test/preloadLocale';
import { useRouteLocale } from './useRouteLocale';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe({ locale }: { locale: string }) {
  useRouteLocale(locale);
  return null;
}

async function mount(locale: string) {
  container ??= document.createElement('div');
  document.body.append(container);
  root ??= createRoot(container);
  await act(async () => root?.render(<Probe locale={locale} />));
}

beforeEach(async () => {
  localStorage.clear();
  preloadLocale('zh-CN', 'ja', 'fr', 'de', 'ko');
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

/**
 * The route decides the language while it is mounted, and only while. Both halves
 * matter for search: Bing renders `/zh-CN/download/` and has to see Chinese whatever the
 * bot's stored preference is (none), and an English reader who followed the link must not
 * leave with Chinese pinned.
 */
describe('useRouteLocale', () => {
  it('shows the route’s language while mounted, whatever the preference', async () => {
    expect(useLocaleStore.getState().preference).toBe('system');
    await mount('zh-CN');
    expect(i18n.language).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('does not touch the stored preference', async () => {
    const before = useLocaleStore.getState().preference;
    await mount('ja');
    expect(useLocaleStore.getState().preference).toBe(before);
    expect(localStorage.length).toBe(0);
  });

  it('restores the preference’s language on unmount', async () => {
    await mount('fr');
    expect(i18n.language).toBe('fr');
    await act(async () => root?.unmount());
    root = null;
    // The preference is "system", and the test browser is English.
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('follows a change of route locale', async () => {
    await mount('de');
    expect(i18n.language).toBe('de');
    await mount('ko');
    expect(i18n.language).toBe('ko');
  });
});
