import { Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './DesktopOnlyNotice.css';

export interface DesktopOnlyNoticeProps {
  /** Take the escape hatch: the caller opens the gate and lets the app load. */
  onOpenAnyway: () => void;
}

/**
 * What a phone gets instead of the start screen.
 *
 * It says the thing plainly rather than degrading the app into something that
 * technically renders — every tool here wants a pointer that can hover and a
 * screen with room to work, and a half-working crease-pattern editor would waste
 * more of someone's time than a clear no.
 *
 * The way out is deliberately quiet but real. Someone on a tablet-sized phone,
 * or with a keyboard attached, may well be right that they can use this, and a
 * hard gate would only send them to the issue tracker.
 */
export function DesktopOnlyNotice({ onOpenAnyway }: DesktopOnlyNoticeProps) {
  const { t } = useTranslation();

  return (
    <section className="welcome-notice" aria-labelledby="desktop-only-title">
      <div className="welcome-notice__inner">
        <span className="welcome-notice__icon" aria-hidden="true">
          <Monitor size={20} />
        </span>
        {/* eslint-disable-next-line i18next/no-literal-string -- brand name, never translated */}
        <span className="welcome-notice__eyebrow">Ori Studio</span>
        <h1 className="welcome-notice__title" id="desktop-only-title">
          {t('landing:desktopOnly.title', 'Desktop only, for now')}
        </h1>
        <p className="welcome-notice__body">
          {t(
            'landing:desktopOnly.body',
            'Drawing a crease pattern, dragging a tree into shape and folding the result all want a mouse, a keyboard, and room to work. None of that fits a phone yet, so this is not going to pretend otherwise.'
          )}
        </p>
        <p className="welcome-notice__body">
          {t(
            'landing:desktopOnly.invitation',
            'Open this page on a computer and the whole thing is there. In the meantime, here is what it does.'
          )}
        </p>
        <button type="button" className="welcome-notice__bypass" onClick={onOpenAnyway}>
          {t('landing:desktopOnly.openAnyway', 'Open it anyway')}
        </button>
        <p className="welcome-notice__small">
          {t(
            'landing:desktopOnly.openAnywayNote',
            'It will be cramped, and the tools that need a hover or a right-click have no touch equivalent yet.'
          )}
        </p>
      </div>
    </section>
  );
}
