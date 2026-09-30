import { useLocation } from 'react-router-dom';
import { DEFAULT_LOCALE } from '../i18n/locales';
import { LANDING_PAGE, sitePageForPath, type SitePageMatch } from './sitePages';

/**
 * Which page and locale the current URL is, for the chrome that has to link relative to
 * it. Off a site page — the footer is also rendered by `WelcomeRoute`, which can only be
 * on one, but this keeps the answer total — it reads as the English landing.
 */
export function useSitePage(): SitePageMatch {
  return sitePageForPath(useLocation().pathname) ?? { page: LANDING_PAGE, locale: DEFAULT_LOCALE };
}
