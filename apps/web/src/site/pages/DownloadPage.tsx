import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DesktopDownloadButton } from '../../components/download/DesktopDownloadButton';
import { buttonClassName } from '../../components/ui/Button';
import { RELEASES_URL } from '../../constants/release';
import { useDesktopDownloads } from '../../platform/useDesktopDownloads';
import { EDIT_PATH } from '../../routing/paths';
import { SiteLayout } from '../SiteLayout';
import { DesktopBuildList } from './DesktopBuildList';

/**
 * `/download/` — the desktop app, and every build of it.
 *
 * The first page after the landing, and deliberately the shortest: a handful of links and
 * the notes a visitor needs to pick between them. It is what proved the site plumbing —
 * the registry, the per-page prerender, the routes — before the prose-heavy pages
 * committed eight locales of text to it.
 *
 * Every claim about what the desktop app does is grounded in the shell's config: the
 * `.osf` file association and the updater endpoint are both in `tauri.conf.json`, and the
 * menus and dialogs are what `apps/tauri` exists to own. It says nothing about system
 * requirements, because nothing in the repo states them and a guess on a download page is
 * a support ticket.
 */
export function DownloadPage() {
  const { t } = useTranslation();
  const { version } = useDesktopDownloads();

  return (
    <SiteLayout>
      <article className="site-article">
        <header className="site-article__head">
          <span className="site-eyebrow">{t('site:download.eyebrow', 'Desktop app')}</span>
          <h1 className="site-title">{t('site:download.title', 'Download Ori Studio')}</h1>
          <p className="site-lead">
            {t(
              'site:download.lead',
              'Ori Studio runs in your browser with nothing to install. The desktop app is the same workspace, packaged for macOS, Windows and Linux — with native menus and file dialogs, projects that open straight from Finder or Explorer, and updates that install themselves.'
            )}
          </p>
          <div className="site-actions">
            <DesktopDownloadButton surface="download-page" />
            <Link className={buttonClassName({ variant: 'secondary', size: 'lg' })} to={EDIT_PATH}>
              {t('site:download.openInBrowser', 'Or open it in your browser')}
            </Link>
          </div>
          {version && (
            <p className="site-note">
              {t('site:download.latest', 'Latest release: {{version}}', { version })}
            </p>
          )}
        </header>

        <section className="site-section site-section--wide" aria-labelledby="download-builds-title">
          <h2 className="site-heading" id="download-builds-title">
            {t('site:download.builds.title', 'Every build')}
          </h2>
          <p>
            {t(
              'site:download.builds.lead',
              'One file per platform and architecture, published on GitHub Releases.'
            )}
          </p>
          <DesktopBuildList surface="download-page" />
          <p className="site-note">
            <a href={RELEASES_URL} rel="noreferrer">
              {t('site:download.builds.allReleases', 'All releases, with their notes, on GitHub')}
            </a>
          </p>
        </section>

        <section className="site-section" aria-labelledby="download-which-title">
          <h2 className="site-heading" id="download-which-title">
            {t('site:download.which.title', 'Which build?')}
          </h2>
          <dl className="site-definitions">
            <dt>{t('site:download.which.macTerm', 'macOS')}</dt>
            <dd>
              {t(
                'site:download.which.macBody',
                'Apple Silicon for any Mac with an M-series chip; Intel for the ones before. The download button picks Apple Silicon by default, because a browser cannot tell the two apart.'
              )}
            </dd>
            <dt>{t('site:download.which.windowsTerm', 'Windows')}</dt>
            <dd>
              {t('site:download.which.windowsBody', 'One installer, for 64-bit Windows.')}
            </dd>
            <dt>{t('site:download.which.linuxTerm', 'Linux')}</dt>
            <dd>
              {t(
                'site:download.which.linuxBody',
                'The .deb installs on Debian and Ubuntu and their relatives. The AppImage runs anywhere without installing: make it executable and launch it.'
              )}
            </dd>
          </dl>
        </section>

        <section className="site-section" aria-labelledby="download-desktop-title">
          <h2 className="site-heading" id="download-desktop-title">
            {t('site:download.desktop.title', 'What the desktop app adds')}
          </h2>
          <ul className="site-list">
            <li>
              {t(
                'site:download.desktop.menus',
                'Native menus and file dialogs, so opening and saving feel like every other app on your machine.'
              )}
            </li>
            <li>
              {t(
                'site:download.desktop.files',
                'Ori Studio projects (.osf) open straight from Finder or Explorer.'
              )}
            </li>
            <li>
              {t(
                'site:download.desktop.updates',
                'It checks for new releases and installs them itself.'
              )}
            </li>
            <li>
              {t(
                'site:download.desktop.same',
                'Everything else is identical. Files move between the two freely, and there is nothing the desktop app can do that the browser cannot.'
              )}
            </li>
          </ul>
        </section>
      </article>
    </SiteLayout>
  );
}
