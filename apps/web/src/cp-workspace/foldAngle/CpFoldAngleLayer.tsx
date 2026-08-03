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
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { overlayModelToCss } from '../annotations/annotationTransform';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import {
  creaseFoldAngle,
  foldAngleFromParts,
  isClassicCrease,
  isClassicMagnitude,
  isFoldingCrease,
} from '../../lib/foldAngle';
import { formatFoldAngle } from '../../lib/foldAngle';
import type { ToolPreviewSegment } from '../tools/types';
import {
  planFoldAngleBadges,
  type FoldAngleBadgeInput,
} from './foldAngleBadges';

export function CpFoldAngleLayer({
  lineSegments,
  toolCandidates,
}: {
  /** Crease line segments in model space, indexed so id === index + 1. */
  lineSegments: readonly OristudioCpLineSegment[] | undefined;
  /**
   * Candidate creases the active tool would create, when it solved them rather
   * than taking the active line type — the vertex-completion tool.
   *
   * These are badged **whether or not the labels toggle is on**: the angle is
   * the tool's answer, not document decoration, and a tool that offers three
   * rays without saying which folds how far has not told the user anything.
   */
  toolCandidates?: readonly ToolPreviewSegment[];
}) {
  const view = useCpOverlayView();
  // The layer owns its own visibility rather than the panel deciding for it.
  // Note this gates the *badges* only — crease colour is unconditional, and
  // lives in the stroke builders where no visibility flag reaches it.
  const labelsVisible = useWorkspaceStore(
    (state) => state.oristudioCpViewport.foldAngleLabelsVisible !== false
  );
  if (!view) return null;

  const creases: FoldAngleBadgeInput[] = [];
  if (lineSegments && labelsVisible) {
    lineSegments.forEach((segment, index) => {
      if (!isFoldingCrease(segment.color) || isClassicCrease(segment)) return;
      // Signed, not |rho|. The sign duplicates what the colour already says, and
      // that redundancy is the point: a red crease reading -90 teaches the
      // convention for free, where an unsigned 90 on both a red and a blue crease
      // teaches nothing and quietly implies they are the same fold.
      const degrees = creaseFoldAngle(segment);
      if (degrees === null) return;
      creases.push({
        lineId: index + 1,
        a: overlayModelToCss(view, segment.a),
        b: overlayModelToCss(view, segment.b),
        degrees,
      });
    });
  }

  const candidates: FoldAngleBadgeInput[] = [];
  (toolCandidates ?? []).forEach((segment, index) => {
    if (!segment.crease) return;
    // Same rule the document follows: a full fold is the default and says
    // nothing, so it gets no number. On a flat pattern every candidate is 180
    // and badging them all would be noise on top of the colour, which already
    // carries the only fact that varies — mountain or valley.
    if (isClassicMagnitude(segment.crease.foldMagnitude)) return;
    const degrees = foldAngleFromParts(segment.crease.color, segment.crease.foldMagnitude);
    if (degrees === null) return;
    candidates.push({
      // Planned separately from the document creases, so this index is a key
      // within its own set and never has to avoid a real line id.
      lineId: index + 1,
      a: overlayModelToCss(view, segment.a),
      b: overlayModelToCss(view, segment.b),
      degrees,
    });
  });

  const badges = planFoldAngleBadges(creases);
  const candidateBadges = planFoldAngleBadges(candidates);
  if (badges.length === 0 && candidateBadges.length === 0) return null;

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
      {candidateBadges.map((badge) => (
        <div
          key={`candidate-${badge.lineId}`}
          className="cp-fold-angle-layer__badge"
          data-detail={badge.detail}
          data-candidate="true"
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
