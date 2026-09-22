import i18n from '../i18n';
import { I18N_NAMESPACES } from '../i18n/locales';

/**
 * Make a language change resolve at once under jsdom, with no catalogs.
 *
 * The app's i18n carries an HTTP backend, and `changeLanguage` waits for it to fetch
 * every namespace of the new language (and of the fallback). Under jsdom that request
 * never resolves quickly — there is no server, and the backend does not read a stubbed
 * `fetch` — so a test that awaits the change waits out a timeout instead. The connector
 * skips any `language × namespace` it already holds, so seeding an empty bundle for each
 * leaves it nothing to load. Keys then resolve to their inline English defaults, exactly
 * as they do in the app before a catalog arrives; a test that wants a translated value
 * adds it with `i18n.addResourceBundle` after this.
 */
export function preloadLocale(...locales: string[]): void {
  for (const locale of [...locales, 'en']) {
    for (const ns of I18N_NAMESPACES) {
      if (!i18n.hasResourceBundle(locale, ns)) i18n.addResourceBundle(locale, ns, {}, true, false);
    }
  }
}
