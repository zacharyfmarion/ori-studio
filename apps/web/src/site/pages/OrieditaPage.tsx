import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { buttonClassName } from '../../components/ui/Button';
import { EDIT_PATH } from '../../routing/paths';
import { ExternalLink } from '../ExternalLink';
import { SiteArticleHead, SiteSection } from '../SiteArticle';
import { SiteLayout } from '../SiteLayout';
import { CONTENT_PAGES, pagePath } from '../sitePages';
import { useSitePage } from '../useSitePage';

const ORIEDITA_URL = 'https://oriedita.github.io/';
const DOWNLOAD = CONTENT_PAGES.find((page) => page.id === 'download');

/**
 * `/oriedita/` — the page for "oriedita online" and "oriedita in the browser".
 *
 * The SEO plan named that query as one with demand and no good answer, and it is a true
 * claim: the crease-pattern editor is a port of Oriedita (`crates/oristudio-cp*`, tested
 * against the Java oracle), and `.ori`/`.orh` go both ways. The keyboard section is
 * `docs/coming-from-oriedita.md`, condensed; the caveats are that document's, not softened.
 *
 * Careful with the word "same". It says what carried over and what did not, and it does
 * not claim every Oriedita action has a counterpart — the import dialog itself lists the
 * ones that do not.
 */
export function OrieditaPage() {
  const { t } = useTranslation();
  const { locale } = useSitePage();

  return (
    <SiteLayout>
      <article className="site-article">
        <SiteArticleHead
          eyebrow={t('site:oriedita.eyebrow', 'Compatibility')}
          title={t('site:oriedita.title', 'Oriedita, in your browser')}
          lead={t(
            'site:oriedita.lead',
            'Ori Studio’s crease-pattern editor is a port of Oriedita: its drawing tools, its foldability checks and its file formats, running in a browser tab with nothing to install — or as a desktop app.'
          )}
        >
          <div className="site-actions">
            <Link className={buttonClassName({ variant: 'primary', size: 'lg' })} to={EDIT_PATH}>
              {t('site:oriedita.openEditor', 'Open the editor')}
            </Link>
            {DOWNLOAD && (
              <Link className={buttonClassName({ variant: 'secondary', size: 'lg' })} to={pagePath(DOWNLOAD, locale)}>
                {t('site:oriedita.download', 'Get the desktop app')}
              </Link>
            )}
          </div>
        </SiteArticleHead>

        <SiteSection id="oriedita-carries" title={t('site:oriedita.carries.title', 'What carries over')}>
          <ul className="site-list">
            <li>
              {t(
                'site:oriedita.carries.tools',
                'The editor. Drawing, construction and transform tools are ports of Oriedita’s, checked against the original for the same results.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.carries.checks',
                'The foldability checks: Kawasaki and Maekawa where the paper folds flat, and for creases that do not, a check in three dimensions of whether each vertex closes.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.carries.files',
                'The files. Open any .ori or .orh, and export back to either — a pattern can move between the two programs in both directions.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.carries.keyboard',
                'Your keyboard, if you want it: Oriedita’s shortcuts can be imported from its own settings file.'
              )}
            </li>
          </ul>
        </SiteSection>

        <SiteSection id="oriedita-keyboard" title={t('site:oriedita.keyboard.title', 'Bring your keyboard')}>
          <p>
            {t(
              'site:oriedita.keyboard.lead',
              'Ori Studio’s default layout deliberately differs — the line types sit on the home row, A, S, D and F, where Oriedita uses M, V and L. If your hands know Oriedita, two steps make them work here on day one.'
            )}
          </p>
          <ol className="site-list">
            <li>
              {t(
                'site:oriedita.keyboard.step1',
                'In Oriedita, open Preferences and click Export. Save the .oriconfig file anywhere.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.keyboard.step2',
                'In Ori Studio, open Settings › Shortcuts, click “Import from Oriedita…”, and pick that file. Nothing changes until you have reviewed what the import would do and confirmed it.'
              )}
            </li>
          </ol>
          <p>
            {t(
              'site:oriedita.keyboard.choice',
              'The dialog offers two options. “Match Oriedita’s keyboard” applies Oriedita’s layout plus whatever you customized; “Only my customizations” applies just the hotkeys you changed and keeps Ori Studio’s layout for everything else. Oriedita’s export records only the keys you edited, so if you never changed anything the second option has nothing to apply.'
            )}
          </p>
          <p>
            {t(
              'site:oriedita.keyboard.skipped',
              'The preview lists every shortcut it will not import and why: a key left blank in Oriedita, an action with no counterpart here, or a key another shortcut already answers. Only hotkeys come across — colours, line widths and grid settings stay as they are.'
            )}
          </p>
        </SiteSection>

        <SiteSection id="oriedita-different" title={t('site:oriedita.different.title', 'What is different')}>
          <ul className="site-list">
            <li>
              {t(
                'site:oriedita.different.browser',
                'It runs in the browser. Open a tab and draw; the desktop app is the same editor with native menus and file dialogs.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.different.references',
                'Reference photos and notes live on the canvas beside the pattern, saved with the project — and dropped cleanly when you export to .ori, which has no room for them.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.different.simulate',
                'A fold simulator opens in a window next to the pattern, so checking whether an idea folds does not mean a round trip through another program.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.different.design',
                'A Design workspace alongside the editor: box pleating on a grid and circle packing from a tree, each building a crease pattern you can send straight to Edit.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.different.missing',
                'A few Oriedita actions have no counterpart yet — background images, folded-figure sizing, panel switching among them. The shortcut import names each one it skips.'
              )}
            </li>
          </ul>
        </SiteSection>

        <SiteSection id="oriedita-about" title={t('site:oriedita.about.title', 'About Oriedita')}>
          <p>
            {t(
              'site:oriedita.about.body',
              'Oriedita is a free crease-pattern editor developed by its community, itself a fork of Orihime. Ori Studio’s editor is a Rust and WebAssembly port of it, kept compatible with its files and checked against it for parity. Ori Studio is a separate project and is not affiliated with Oriedita.'
            )}
          </p>
          <p className="site-note">
            <ExternalLink href={ORIEDITA_URL}>{t('site:oriedita.about.link', 'Oriedita’s website')}</ExternalLink>
          </p>
        </SiteSection>
      </article>
    </SiteLayout>
  );
}
