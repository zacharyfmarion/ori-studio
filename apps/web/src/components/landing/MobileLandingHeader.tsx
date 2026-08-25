import { useTranslation } from 'react-i18next';
import { StartFigure } from '../start/StartFigure';

const publicAssetBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/**
 * A 256px copy of the app icon, not `favicon.png`.
 *
 * The favicon is a 1024px PNG weighing 2.2MB — fine as a tab icon a browser
 * fetches once and scales to 16px, absurd as a 56px image on the page. This is
 * 18K.
 */
const appIconSrc = `${publicAssetBase}landing/app-icon.webp`;

export interface MobileLandingHeaderProps {
  /** Go to the app. The caller decides which workspace that means. */
  onOpenApp: () => void;
}

/**
 * The phone's page header: a way into the app, and the masthead the landing
 * needs before it starts making its case.
 *
 * This replaced a full-screen "Desktop only, for now" notice, and then the
 * caveat that succeeded it — the button used to read "Open App (unoptimized on
 * mobile)" and set a persisted override. Both are gone: a phone opens the app
 * like anything else, and the button is a way in rather than a warning to click
 * past. The header stays because the desktop start screen is a full-height hero
 * with a 3D figure and three cards beside it, which is several screenfuls on a
 * 375px display before the page has said what it is.
 *
 * The brand block earns its place separately. Without it the page opened on
 * "WHAT IT IS" with nothing having said *what* it is, and there was no `h1` on
 * the phone at all — the sections are all `h2`, so the document outline started
 * a level down.
 *
 * The folded figure closes the header, under the masthead rather than above it.
 * It is the only origami above the fold and the reason the header is laid out
 * as a column bounded to the screen — but it reads as the header's payoff, not
 * its opening: a figure before the wordmark is a picture of nothing in
 * particular, since the reader does not yet know what they are looking at. It
 * is the same component the desktop start screen uses, so a phone gets the real
 * turning figure and not a screenshot of one.
 */
export function MobileLandingHeader({ onOpenApp }: MobileLandingHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="welcome-mobile-header">
      <div className="welcome-mobile-header__bar">
        <button
          type="button"
          className="welcome-mobile-header__open"
          onClick={onOpenApp}
        >
          {t('landing:openApp', 'Open App')}
        </button>
      </div>

      <div className="welcome-mobile-header__brand">
        <img
          className="welcome-mobile-header__icon"
          src={appIconSrc}
          // Decorative: the wordmark right beside it already says the name, so
          // announcing it again would just be the same word twice.
          alt=""
          width={56}
          height={56}
          decoding="async"
        />
        {/* eslint-disable-next-line i18next/no-literal-string -- brand name, never translated */}
        <h1 className="welcome-mobile-header__title">Ori Studio</h1>
        <p className="welcome-mobile-header__tagline">
          {t(
            'landing:mobileHero.tagline',
            'Design, edit and fold origami, all in the browser.'
          )}
        </p>
      </div>

      <div className="welcome-mobile-header__figure">
        <StartFigure />
      </div>
    </header>
  );
}
