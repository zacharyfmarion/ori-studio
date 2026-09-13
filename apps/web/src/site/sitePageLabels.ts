import type { TFunction } from 'i18next';
import type { SitePageId } from './sitePages';

/**
 * A page's name in the nav.
 *
 * A switch of literal `t()` calls rather than a `label` field on the registry, because the
 * i18next parser only sees calls whose key and default are literals: a table keyed by id —
 * the obvious shape — would extract nothing, and the English catalog would silently lose
 * these strings. Same reason `desktopBuildLabels.ts` is written this way.
 *
 * Short, because they are also what a search result's sitelinks would be labelled with if
 * Google chose to show any, and a sitelink is one or two words.
 */
export function sitePageLabel(t: TFunction, id: SitePageId): string {
  switch (id) {
    case 'landing':
      return t('site:nav.home', 'Home');
    case 'download':
      return t('site:nav.download', 'Download');
  }
}
