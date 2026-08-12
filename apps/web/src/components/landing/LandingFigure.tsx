import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../store/themeStore';

const publicAssetBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/** Where a landing screenshot for `name` in `theme` is expected to live. */
export function landingFigureSrc(name: string, theme: 'light' | 'dark'): string {
  return `${publicAssetBase}landing/${name}-${theme}.png`;
}

export interface LandingFigureProps {
  /** Base filename under `public/landing/`, without the theme suffix. */
  name: string;
  /** Describes the screenshot for anyone who cannot see it. */
  alt: string;
}

/**
 * A screenshot on the landing page, in the theme the reader is actually using.
 *
 * Two files per figure — `<name>-light.png` and `<name>-dark.png` in
 * `public/landing/` — chosen from the *app's* theme rather than a
 * `prefers-color-scheme` media query, because the theme is a preference the user
 * sets in the app and can differ from the one the OS reports.
 *
 * Until a file is dropped in, the frame renders as a labelled placeholder naming
 * the path it wants. That is deliberate: a missing screenshot should say which
 * file to add, not show a broken-image icon or silently collapse the layout.
 */
export function LandingFigure({ name, alt }: LandingFigureProps) {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.currentTheme.type);
  // Keyed by src, not a bare boolean: light may be present while dark is not,
  // and switching theme must re-try rather than stay stuck on the placeholder.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const src = landingFigureSrc(name, theme === 'light' ? 'light' : 'dark');

  if (failedSrc === src) {
    return (
      <div className="landing-figure landing-figure--placeholder" role="presentation">
        <ImageOff size={18} aria-hidden="true" />
        <span className="landing-figure__missing">
          {t('landing:figureMissing', 'Screenshot goes here')}
        </span>
        <code className="landing-figure__path">{`landing/${name}-${theme}.png`}</code>
      </div>
    );
  }

  return (
    <figure className="landing-figure">
      <img
        className="landing-figure__image"
        src={src}
        alt={alt}
        // Lazy is safe *because* the frame holds 16:9 in every state: a figure
        // that loads late, or fails and falls back to the placeholder, does so
        // inside a box that is already the right size, so nothing reflows. These
        // are screenshots of a dense UI — several megabytes each — and every one
        // of them is below the fold, so fetching them all up front would be the
        // page's whole weight spent on what most visitors never scroll to.
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
      />
    </figure>
  );
}
