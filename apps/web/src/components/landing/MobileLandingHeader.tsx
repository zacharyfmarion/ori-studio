import { useTranslation } from 'react-i18next';

export interface MobileLandingHeaderProps {
  /** Take the escape hatch: the caller opens the gate and lets the app load. */
  onOpenAnyway: () => void;
}

/**
 * The phone's page header: a way into the app, and the masthead the landing
 * needs before it starts making its case.
 *
 * This replaced a full-screen "Desktop only, for now" notice. That notice was
 * honest and spent every pixel above the fold being so, pushing what someone
 * came to read out of sight — on a page whose entire job is the part below. The
 * caveat now rides in the button's label, which is where the decision gets made
 * and says the same thing the two paragraphs did.
 *
 * The brand block earns its place separately. Without it the page opened on
 * "WHAT IT IS" with nothing having said *what* it is, and there was no `h1` on
 * the phone at all — the sections are all `h2`, so the document outline started
 * a level down.
 */
export function MobileLandingHeader({ onOpenAnyway }: MobileLandingHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="welcome-mobile-header">
      <div className="welcome-mobile-header__bar">
        <button
          type="button"
          className="welcome-mobile-header__open"
          onClick={onOpenAnyway}
        >
          {t('landing:openApp', 'Open App (unoptimized on mobile)')}
        </button>
      </div>

      <div className="welcome-mobile-header__brand">
        {/* eslint-disable-next-line i18next/no-literal-string -- brand name, never translated */}
        <h1 className="welcome-mobile-header__title">Ori Studio</h1>
        <p className="welcome-mobile-header__tagline">
          {t(
            'landing:mobileHero.tagline',
            'Design, edit and fold origami, all in the browser.'
          )}
        </p>
      </div>
    </header>
  );
}
