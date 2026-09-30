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
          title={t('site:oriedita.title', 'Coming from Oriedita')}
          lead={t(
            'site:oriedita.lead',
            'Ori Studio’s crease-pattern editor is a port of Oriedita, so it should feel familiar right away. It supports opening and exporting to the .ori format, and we are committed to maintaining interoperability where possible.'
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
                'The editor. Drawing, construction and transform tools are ports of Oriedita’s and behave in almost identical ways. There are some small changes that have been made for the sake of reducing clutter, such as the Extend Line tool’s variants being combined into one tool.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.carries.checks',
                'The foldability checks: Kawasaki, Maekawa, and big-little-big are all checked in the same way. There are a couple of naming differences — in Ori Studio we use the term foldability instead of CAMV.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.carries.files',
                'The files. Open any .ori or .orh, and export back to either — a crease pattern can move between the two programs in both directions.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.carries.keyboard',
                'Your keyboard, if you want it: Oriedita’s shortcuts can be imported into Ori Studio.'
              )}
            </li>
          </ul>
        </SiteSection>

        <SiteSection id="oriedita-keyboard" title={t('site:oriedita.keyboard.title', 'Bring your keyboard')}>
          <p>
            {t(
              'site:oriedita.keyboard.lead',
              'Ori Studio’s default layout deliberately differs — the line types sit on the home row, A, S, D and F, where Oriedita uses M, V and L. If your hands know Oriedita, you can switch to using Oriedita defaults in Settings › Shortcuts.'
            )}
          </p>
          <p>
            {t(
              'site:oriedita.keyboard.import',
              'You can also import your saved keyboard shortcuts from Oriedita by exporting them from Preferences, and importing them in Ori Studio from Settings › Shortcuts.'
            )}
          </p>
        </SiteSection>

        <SiteSection id="oriedita-different" title={t('site:oriedita.different.title', 'What is different')}>
          <ul className="site-list">
            <li>
              {t(
                'site:oriedita.different.browser',
                'It can run in the browser. Ori Studio was built around modern web tooling and can run entirely in a tab. You can also download it as a native app if you prefer on all platforms.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.different.references',
                '3D Support. Thanks to the support of Brandon Wong (@theplantpsychologist on Instagram), Ori Studio has native support for non-flat creases, meaning you can both create and compute the folded form of crease patterns that are not flat foldable.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.different.simulate',
                'You can select a crease pattern and simulate it inline to quickly check how it will fold.'
              )}
            </li>
            <li>
              {t(
                'site:oriedita.different.design',
                'Additional workspaces: In addition to the edit workspace, Ori Studio offers multiple other workspaces that act on crease patterns — design, simulate, and references. All of these workspaces are based on amazing open source tools built by the community. Bringing them all together in one place allows for them all to work together without having to context switch.'
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
