import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OristudioCpLineSegment, OristudioCpModel } from '../../engine/oristudioCpTypes';
import { ORIEDITA_PAPER_MAX, ORIEDITA_PAPER_MIN } from '../../lib/creasePatternViewport';

/**
 * A lesson's target pattern, drawn as a static SVG.
 *
 * Static SVG rather than a second WebGL surface: several of these can be on
 * screen at once (the lesson pane plus index thumbnails), they scale and print,
 * and there is no camera to manage. Colours come from the same `--fold-*` theme
 * tokens the canvas uses, so a preview and the real editor can never disagree
 * about what "mountain" looks like.
 */

/** Kernel line colour → theme token. */
const STROKE_BY_COLOR: Record<string, string> = {
  Red1: 'var(--fold-mountain)',
  Blue2: 'var(--fold-valley)',
  Black0: 'var(--fold-border)',
  Cyan3: 'var(--fold-flat)',
  None: 'var(--fold-unassigned)',
};

function strokeFor(segment: OristudioCpLineSegment): string {
  return STROKE_BY_COLOR[segment.color] ?? 'var(--fold-unassigned)';
}

export interface TargetCpPreviewProps {
  geometry: OristudioCpModel | null;
  /**
   * Creases the user has not drawn yet, as `a`/`b` endpoint pairs. Drawn with
   * emphasis so the lesson can point at what is left rather than only counting.
   */
  highlight?: readonly OristudioCpLineSegment[];
  /** Accessible description; defaults to a generic one. */
  label?: string;
  className?: string;
}

const PAD = 12;
const VIEW_MIN = ORIEDITA_PAPER_MIN - PAD;
const VIEW_SIZE = ORIEDITA_PAPER_MAX - ORIEDITA_PAPER_MIN + PAD * 2;

function segmentKey(segment: OristudioCpLineSegment, index: number): string {
  return `${index}:${segment.a.x},${segment.a.y}-${segment.b.x},${segment.b.y}`;
}

/** Endpoint-order-independent identity, so a highlight matches either direction. */
function undirectedKey(segment: OristudioCpLineSegment): string {
  const { a, b } = segment;
  const forward = `${a.x},${a.y}|${b.x},${b.y}`;
  const reverse = `${b.x},${b.y}|${a.x},${a.y}`;
  return forward < reverse ? forward : reverse;
}

export const TargetCpPreview = memo(function TargetCpPreview({
  geometry,
  highlight,
  label,
  className,
}: TargetCpPreviewProps) {
  const { t } = useTranslation();
  const highlighted = useMemo(
    () => new Set((highlight ?? []).map(undirectedKey)),
    [highlight]
  );

  const title = label ?? t('panels:tutorial.targetPreview.label', 'Target crease pattern');

  if (!geometry) {
    return (
      <div className={`tutorial-target-preview tutorial-target-preview--empty ${className ?? ''}`}>
        <span className="tutorial-target-preview__pending">
          {t('panels:tutorial.targetPreview.loading', 'Loading target…')}
        </span>
      </div>
    );
  }

  const segments = [...geometry.line_segments, ...geometry.aux_line_segments];

  return (
    <svg
      className={`tutorial-target-preview ${className ?? ''}`}
      viewBox={`${VIEW_MIN} ${VIEW_MIN} ${VIEW_SIZE} ${VIEW_SIZE}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        className="tutorial-target-preview__paper"
        x={ORIEDITA_PAPER_MIN}
        y={ORIEDITA_PAPER_MIN}
        width={ORIEDITA_PAPER_MAX - ORIEDITA_PAPER_MIN}
        height={ORIEDITA_PAPER_MAX - ORIEDITA_PAPER_MIN}
      />
      {segments.map((segment, index) => {
        const isMissing = highlighted.has(undirectedKey(segment));
        return (
          <line
            key={segmentKey(segment, index)}
            x1={segment.a.x}
            y1={segment.a.y}
            x2={segment.b.x}
            y2={segment.b.y}
            stroke={strokeFor(segment)}
            className={
              isMissing
                ? 'tutorial-target-preview__line tutorial-target-preview__line--missing'
                : 'tutorial-target-preview__line'
            }
          />
        );
      })}
    </svg>
  );
});
