import { useEffect } from 'react';
import i18n from '../i18n';
import { resolveLanguage } from '../i18n/locales';
import { useLocaleStore } from '../store/localeStore';

/**
 * Show the UI in `locale` while the route is mounted, whatever the stored preference says.
 *
 * An override, not a preference. `/zh-CN/download/` has to render Chinese for Bing's render
 * pass to see the same words the prerender wrote — the crawlers all send English, so
 * "follow the browser" would show them English DOM over Chinese HTML, the same class of
 * mismatch that had the landing indexed as "Untitled". But an English-system reader who
 * followed a link there out of curiosity must not have Chinese pinned forever: the
 * preference is left alone, and the language it resolves to comes back the moment the
 * route unmounts — which includes "Open the app", since the app routes take no prefix.
 *
 * `localeStore` listens for the change and keeps `<html lang>` and its `locale` field in
 * step, as it does for any language change; only `preference` stays as it was.
 */
export function useRouteLocale(locale: string): void {
  useEffect(() => {
    void i18n.changeLanguage(locale);
    return () => {
      void i18n.changeLanguage(resolveLanguage(useLocaleStore.getState().preference));
    };
  }, [locale]);
}
