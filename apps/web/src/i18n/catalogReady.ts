import i18n from './index';
import { DEFAULT_NAMESPACE } from './locales';

/**
 * Resolves once the `common` catalog for the current language is in the store,
 * and no later than `limitMs` if it never comes.
 *
 * For the one moment a default name is chosen before a catalog can be relied
 * on. Every `t()` falls back to its inline English while the catalog is still
 * in flight, which is right for a label that re-renders when it lands — and
 * wrong for a name that is written into a document at that moment and kept. A
 * cold `/edit` is the case: it provisions its blank crease pattern as soon as
 * the wasm worker is up, and the catalog `i18n.init()` fetched is racing the
 * worker. On a warm start the bundle is already here and this resolves at
 * once. The wait is bounded because a catalog that never arrives must not hold
 * the canvas hostage; the name is then the English it always was.
 */
export function whenCatalogReady(limitMs = 2000): Promise<void> {
  const ready = () => i18n.hasResourceBundle(i18n.language, DEFAULT_NAMESPACE);
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      i18n.store.off('added', check);
      i18n.off('languageChanged', check);
      resolve();
    };
    const check = () => {
      if (ready()) finish();
    };
    const timer = setTimeout(finish, limitMs);
    // `added` is what the backend fires into the store as each catalog lands;
    // a language switch mid-wait may land on one that is already here.
    i18n.store.on('added', check);
    i18n.on('languageChanged', check);
  });
}
