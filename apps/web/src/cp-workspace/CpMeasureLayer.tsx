import { useCpOverlayView } from './cpOverlayViewStore';
import { overlayModelToCss } from './annotations/annotationTransform';
import { arcPath, arrowheadPoints, labelAnchor, type Vec2 } from './measureFigure';
import {
  formatCpAngle,
  formatCpLength,
  type CpAngleUnit,
  type CpMeasureKind,
  type CpMeasureScale,
  type CpMeasureUnit,
  type CpMeasurement,
} from './measure';

/**
 * The measure tool's on-canvas answer: a dimension line (or angle arc) with the
 * value drawn right where it was measured, instead of only in a corner panel.
 *
 * Everything here is **screen space**. Arrowheads, the arc radius, and the label
 * must not scale with zoom, and the WebGL stroke geometry it would otherwise ride
 * on carries model-space endpoints — so this is an SVG + DOM layer, the same
 * approach {@link CpTextAnnotationLayer} takes for text (and for the same reason:
 * the renderer has no glyph atlas, and the object count is tiny).
 *
 * Like that layer, it subscribes to the live camera directly so it re-renders
 * crisply every frame without re-rendering the panel.
 *
 * V1 draws at most two things: the committed measurement and the one being placed.
 * Nothing is persisted — see implementation-plans/measure-system-redesign.md.
 */

function MeasureFigure({
  kind,
  points,
  label,
  live,
  hovered,
}: {
  kind: CpMeasureKind;
  points: readonly Vec2[];
  label: string | null;
  /** A measurement still being placed draws lighter than the committed one. */
  live: boolean;
  /** True while its row in the session list is hovered. */
  hovered?: boolean;
}) {
  const anchor = labelAnchor(kind, points);
  const state = live ? 'live' : 'committed';
  return (
    <>
      <svg
        className="cp-measure-layer__figure"
        data-state={state}
        data-hovered={hovered || undefined}
        aria-hidden="true"
      >
        {kind === 'distance' && points.length >= 2 && (
          <>
            <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} />
            {[
              arrowheadPoints(points[0], points[1]),
              arrowheadPoints(points[1], points[0]),
            ].map((barbs, index) =>
              barbs ? <polyline key={index} points={barbs} className="cp-measure-layer__arrow" /> : null
            )}
          </>
        )}
        {kind === 'angle' &&
          points.length >= 3 &&
          (() => {
            const path = arcPath(points[1], points[0], points[2]);
            return path ? <path d={path} className="cp-measure-layer__arc" /> : null;
          })()}
      </svg>
      {label && anchor && (
        <div
          className="cp-measure-layer__label"
          data-state={state}
          data-hovered={hovered || undefined}
          style={{ transform: `translate(-50%, -50%) translate(${anchor.x}px, ${anchor.y}px)` }}
        >
          {label}
        </div>
      )}
    </>
  );
}

export function CpMeasureLayer({
  measurements,
  hoveredIndex,
  liveKind,
  livePoints,
  liveValue,
  liveSnapLabel,
  unit,
  angleUnit,
  scale,
}: {
  /** Committed readings, in the order they were taken. Cleared when the tool is left. */
  measurements: readonly CpMeasurement[];
  /** Index of the session-list row under the pointer, or null. */
  hoveredIndex: number | null;
  /** Kind of the pick in progress. */
  liveKind: CpMeasureKind;
  /** Points placed so far plus the cursor, in model coords. */
  livePoints: readonly Vec2[];
  /** Kernel value for the live pick once it has all its points, else null. */
  liveValue: number | null;
  /** What the cursor is snapped onto right now, or null once the pick is complete. */
  liveSnapLabel: string | null;
  unit: CpMeasureUnit;
  angleUnit: CpAngleUnit;
  scale: CpMeasureScale;
}) {
  const view = useCpOverlayView();
  if (!view) return null;

  const format = (kind: CpMeasureKind, value: number) =>
    kind === 'angle' ? formatCpAngle(value, angleUnit) : formatCpLength(value, unit, scale);

  const project = (points: readonly Vec2[]) => points.map((point) => overlayModelToCss(view, point));

  const liveComplete = liveKind === 'angle' ? livePoints.length >= 3 : livePoints.length >= 2;

  return (
    <div
      className="cp-measure-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        // Same band as the text layer: above the WebGL canvas (5) and grid (6),
        // below the annotation overlay (8). Without a z-index the DOM label paints
        // behind the opaque canvas.
        zIndex: 7,
      }}
      aria-hidden="true"
    >
      {measurements.map((measurement, index) => (
        <MeasureFigure
          key={index}
          kind={measurement.kind}
          points={project(measurement.points)}
          label={format(measurement.kind, measurement.value)}
          live={false}
          hovered={index === hoveredIndex}
        />
      ))}
      {liveComplete && (
        <MeasureFigure
          kind={liveKind}
          points={project(livePoints)}
          label={liveValue === null ? null : format(liveKind, liveValue)}
          live
        />
      )}
      {liveSnapLabel && livePoints.length > 0 && (
        <div
          className="cp-measure-layer__snap"
          style={(() => {
            const cursor = overlayModelToCss(view, livePoints[livePoints.length - 1]);
            return { transform: `translate(12px, 12px) translate(${cursor.x}px, ${cursor.y}px)` };
          })()}
        >
          {liveSnapLabel}
        </div>
      )}
    </div>
  );
}
