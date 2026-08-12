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
        // Deliberately not `loading="lazy"`: every figure is below the fold, so
        // a lazy one is never requested, never fails, and never falls back —
        // the frame would just sit empty until scrolled to and then jump. Four
        // images on the page's primary content is a fair price for that.
        decoding="async"
        onError={() => setFailedSrc(src)}
      />
    </figure>
  );
}
