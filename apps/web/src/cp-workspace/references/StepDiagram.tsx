import { useMemo } from 'react';
import type { Diagram } from './referenceFinder/solution';
import {
  referenceFinderDiagramToPrimitives,
  type StepDiagramModel,
} from './referenceFinderDiagramToPrimitives';
import {
  arcEndDirection,
  arcPathData,
  arcStartDirection,
  arrowheadPoints,
  arrowheadSize,
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
export type StepDiagramProps = {
  /** The viewBox side; the element itself scales to its box. */
  size?: number;
  className?: string;
  /** Accessible name; the drawing is otherwise decorative. */
  label?: string;
  /**
   * Draw the paper's back, mirrored, as the view beside the strip does. A card
   * for a fold made after a turn-over shows what the folder is looking at.
   */
  mirrored?: boolean;
} & (
  | {
      /** A ReferenceFinder diagram, adapted here. */
      diagram: Diagram;
      primitives?: undefined;
    }
  | {
      /**
       * Primitives built elsewhere — the planner's steps, which ship
       * witnesses rather than diagrams (`plannerStepToPrimitives.ts`).
       */
      primitives: StepDiagramModel | null;
      diagram?: undefined;
    }
);

export function StepDiagram({
  diagram,
  primitives,
  size = 100,
  className,
  label,
  mirrored = false,
}: StepDiagramProps) {
  const model = useMemo<StepDiagramModel | null>(() => {
    if (diagram === undefined) return primitives ?? null;
    try {
      return referenceFinderDiagramToPrimitives(diagram);
    } catch {
      // A diagram the adapter refuses is a wire-shape change; the row keeps its
      // sentence and simply shows no picture rather than a wrong one.
      return null;
    }
  }, [diagram, primitives]);
  const project = useMemo(
    () => createDiagramProjector(model?.sheet ?? { width: 1, height: 1 }, size, mirrored),
    [model, size, mirrored]
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
            // Two opposite corners, not a top-left and a size: a mirrored
            // projector swaps which of them is on the left, and an SVG rect
            // with a negative width is invalid — the paper simply vanishes.
            const a = project([0, primitive.height]);
            const b = project([primitive.width, 0]);
            return (
              <rect
                key={index}
                className={
                  mirrored ? 'step-diagram__sheet step-diagram__sheet--back' : 'step-diagram__sheet'
                }
                x={Math.min(a.x, b.x)}
                y={Math.min(a.y, b.y)}
                width={Math.abs(b.x - a.x)}
                height={Math.abs(b.y - a.y)}
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
            // Sheet units through the projector's scale, so the head keeps
            // upstream's proportion to the paper at any thumbnail size.
            const head = arrowheadSize(primitive, model.sheet) * project.scale;
            const at = (angle: number) =>
              project([
                primitive.center[0] + primitive.radius * Math.cos(angle),
                primitive.center[1] + primitive.radius * Math.sin(angle),
              ]);
            // A head at each end. `CalcArrow` computes `fromDir` and `toDir`
            // and `DrawArrow` throws both away (`refDgmr.cpp:70-74, 89-90`), so
            // upstream's picture shows a bare arc; drawn one-ended it reads as
            // a one-way motion, which a fold is not.
            return (
              <g key={index} className="step-diagram__arrow">
                <path className="step-diagram__arc step-diagram__line--arrow" d={path} />
                <polygon
                  className="step-diagram__arrowhead"
                  points={arrowheadPoints(at(primitive.to), arcEndDirection(primitive, mirrored), head)}
                />
                <polygon
                  className="step-diagram__arrowhead"
                  points={arrowheadPoints(
                    at(primitive.from),
                    arcStartDirection(primitive, mirrored),
                    head
                  )}
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
