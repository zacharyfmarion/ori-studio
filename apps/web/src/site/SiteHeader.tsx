import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { buttonClassName } from '../components/ui/Button';
import { EDIT_PATH } from '../routing/paths';
import { SITE_NAME } from '../seo/siteMeta';

/**
 * The masthead of a content page: the name, and the way into the app.
 *
 * No page nav. The footer carries the site's links on every page, landing included, and
 * that is the copy a crawler needs; a second list up here was the page you are on, next to
 * the name of the site, which read as a breadcrumb that went nowhere. The call to action
 * goes to Edit rather than back to the landing: someone reading the download page has
 * already been pitched, and the next useful thing is the editor.
 */
export function SiteHeader() {
  const { t } = useTranslation();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-header__brand" to="/">
          {SITE_NAME}
        </Link>
        <Link
          className={buttonClassName({ variant: 'primary', size: 'sm', className: 'site-header__cta' })}
          to={EDIT_PATH}
        >
          {t('site:header.openApp', 'Open the app')}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
