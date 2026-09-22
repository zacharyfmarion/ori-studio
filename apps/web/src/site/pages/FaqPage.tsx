import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DISCORD_URL, ISSUES_URL } from '../../constants/release';
import { ExternalLink } from '../ExternalLink';
import { SiteArticleHead } from '../SiteArticle';
import { SiteLayout } from '../SiteLayout';
import { CONTENT_PAGES, pagePath } from '../sitePages';
import { useSitePage } from '../useSitePage';

const ORIEDITA = CONTENT_PAGES.find((page) => page.id === 'oriedita');
const DOWNLOAD = CONTENT_PAGES.find((page) => page.id === 'download');

/** One question. The heading is the question, so a searcher's own words are in an `<h2>`. */
function Question({ id, question, children }: { id: string; question: string; children: ReactNode }) {
  return (
    <section className="site-section site-faq" aria-labelledby={`${id}-title`}>
      <h2 className="site-heading site-faq__question" id={`${id}-title`}>
        {question}
      </h2>
      {children}
    </section>
  );
}

/**
 * `/faq/` — the questions a first visit raises, answered from the code.
 *
 * Every answer here is checkable against the app: the formats are the ones the landing's
 * ring lists and the importers accept, saving is what `fileService` does on each surface,
 * offline is the service worker, the privacy answer is `docs/analytics.md`'s contract,
 * and the licence is `LICENSING.md`. Nothing is promised that a reader could not verify.
 *
 * The set was drawn from the product and the issue tracker rather than a community
 * transcript — Discord was not readable from here — so it is the questions a product like
 * this predictably raises, not a tally of the ones actually asked. That is the thing to
 * revisit once Search Console and the Discord say which ones people bring.
 */
export function FaqPage() {
  const { t } = useTranslation();
  const { locale } = useSitePage();

  return (
    <SiteLayout>
      <article className="site-article">
        <SiteArticleHead
          eyebrow={t('site:faq.eyebrow', 'FAQ')}
          title={t('site:faq.title', 'Frequently asked questions')}
          lead={t(
            'site:faq.lead',
            'What Ori Studio is, what it opens, where your work goes, and what it does and does not collect.'
          )}
        />

        <Question id="faq-free" question={t('site:faq.free.q', 'Is Ori Studio free?')}>
          <p>
            {t(
              'site:faq.free.a',
              'Yes. It is free to use and open source under the GPL, with no account and no paid tier. The source is on GitHub. Anything you design with it is yours — the licence covers the software, not what you make.'
            )}
          </p>
        </Question>

        <Question id="faq-install" question={t('site:faq.install.q', 'Do I need to install anything?')}>
          <p>
            {t(
              'site:faq.install.a',
              'No. It runs in your browser. If you would rather have it as an application of its own, there is a desktop app for macOS, Windows and Linux — the same workspace with native menus, file dialogs and automatic updates.'
            )}{' '}
            {DOWNLOAD && (
              <Link className="site-inline-link" to={pagePath(DOWNLOAD, locale)}>
                {t('site:faq.install.link', 'Download the desktop app')}
              </Link>
            )}
          </p>
        </Question>

        <Question id="faq-offline" question={t('site:faq.offline.q', 'Does it work offline?')}>
          <p>
            {t(
              'site:faq.offline.a',
              'After the first load, yes. The app keeps a copy of itself in the browser and starts without a connection; your files are on your computer either way. The ExplOri search and the desktop app’s update check are the parts that need the network.'
            )}
          </p>
        </Question>

        <Question id="faq-files" question={t('site:faq.files.q', 'What files can I open and export?')}>
          <p>
            {t(
              'site:faq.files.open',
              'It opens Ori Studio projects (.osf) and imports .cp, .fold, .ori and .orh crease patterns, TreeMaker files (.tmd, .tmd4, .tmd5) and Box Pleating Studio files (.bps).'
            )}
          </p>
          <p>
            {t(
              'site:faq.files.export',
              'It exports .cp, .fold, .ori, .orh, .tmd4, .tmd5 and .bps, and renders a crease pattern to SVG or PNG. A format that has no room for something — the reference photos, the notes — simply leaves it out.'
            )}
          </p>
        </Question>

        <Question id="faq-saving" question={t('site:faq.saving.q', 'Where is my work saved?')}>
          <p>
            {t(
              'site:faq.saving.a',
              'On your computer, as an .osf file, and nowhere else — there is no server holding your crease patterns. In Chrome and Edge, Save writes back into the file you opened; in other browsers each Save downloads a fresh copy. The desktop app uses the ordinary file dialogs.'
            )}
          </p>
        </Question>

        <Question id="faq-oriedita" question={t('site:faq.oriedita.q', 'Is this Oriedita?')}>
          <p>
            {t(
              'site:faq.oriedita.a',
              'The crease-pattern editor is a port of Oriedita — the same tools and checks, the same .ori files, running in a browser. Ori Studio adds a design workspace, a simulator, and references on the canvas around it, and it is a separate project.'
            )}{' '}
            {ORIEDITA && (
              <Link className="site-inline-link" to={pagePath(ORIEDITA, locale)}>
                {t('site:faq.oriedita.link', 'What carries over from Oriedita')}
              </Link>
            )}
          </p>
        </Question>

        <Question id="faq-ports" question={t('site:faq.ports.q', 'How does it relate to TreeMaker and Box Pleating Studio?')}>
          <p>
            {t(
              'site:faq.ports.a',
              'The Design workspace’s circle packing is a port of Robert J. Lang’s TreeMaker 5.0.1, and its box pleating is a port of Mu-Tsun Tsai’s Box Pleating Studio. Both are checked against the originals, and both read and write the originals’ files, so a design can move between the programs.'
            )}
          </p>
        </Question>

        <Question id="faq-mobile" question={t('site:faq.mobile.q', 'Does it work on a phone or a tablet?')}>
          <p>
            {t(
              'site:faq.mobile.a',
              'Yes — every workspace opens on a phone, and you can add it to your home screen. Drawing a crease pattern is still more comfortable on a laptop.'
            )}
          </p>
        </Question>

        <Question id="faq-privacy" question={t('site:faq.privacy.q', 'What does it collect?')}>
          <p>
            {t(
              'site:faq.privacy.a',
              'Anonymous usage counts and crash reports, so we can tell which tools get used and what breaks — never your files, your crease patterns, their geometry or your images. You can switch it off under Settings › Privacy, and the app works exactly the same either way.'
            )}
          </p>
        </Question>

        <Question id="faq-help" question={t('site:faq.help.q', 'Where do I ask a question or report a bug?')}>
          <p>
            {t(
              'site:faq.help.a',
              'The best place to report issues or request features is the Ori Studio Discord.'
            )}
          </p>
          <p className="site-note">
            <ExternalLink href={ISSUES_URL}>{t('site:faq.help.issues', 'Report a bug on GitHub')}</ExternalLink>
            {' · '}
            <ExternalLink href={DISCORD_URL}>{t('site:faq.help.discord', 'Join the Discord')}</ExternalLink>
          </p>
        </Question>
      </article>
    </SiteLayout>
  );
}
