import i18n from '../i18n';
import { I18N_NAMESPACES } from '../i18n/locales';

/**
 * Make a language change complete synchronously, with no catalogs.
 *
 * `changeLanguage` loads every namespace of the new language (and of the fallback) first.
 * The test setup answers those loads at once, but asynchronously, so a change started
 * inside a synchronous `act` — a click on a language switch — finishes after it. The
 * connector skips any `language × namespace` it already holds, so seeding an empty bundle
 * for each leaves it nothing to load. Keys then resolve to their inline English defaults,
 * exactly as they do in the app before a catalog arrives; a test that wants a translated
 * value adds it with `i18n.addResourceBundle` after this.
 */
export function preloadLocale(...locales: string[]): void {
  for (const locale of [...locales, 'en']) {
    for (const ns of I18N_NAMESPACES) {
      if (!i18n.hasResourceBundle(locale, ns)) i18n.addResourceBundle(locale, ns, {}, true, false);
    }
  }
}
