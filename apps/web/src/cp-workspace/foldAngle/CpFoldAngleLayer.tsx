/**
 * On-canvas fold-angle readouts.
 *
 * The lightness ramp is too quiet on a 1px stroke to carry this alone, so the
 * number at the crease midpoint is the primary signal that a crease is not a
 * full ±180 — and, unlike any colour treatment, it says *which* angle.
 *
 * A DOM/SVG overlay rather than GPU geometry, for the same reason
 * {@link CpMeasureLayer} and {@link CpTextAnnotationLayer} are: the renderer has
 * no glyph atlas, and the badge count is bounded well below the crease count.
 * It subscribes to the live camera directly so it stays crisp while panning
 * without re-rendering the panel.
 */
import { useCpOverlayView } from '../cpOverlayViewStore';
import { overlayModelToCss } from '../annotations/annotationTransform';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { creaseFoldMagnitudeDegrees, isClassicCrease, isFoldingCrease } from '../../lib/foldAngle';
import { formatFoldAngle } from '../../lib/foldAngle';
import {
  planFoldAngleBadges,
  type FoldAngleBadgeInput,
} from './foldAngleBadges';

export function CpFoldAngleLayer({
  lineSegments,
}: {
  /** Crease line segments in model space, indexed so id === index + 1. */
  lineSegments: readonly OristudioCpLineSegment[] | undefined;
}) {
  const view = useCpOverlayView();
  if (!view || !lineSegments) return null;

  const candidates: FoldAngleBadgeInput[] = [];
  lineSegments.forEach((segment, index) => {
    if (!isFoldingCrease(segment.color) || isClassicCrease(segment)) return;
    const degrees = creaseFoldMagnitudeDegrees(segment);
    if (degrees === null) return;
    candidates.push({
      lineId: index + 1,
      a: overlayModelToCss(view, segment.a),
      b: overlayModelToCss(view, segment.b),
      degrees,
    });
  });

  if (candidates.length === 0) return null;
  const badges = planFoldAngleBadges(candidates);
  if (badges.length === 0) return null;

  return (
    <div
      className="cp-fold-angle-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        // Same band as the measure and text layers: above the WebGL canvas and
        // grid, below the annotation overlay.
        zIndex: 7,
      }}
      aria-hidden="true"
    >
      {badges.map((badge) => (
        <div
          key={badge.lineId}
          className="cp-fold-angle-layer__badge"
          data-detail={badge.detail}
          style={{
            transform: `translate(-50%, -50%) translate(${badge.at.x}px, ${badge.at.y}px)`,
          }}
        >
          {badge.detail === 'number' ? formatFoldAngle(badge.degrees) : null}
        </div>
      ))}
    </div>
  );
}
