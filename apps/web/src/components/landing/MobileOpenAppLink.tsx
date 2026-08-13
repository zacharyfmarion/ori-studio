import { useTranslation } from 'react-i18next';

export interface MobileOpenAppLinkProps {
  /** Take the escape hatch: the caller opens the gate and lets the app load. */
  onOpenAnyway: () => void;
}

/**
 * The way into the app from a phone, as a corner control rather than a wall.
 *
 * This replaced a full-screen "Desktop only, for now" notice. That notice was
 * honest but it spent the entire first screen — everything above the fold on a
 * phone — telling someone what they could not do, and pushed the thing they
 * actually came to read below the fold. The page is a landing page; on a phone
 * it should just *be* the landing page.
 *
 * So the caveat moves into the label. "unoptimized on mobile" sets the
 * expectation in the four words someone reads before tapping, which is the same
 * warning the notice gave in two paragraphs, delivered where the decision is
 * made.
 */
export function MobileOpenAppLink({ onOpenAnyway }: MobileOpenAppLinkProps) {
  const { t } = useTranslation();

  return (
    <div className="welcome-open-app">
      <button type="button" className="welcome-open-app__button" onClick={onOpenAnyway}>
        {t('landing:openApp', 'Open App (unoptimized on mobile)')}
      </button>
    </div>
  );
}
