import { useMemo } from 'react';
import type { Diagram } from './referenceFinder/solution';
import type { DiagramLineStyleName } from './referenceFinderDiagramToPrimitives';
import {
  referenceFinderDiagramToPrimitives,
  type StepDiagramModel,
} from './referenceFinderDiagramToPrimitives';
import {
  DIAGRAM_LABEL_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_SHEET_INK,
} from './diagram/diagramInk';
import {
  TURN_OVER_BOX,
  TURN_OVER_HEAD,
  TURN_OVER_PATH,
  arcEndDirection,
  arcPathData,
  arrowheadPoints,
  arrowheadSize,
  createDiagramProjector,
  foldArrowTrim,
  labelPlacement,
  MARK_RING_RADIUS,
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

/**
 * A line style's geometry as SVG attributes, in the drawing's own units.
 *
 * `ink` is the pen — see `diagram/diagramInk.ts`. Emitted here rather than left
 * in the stylesheet because a stylesheet cannot know how big the drawing is,
 * and that is exactly what these numbers depend on.
 */
function strokeAttributes(style: DiagramLineStyleName, ink: number) {
  const pen = DIAGRAM_LINE_INK[style];
  return {
    strokeWidth: pen.width * ink,
    strokeDasharray: pen.dash?.map((run) => run * ink).join(' '),
    strokeLinecap: pen.cap,
    strokeOpacity: pen.opacity,
  };
}

/** Four decimals is under a device pixel at any thumbnail size. */
const round = (value: number) => Number(value.toFixed(4));

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
                strokeWidth={DIAGRAM_SHEET_INK.width * project.ink}
                strokeOpacity={DIAGRAM_SHEET_INK.opacity}
              />
            );
          }
          case 'line': {
            const from = project(primitive.from);
            const to = project(primitive.to);
            // Positive. `stroke-dashoffset` is "start this far *into* the
            // pattern", which is exactly what the phase says — how much of the
            // line has already gone by. Negating it lands at `period - phase`
            // instead, a different place in the pattern for every span, which
            // is the same broken picture the offset was added to fix.
            //
            // In user units, like the dash array it indexes into. Those two
            // were on different rulers until the pen moved out of the
            // stylesheet: the offset scaled with the viewBox and the pattern
            // did not, so they only agreed at one size.
            const dashOffset = primitive.dashPhase
              ? primitive.dashPhase * project.scale
              : undefined;
            return (
              <line
                key={index}
                className={`step-diagram__line step-diagram__line--${primitive.style}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                strokeDashoffset={dashOffset}
                {...strokeAttributes(primitive.style, project.ink)}
              />
            );
          }
          case 'arc': {
            return (
              <path
                key={index}
                className={`step-diagram__arc step-diagram__line--${primitive.style}`}
                d={arcPathData(primitive, project)}
                {...strokeAttributes(primitive.style, project.ink)}
              />
            );
          }
          case 'fold-arrow': {
            // Sheet units through the projector's scale, so the head keeps
            // upstream's proportion to the paper at any size. The trim is done
            // on radii in the same projected units and the angles it returns
            // then apply to the sheet-unit arcs unchanged.
            const head = arrowheadSize(primitive.out, model.sheet) * project.scale;
            const scaled = {
              out: { ...primitive.out, radius: primitive.out.radius * project.scale },
              back: { ...primitive.back, radius: primitive.back.radius * project.scale },
            };
            const trimmed = foldArrowTrim(scaled, head, MARK_RING_RADIUS * project.scale);
            const tipArc = { ...primitive.back, to: trimmed.tip };
            const tip = project([
              primitive.back.center[0] + primitive.back.radius * Math.cos(trimmed.tip),
              primitive.back.center[1] + primitive.back.radius * Math.sin(trimmed.tip),
            ]);
            return (
              <g key={index} className="step-diagram__arrow">
                <path
                  className="step-diagram__arc step-diagram__line--arrow"
                  d={arcPathData({ ...primitive.out, from: trimmed.out.from }, project)}
                  {...strokeAttributes('arrow', project.ink)}
                />
                <path
                  className="step-diagram__arc step-diagram__line--arrow"
                  d={arcPathData({ ...primitive.back, to: trimmed.back.to }, project)}
                  {...strokeAttributes('arrow', project.ink)}
                />
                <polygon
                  className="step-diagram__arrowhead"
                  points={arrowheadPoints(tip, arcEndDirection(tipArc, mirrored), head)}
                />
              </g>
            );
          }
          case 'turn-over': {
            const at = project(primitive.at);
            const scale = (primitive.size * project.scale) / TURN_OVER_BOX.width;
            // Drawn in screen space, not mirrored with the paper: it is a
            // symbol for what the folder does, not part of the pattern.
            const x = at.x - (TURN_OVER_BOX.width / 2) * scale;
            const y = at.y - (TURN_OVER_BOX.height / 2) * scale;
            return (
              <g
                key={index}
                className="step-diagram__turn-over"
                transform={`translate(${round(x)} ${round(y)}) scale(${round(scale)})`}
              >
                <path
                  className="step-diagram__arc step-diagram__line--arrow"
                  d={TURN_OVER_PATH}
                  {...strokeAttributes('arrow', project.ink / scale)}
                />
                <polygon
                  className="step-diagram__arrowhead"
                  points={arrowheadPoints(
                    { x: TURN_OVER_HEAD.at[0], y: TURN_OVER_HEAD.at[1] },
                    { x: Math.cos(TURN_OVER_HEAD.angle), y: Math.sin(TURN_OVER_HEAD.angle) },
                    TURN_OVER_HEAD.size
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
                r={project.scale * MARK_RING_RADIUS}
                strokeWidth={DIAGRAM_MARK_INK.width * project.ink}
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
                fontSize={DIAGRAM_LABEL_INK.size * project.ink}
                strokeWidth={DIAGRAM_LABEL_INK.halo * project.ink}
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
