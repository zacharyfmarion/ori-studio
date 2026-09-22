import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DISCORD_URL, RELEASES_URL, REPOSITORY_URL } from '../constants/release';
import { SUPPORTED_LOCALES } from '../i18n/locales';
import { isWebRuntime } from '../platform/runtime';
import { SITE_NAME } from '../seo/siteMeta';
import { useLocaleStore } from '../store/localeStore';
import { ExternalLink } from './ExternalLink';
import { SiteNav } from './SiteNav';
import { pagePath } from './sitePages';
import { useSitePage } from './useSitePage';
import './site.css';

/**
 * The foot of every site page, the landing included.
 *
 * On the landing this is the only place the other pages are linked from, which makes it
 * load-bearing rather than decorative: it is how a crawler on the homepage finds that a
 * download page exists. See {@link SiteNav}.
 *
 * One line where there is room — the pages, a rule, the places off-site, and the note at
 * the far end — and a stack on a phone. Below it, the same page in every other language.
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
        <LanguageSwitch />
      </div>
    </footer>
  );
}

/**
 * This page, in every language the site is served in.
 *
 * Real anchors and every locale by its own name, not a `<select>`: a crawler follows an
 * `href` and cannot operate a control, and this row is how Baidu, Bing and Google learn
 * that `/zh-CN/download/` exists at all. Each anchor carries `hreflang` and `lang`, so a
 * screen reader switches voice for the name and a crawler knows what it is being offered.
 *
 * **Choosing one here pins it**, the way choosing one in Settings does. Two signals reach
 * the language, and they are not the same signal: arriving at `/ja/` — by a search result,
 * a link, a crawl — says nothing about the reader, and `useRouteLocale` shows Japanese
 * only while they are there. Picking 日本語 from a language menu is a choice, and a reader
 * who made it and then opens the app expects the app in Japanese, not in whatever their
 * browser happens to be set to. So the click writes the preference before the navigation
 * lands; the route then overrides to the same language, and leaving restores the
 * preference — which is now the one they chose.
 */
function LanguageSwitch() {
  const { t } = useTranslation();
  const current = useSitePage();
  const setLocale = useLocaleStore((state) => state.setLocale);

  return (
    <nav className="site-languages" aria-label={t('site:footer.languageLabel', 'Language')}>
      <ul className="site-languages__list">
        {SUPPORTED_LOCALES.map((locale) => (
          <li key={locale.code}>
            <Link
              className="site-nav__link"
              to={pagePath(current.page, locale.code)}
              hrefLang={locale.code}
              lang={locale.code}
              aria-current={locale.code === current.locale ? 'true' : undefined}
              onClick={() => setLocale(locale.code)}
            >
              {locale.nativeName}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
