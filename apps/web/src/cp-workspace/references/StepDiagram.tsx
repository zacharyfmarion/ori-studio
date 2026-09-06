import { useMemo } from 'react';
import type { Diagram } from './referenceFinder/solution';
import {
  referenceFinderDiagramToPrimitives,
  type StepDiagramModel,
} from './referenceFinderDiagramToPrimitives';
import {
  arcEndDirection,
  arcPathData,
  arrowheadPoints,
  createDiagramProjector,
  labelPlacement,
} from './stepDiagramGeometry';

/**
 * A small SVG of one ReferenceFinder diagram, for the sidebar's cards and step
 * rows. Every colour is a CSS class → `--fold-*` / `--cp-reference-*` token
 * (`theme.css`, `.step-diagram*`); nothing is styled inline, so the thumbnails
 * follow the theme like the view they sit beside.
 *
 * The geometry (projection, arc sweeps, arrowheads, label anchors) is
 * `stepDiagramGeometry.ts`, which has the tests; this only lays it out.
 */
export function StepDiagram({
  diagram,
  size = 100,
  className,
  label,
}: {
  diagram: Diagram;
  /** The viewBox side; the element itself scales to its box. */
  size?: number;
  className?: string;
  /** Accessible name; the drawing is otherwise decorative. */
  label?: string;
}) {
  const model = useMemo<StepDiagramModel | null>(() => {
    try {
      return referenceFinderDiagramToPrimitives(diagram);
    } catch {
      // A diagram the adapter refuses is a wire-shape change; the row keeps its
      // sentence and simply shows no picture rather than a wrong one.
      return null;
    }
  }, [diagram]);
  const project = useMemo(
    () => createDiagramProjector(model?.sheet ?? { width: 1, height: 1 }, size),
    [model, size]
  );

  if (!model) {
    return (
      <svg
        className={['step-diagram', 'step-diagram--unavailable', className].filter(Boolean).join(' ')}
        viewBox={project.viewBox}
        role="img"
        aria-label={label}
        data-diagram-error="true"
      />
    );
  }

  const arrowSize = size * 0.05;

  return (
    <svg
      className={['step-diagram', className].filter(Boolean).join(' ')}
      viewBox={project.viewBox}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {model.primitives.map((primitive, index) => {
        switch (primitive.kind) {
          case 'sheet': {
            const lo = project([0, primitive.height]);
            const hi = project([primitive.width, 0]);
            return (
              <rect
                key={index}
                className="step-diagram__sheet"
                x={lo.x}
                y={lo.y}
                width={hi.x - lo.x}
                height={hi.y - lo.y}
              />
            );
          }
          case 'line': {
            const from = project(primitive.from);
            const to = project(primitive.to);
            return (
              <line
                key={index}
                className={`step-diagram__line step-diagram__line--${primitive.style}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          }
          case 'arc': {
            const path = arcPathData(primitive, project);
            if (primitive.style !== 'arrow') {
              return (
                <path
                  key={index}
                  className={`step-diagram__arc step-diagram__line--${primitive.style}`}
                  d={path}
                />
              );
            }
            const tip = project([
              primitive.center[0] + primitive.radius * Math.cos(primitive.to),
              primitive.center[1] + primitive.radius * Math.sin(primitive.to),
            ]);
            return (
              <g key={index} className="step-diagram__arrow">
                <path className="step-diagram__arc step-diagram__line--arrow" d={path} />
                <polygon
                  className="step-diagram__arrowhead"
                  points={arrowheadPoints(tip, arcEndDirection(primitive), arrowSize)}
                />
              </g>
            );
          }
          case 'point': {
            const at = project(primitive.at);
            return (
              <circle
                key={index}
                className={`step-diagram__point step-diagram__point--${primitive.style}`}
                cx={at.x}
                cy={at.y}
                r={size * 0.025}
              />
            );
          }
          case 'label': {
            const at = project(primitive.at);
            const placement = labelPlacement(primitive.at, model.sheet, project);
            return (
              <text
                key={index}
                className={`step-diagram__label step-diagram__label--${primitive.style}`}
                x={at.x + placement.dx}
                y={at.y + placement.dy}
                textAnchor={placement.anchor}
              >
                {primitive.text}
              </text>
            );
          }
        }
      })}
    </svg>
  );
}
