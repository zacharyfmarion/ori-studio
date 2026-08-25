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
 *
 * That subscription goes through {@link usePannedOverlayView} rather than the
 * raw view, because "without re-rendering the panel" was not enough: at
 * `MAX_BADGES` the layer alone re-rendered and restyled 300 elements per camera
 * frame. A pan only translates, so it is applied as one transform on the
 * container and the badges are re-projected only on zoom and rotation — which is
 * also the only time the plan can change, since every decision it makes is made
 * on screen length.
 *
 * The pair matters more than either half. Panning a badged pattern was visibly
 * rough, and profiling found ~200ms of React per 3.5s pan — but removing all of
 * it changed nothing perceptible, because the real cost was repainting 300 text
 * nodes every frame. Promoting the container (below) is what fixed it; not
 * re-rendering is what lets a promoted layer stay promoted.
 */
import { usePannedOverlayView } from '../camera/usePannedOverlayView';
import { useCpTransformPreview } from '../cpTransformPreviewStore';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { overlayModelToCss } from '../annotations/annotationTransform';
import { applyAffine, type CpTransformPreview } from '../adapters/cpSnapshotToScene';
import type { ModelPoint } from '../renderer/types';
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

/**
 * Where a crease is *drawn* right now: its stored endpoint, or that endpoint
 * through the gesture the surface is previewing.
 *
 * The same predicate and the same affine the stroke builder applies (see the
 * `moved` branch in `cpSnapshotToScene`), so a badge cannot land anywhere but on
 * the stroke it labels — including under a four-point transform, where the
 * projected length changes and the plan is entitled to change with it. That is
 * why the matrix goes on the model point rather than on the finished badge: it
 * puts the transform *upstream* of every decision `planFoldAngleBadges` makes,
 * all of which are made on screen length.
 */
function drawnAt(
  move: CpTransformPreview | null,
  lineId: number,
  point: ModelPoint
): ModelPoint {
  if (!move || !move.ids.has(lineId)) return point;
  return applyAffine(move.matrix, point.x, point.y);
}

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
  const { view, containerRef } = usePannedOverlayView();
  // A move-drag or a transform tool draws the selected creases somewhere the
  // document does not yet say they are, and only the canvas knows where. Without
  // this the numbers sat at the stored midpoints for the length of the gesture —
  // survivable while dragging, but the four-point tools hold their preview
  // between clicks and turn and scale it, so a whole pattern's worth of labels
  // hung in the old lattice while the creases went elsewhere.
  const move = useCpTransformPreview();
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
      const lineId = index + 1;
      creases.push({
        lineId,
        a: overlayModelToCss(view, drawnAt(move, lineId, segment.a)),
        b: overlayModelToCss(view, drawnAt(move, lineId, segment.b)),
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
      ref={containerRef}
      className="cp-fold-angle-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        // Same band as the measure and text layers: above the WebGL canvas and
        // grid, below the annotation overlay.
        zIndex: 7,
        // The `will-change: transform` that makes the pan above a compositor
        // move rather than a repaint is in the stylesheet, beside the other
        // layer promotions — see `.cp-fold-angle-layer`.
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
