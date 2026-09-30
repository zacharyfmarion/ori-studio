import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { WelcomePage } from '../components/landing/WelcomePage';
import { sitePageTitle } from '../site/sitePageLabels';

/**
 * The standard accessible-hiding pattern, inline rather than as a global class.
 *
 * Inline because this is the only node in the app that needs it and the whole subtree is
 * removed before React mounts — a utility class in `index.css` would outlive its only
 * caller. Clip-based, never `display: none`: this is the form crawlers treat as ordinary
 * content and screen readers still announce.
 */
const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

const ignore = () => undefined;

/**
 * The landing page as a crawler receives it, and as a first visit first paints it.
 *
 * It renders {@link WelcomePage} — the *same* component `WelcomeRoute` renders — in the
 * state the live page opens in, so the prerendered HTML and the React page cannot describe
 * the product differently, and so the copy can stand in for the live page until the app
 * takes over (`staticPaint.ts`). That is the whole reason this is a composition rather than
 * a second copy of the page, and it is the discipline `functions/_lib/cpShareHtml.ts`
 * already follows by importing `shareCardText` instead of restating it.
 *
 * The one thing it adds is an `<h1>` naming the site, first in the document. The start
 * screen's own `<h1>` ("Start a new origami workspace") heads a control panel rather than
 * describing the page, and a crawler reading bytes should not have to guess what the page is
 * about. It is visually hidden, so it takes no part in the first paint.
 */
export function StaticLanding() {
  const { t } = useTranslation();
  return (
    <>
      <h1 style={visuallyHidden}>{sitePageTitle(t, 'landing')}</h1>
      <WelcomePage
        preparing={false}
        errorMessage={null}
        showWelcomeOnStartup
        onCreateCreasePattern={ignore}
        onCreateDesign={ignore}
        onOpenFile={ignore}
        onToggleShowWelcomeOnStartup={ignore}
      />
    </>
  );
}
