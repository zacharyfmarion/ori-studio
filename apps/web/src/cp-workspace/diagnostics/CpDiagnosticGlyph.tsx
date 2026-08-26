/**
 * The canvas marker, small enough to sit in a list row.
 *
 * Oriedita's error vocabulary is shape *and* colour, and
 * {@link foldabilityViolationMessage} only writes out the colour half plus
 * whatever the shape contributes as an independent fact. The shape itself is
 * what tells a "Not enough mountain folds" triangle from a "Not enough mountain
 * folds" square, so the list needs the marker, not just the sentence.
 *
 * Shape and tone come from {@link cpDiagnosticMarkerStyle} — the same call the
 * WebGL markers make. This component owns no classification logic, which is what
 * makes it impossible for the list and the canvas to disagree about an entry.
 *
 * Colour comes from `data-tone` in the stylesheet rather than a prop, so the two
 * surfaces read the same theme tokens.
 */
import type { TFunction } from 'i18next';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import { cpDiagnosticMarkerStyle, type CpDiagnosticMarkerShape } from './geometry';

const GLYPH_PX = 12;

/**
 * Oriedita's legend headings — the half of the sentence the shape carries.
 *
 * Surfaced on hover so the legend stays reachable from a row that, by design,
 * does not repeat it in text.
 */
function shapeTitle(t: TFunction, shape: CpDiagnosticMarkerShape): string | null {
  switch (shape) {
    case 'triangle':
      return t('panels:creasePattern.foldability.shape.triangle', 'Incorrect (odd) number of folds');
    case 'square':
      return t('panels:creasePattern.foldability.shape.square', 'Incorrect fold types');
    case 'circle':
    case 'ring':
      return t(
        'panels:creasePattern.foldability.shape.circle',
        "Incorrect angles (Kawasaki's theorem)"
      );
    case 'big-little-big':
      return t('panels:creasePattern.foldability.shape.bigLittleBig', 'Big-little-big');
    case 'self-intersection':
      return t(
        'panels:creasePattern.foldability.shape.selfIntersection',
        'The fold angles agree, but the paper cannot get there without crossing itself'
      );
    // The two shapes that are not Oriedita's, and not failures. Their headings
    // say what the fill means, since that is the only thing telling them apart.
    case 'undecided':
      return t(
        'panels:creasePattern.foldability.shape.undecided',
        'Undecided, and an angle for it is known'
      );
    case 'unexamined':
      return t('panels:creasePattern.foldability.shape.unexamined', 'Not checked');
    default:
      return null;
  }
}

function shapePath(shape: CpDiagnosticMarkerShape) {
  switch (shape) {
    case 'triangle':
      return <path d="M6 1.4 L11 10.6 L1 10.6 Z" />;
    case 'square':
      return <rect x="1.75" y="1.75" width="8.5" height="8.5" rx="0.8" />;
    case 'circle':
    case 'ring':
      return <circle cx="6" cy="6" r="4.25" />;
    case 'big-little-big':
      return <path d="M6 1.4 L10.37 4.58 L8.7 9.72 L3.3 9.72 L1.63 4.58 Z" />;
    // One silhouette for both, matching the canvas: the fill is what says
    // whether there is an answer waiting, and the stylesheet hollows the second.
    case 'undecided':
    case 'unexamined':
      return <path d="M6 1.6 L10.4 6 L6 10.4 L1.6 6 Z" />;
    case 'self-intersection':
    case 'generic':
      return <path d="M3 3 L9 9 M9 3 L3 9" />;
    case 'none':
      return null;
  }
}

export function CpDiagnosticGlyph({
  t,
  entry,
}: {
  t: TFunction;
  entry: OristudioCpDiagnosticEntry;
}) {
  const style = cpDiagnosticMarkerStyle(entry);
  // `none` means the kernel classified the vertex but found nothing to draw.
  // Reserve the column anyway so rows stay aligned.
  const path = shapePath(style.shape);
  const title = shapeTitle(t, style.shape);

  return (
    <svg
      className="cp-diagnostic-glyph"
      data-shape={style.shape}
      data-tone={style.tone}
      width={GLYPH_PX}
      height={GLYPH_PX}
      viewBox="0 0 12 12"
      role={title ? 'img' : 'presentation'}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {path}
    </svg>
  );
}
