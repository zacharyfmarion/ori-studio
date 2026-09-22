import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { buttonClassName } from '../../components/ui/Button';
import { EDIT_PATH } from '../../routing/paths';
import { SiteArticleHead, SiteSection } from '../SiteArticle';
import { SiteLayout } from '../SiteLayout';
import { CONTENT_PAGES, pagePath } from '../sitePages';
import { useSitePage } from '../useSitePage';

const DOWNLOAD = CONTENT_PAGES.find((page) => page.id === 'download');
const ORIEDITA = CONTENT_PAGES.find((page) => page.id === 'oriedita');
const FAQ = CONTENT_PAGES.find((page) => page.id === 'faq');

/**
 * `/getting-started/` — from opening the app to a crease pattern you can fold.
 *
 * Written from what the app actually does: the three actions on the start screen, the
 * three workspaces, the formats the landing's ring lists, and how `fileService` saves on
 * each surface. Nothing here describes a feature the reader cannot find in the app, and
 * the UI labels it names are the same `t()` strings the app renders, so the guide and the
 * interface cannot disagree in any language.
 */
export function GettingStartedPage() {
  const { t } = useTranslation();
  const { locale } = useSitePage();

  return (
    <SiteLayout>
      <article className="site-article">
        <SiteArticleHead
          eyebrow={t('site:gettingStarted.eyebrow', 'Guide')}
          title={t('site:gettingStarted.title', 'Getting started')}
          lead={t(
            'site:gettingStarted.lead',
            'Ori Studio runs in your browser, with no account and nothing to install. This is the shortest path from opening it to a crease pattern you can fold.'
          )}
        >
          <div className="site-actions">
            <Link className={buttonClassName({ variant: 'primary', size: 'lg' })} to={EDIT_PATH}>
              {t('site:gettingStarted.openApp', 'Open Ori Studio')}
            </Link>
            {DOWNLOAD && (
              <Link className={buttonClassName({ variant: 'secondary', size: 'lg' })} to={pagePath(DOWNLOAD, locale)}>
                {t('site:gettingStarted.download', 'Or install the desktop app')}
              </Link>
            )}
          </div>
        </SiteArticleHead>

        <SiteSection id="start-ways" title={t('site:gettingStarted.ways.title', 'Three ways in')}>
          <p>
            {t(
              'site:gettingStarted.ways.lead',
              'The start screen offers three actions. Which one you want depends on whether you already know the crease pattern.'
            )}
          </p>
          <dl className="site-definitions">
            <dt>{t('dialogs:startScreen.createCp.title', 'Create a CP')}</dt>
            <dd>
              {t(
                'site:gettingStarted.ways.createCp',
                'A blank, editable crease pattern with the drawing tools ready. For when you know the pattern and want to draw it.'
              )}
            </dd>
            <dt>{t('dialogs:startScreen.openFile.title', 'Open a file')}</dt>
            <dd>
              {t(
                'site:gettingStarted.ways.openFile',
                'An Ori Studio project (.osf), or a file from another tool — .cp, .fold, .ori, .orh, .bps, or a TreeMaker .tmd. Dropping a file anywhere on the page does the same.'
              )}
            </dd>
            <dt>{t('dialogs:startScreen.createDesign.title', 'Create a design')}</dt>
            <dd>
              {t(
                'site:gettingStarted.ways.createDesign',
                'For when you know the subject but not yet the pattern. Sketch its structure as a tree and let circle packing find a base, or lay flaps out on a box-pleating grid; either way the crease pattern is built for you.'
              )}
            </dd>
          </dl>
        </SiteSection>

        <SiteSection id="start-workspaces" title={t('site:gettingStarted.workspaces.title', 'The three workspaces')}>
          <dl className="site-definitions">
            <dt>{t('common:workspaceRail.tabEdit', 'Edit')}</dt>
            <dd>
              {t(
                'site:gettingStarted.workspaces.edit',
                'The crease-pattern editor, a port of Oriedita. Draw with construction and transform tools snapped to the grid and to angles, see foldability problems the moment you make them, and keep reference photos, notes and a folded preview on the same canvas.'
              )}
            </dd>
            <dt>{t('common:workspaceRail.tabDesign', 'Design')}</dt>
            <dd>
              {t(
                'site:gettingStarted.workspaces.design',
                'Where a model is packed before it is drawn: box pleating on a grid, circle packing from a tree, or a search of ExplOri’s archive of 22.5° patterns. Several designs stay open in tabs, and each one can send its crease pattern to Edit.'
              )}
            </dd>
            <dt>{t('common:workspaceRail.tabSimulate', 'Simulate')}</dt>
            <dd>
              {t(
                'site:gettingStarted.workspaces.simulate',
                'Folds the pattern into a 3D model you can turn and inspect, using a port of Origami Simulator. A simulation also opens in a window beside the pattern you are drawing, so checking an idea costs a glance.'
              )}
            </dd>
          </dl>
        </SiteSection>

        <SiteSection id="start-saving" title={t('site:gettingStarted.saving.title', 'Saving your work')}>
          <p>
            {t(
              'site:gettingStarted.saving.project',
              'An Ori Studio project is an .osf file. It holds everything: the crease pattern, the reference images and notes beside it, and every design tab. Nothing is stored on a server — the file is on your computer.'
            )}
          </p>
          <p>
            {t(
              'site:gettingStarted.saving.browser',
              'In the browser, Chrome and Edge write Save back into the file you opened; other browsers download a fresh copy each time. The desktop app uses the ordinary file dialogs.'
            )}
          </p>
          <p>
            {t(
              'site:gettingStarted.saving.export',
              'To hand a pattern to another program, export it as .cp, .fold, .ori or .orh, or as an SVG or PNG. Anything those formats have no room for — the photos, the notes — is left out cleanly rather than corrupting the file.'
            )}
          </p>
        </SiteSection>

        <SiteSection id="start-keyboard" title={t('site:gettingStarted.keyboard.title', 'The keyboard')}>
          <p>
            {t(
              'site:gettingStarted.keyboard.layout',
              'The editor is built to be driven from the keyboard. Line types sit on the home row — A, S, D and F — and every tool has a shortcut you can change under Settings › Shortcuts.'
            )}
          </p>
          {ORIEDITA && (
            <p>
              {t(
                'site:gettingStarted.keyboard.oriedita',
                'Coming from Oriedita? You can import the shortcuts you are used to from its settings file, so your hands work on day one.'
              )}{' '}
              <Link className="site-inline-link" to={pagePath(ORIEDITA, locale)}>
                {t('site:gettingStarted.keyboard.orieditaLink', 'How to bring your Oriedita keyboard')}
              </Link>
            </p>
          )}
        </SiteSection>

        <SiteSection id="start-anywhere" title={t('site:gettingStarted.anywhere.title', 'Anywhere, and offline')}>
          <p>
            {t(
              'site:gettingStarted.anywhere.body',
              'Every workspace opens on a phone or a tablet, though a laptop is more comfortable for drawing. After the first load the app keeps a copy of itself, so it starts without a connection. If you would rather have it as an application of its own, there is a desktop build for macOS, Windows and Linux.'
            )}
          </p>
          {FAQ && (
            <p className="site-note">
              <Link className="site-inline-link" to={pagePath(FAQ, locale)}>
                {t('site:gettingStarted.faqLink', 'More questions are answered in the FAQ')}
              </Link>
            </p>
          )}
        </SiteSection>
      </article>
    </SiteLayout>
  );
}
