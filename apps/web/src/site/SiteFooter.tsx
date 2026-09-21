import { useTranslation } from 'react-i18next';
import { DISCORD_URL, RELEASES_URL, REPOSITORY_URL } from '../constants/release';
import { isWebRuntime } from '../platform/runtime';
import { SITE_NAME } from '../seo/siteMeta';
import { ExternalLink } from './ExternalLink';
import { SiteNav } from './SiteNav';
import './site.css';

/**
 * The foot of every site page, the landing included.
 *
 * On the landing this is the only place the other pages are linked from, which makes it
 * load-bearing rather than decorative: it is how a crawler on the homepage finds that a
 * download page exists. See {@link SiteNav}.
 *
 * One line where there is room — the pages, a rule, the places off-site, and the note at
 * the far end — and a stack on a phone.
 *
 * Renders nothing in the desktop app. The site routes are web-only — a download page inside
 * the thing it downloads is nonsense — and the landing there is the start screen, which
 * does not need a footer pointing at pages that do not exist.
 */
export function SiteFooter() {
  const { t } = useTranslation();
  if (!isWebRuntime()) return null;

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <SiteNav label={t('site:nav.label', 'Site')} />
        <ul className="site-footer__links" aria-label={t('site:footer.communityLabel', 'Community')}>
          <li>
            <ExternalLink className="site-nav__link" href={REPOSITORY_URL}>
              {t('site:footer.github', 'GitHub')}
            </ExternalLink>
          </li>
          <li>
            <ExternalLink className="site-nav__link" href={DISCORD_URL}>
              {t('site:footer.discord', 'Discord')}
            </ExternalLink>
          </li>
          <li>
            <ExternalLink className="site-nav__link" href={RELEASES_URL}>
              {t('site:footer.releases', 'Releases')}
            </ExternalLink>
          </li>
        </ul>
        <p className="site-footer__note">
          {t('site:footer.note', '{{name}} is free and open source.', { name: SITE_NAME })}
        </p>
      </div>
    </footer>
  );
}
