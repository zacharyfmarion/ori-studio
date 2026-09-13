import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { buttonClassName } from '../components/ui/Button';
import { EDIT_PATH } from '../routing/paths';
import { SITE_NAME } from '../seo/siteMeta';
import { SiteNav } from './SiteNav';
import { CONTENT_PAGES } from './sitePages';

/**
 * The masthead of a content page: the name, the other pages, and the way into the app.
 *
 * Only on content pages — the landing has the start screen where a masthead would go, and
 * its links live in the footer instead. The call to action goes to Edit rather than back to
 * the landing: someone reading the download page has already been pitched, and the next
 * useful thing is the editor.
 */
export function SiteHeader() {
  const { t } = useTranslation();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-header__brand" to="/">
          {SITE_NAME}
        </Link>
        <SiteNav pages={CONTENT_PAGES} label={t('site:nav.label', 'Site')} />
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
