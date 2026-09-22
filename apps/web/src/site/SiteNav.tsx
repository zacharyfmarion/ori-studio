import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { sitePageLabel } from './sitePageLabels';
import { pagePath, SITE_PAGES, type SitePage } from './sitePages';
import { useSitePage } from './useSitePage';
import './site.css';

/**
 * Links to every page of the site, in registry order, in the current locale.
 *
 * This is the part of the site work that a search engine actually needs. Sitelinks — the
 * sub-links under a result — are chosen from pages a crawler can reach and label, and a
 * page that exists but is linked from nowhere is one it has little reason to surface. So
 * the nav is not chrome; it is the thing that makes the other pages findable, and it
 * renders into the crawler copy of every page as well as the live one.
 *
 * `Link`, not `<a>`: the site and the app are one bundle, and a click between two site
 * pages should not reboot it.
 */
export function SiteNav({ pages = SITE_PAGES, label }: { pages?: readonly SitePage[]; label: string }) {
  const { t } = useTranslation();
  const current = useSitePage();

  return (
    <nav className="site-nav" aria-label={label}>
      <ul className="site-nav__list">
        {pages.map((page) => (
          <li key={page.id}>
            <Link
              className="site-nav__link"
              to={pagePath(page, current.locale)}
              aria-current={page === current.page ? 'page' : undefined}
            >
              {sitePageLabel(t, page.id)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
