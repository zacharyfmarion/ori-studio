import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../store/themeStore';

const publicAssetBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

type FigureTheme = 'light' | 'dark';

/**
 * Where a landing screenshot for `name` in `theme` is expected to live.
 *
 * WebP, not PNG. These are 3456px screenshots of a dense UI and there are
 * eighteen of them; as PNG one theme's worth was 12MB, and at `-q 92` it is
 * 2.2MB with no visible difference on the thin crease lines and small type that
 * would show it first. Every browser that can run the app can decode WebP.
 */
export function landingFigureSrc(name: string, theme: FigureTheme): string {
  return `${publicAssetBase}landing/${name}-${theme}.webp`;
}

/**
 * The downscaled copies `scripts/gen-landing-images.sh` writes beside each master, as
 * `<name>-<theme>-<width>w.webp`. The master itself is the largest `srcset` candidate.
 */
export const LANDING_FIGURE_WIDTHS = [640, 960, 1280, 1920] as const;
const LANDING_FIGURE_MASTER_WIDTH = 3456;

export function landingFigureSrcSet(name: string, theme: FigureTheme): string {
  const variants = LANDING_FIGURE_WIDTHS.map(
    (width) => `${publicAssetBase}landing/${name}-${theme}-${width}w.webp ${width}w`
  );
  return [...variants, `${landingFigureSrc(name, theme)} ${LANDING_FIGURE_MASTER_WIDTH}w`].join(', ');
}

/**
 * How wide a figure renders, for `sizes`. Read off `WelcomeLanding.css`: a figure beside
 * copy takes the wider column of a grid that caps at 1120px and stacks below 860px; a
 * carousel slide takes the whole 1120px.
 */
export const LANDING_FIGURE_SIZES = {
  column: '(max-width: 860px) 100vw, (max-width: 1240px) 52vw, 640px',
  wide: '(max-width: 1240px) 100vw, 1120px',
} as const;

export interface LandingFigureProps {
  /** Base filename under `public/landing/`, without the theme suffix. */
  name: string;
  /** Describes the screenshot for anyone who cannot see it. */
  alt: string;
  /** The rendered width, so `srcset` can pick; a column beside copy by default. */
  sizes?: string;
}

/**
 * A screenshot on the landing page, in the theme the reader is actually using.
 *
 * Two masters per figure — `<name>-light.webp` and `<name>-dark.webp` in
 * `public/landing/` — chosen from the *app's* theme rather than a
 * `prefers-color-scheme` media query, because the theme is a preference the user
 * sets in the app and can differ from the one the OS reports.
 *
 * Until a file is dropped in, the frame renders as a labelled placeholder naming
 * the path it wants. That is deliberate: a missing screenshot should say which
 * file to add, not show a broken-image icon or silently collapse the layout.
 */
export function LandingFigure({ name, alt, sizes = LANDING_FIGURE_SIZES.column }: LandingFigureProps) {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.currentTheme.type);
  // Keyed by src, not a bare boolean: light may be present while dark is not,
  // and switching theme must re-try rather than stay stuck on the placeholder.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const figureTheme: FigureTheme = theme === 'light' ? 'light' : 'dark';
  const src = landingFigureSrc(name, figureTheme);

  if (failedSrc === src) {
    return (
      <div className="landing-figure landing-figure--placeholder" role="presentation">
        <ImageOff size={18} aria-hidden="true" />
        <span className="landing-figure__missing">
          {t('landing:figureMissing', 'Screenshot goes here')}
        </span>
        <code className="landing-figure__path">{`landing/${name}-${theme}.webp`}</code>
      </div>
    );
  }

  return (
    <figure className="landing-figure">
      <img
        className="landing-figure__image"
        src={src}
        srcSet={landingFigureSrcSet(name, figureTheme)}
        sizes={sizes}
        alt={alt}
        // Lazy is safe *because* the frame holds 16:9 in every state: a figure
        // that loads late, or fails and falls back to the placeholder, does so
        // inside a box that is already the right size, so nothing reflows.
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
      />
    </figure>
  );
}
