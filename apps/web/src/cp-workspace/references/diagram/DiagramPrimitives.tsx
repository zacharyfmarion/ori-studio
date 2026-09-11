import type { ReactNode } from 'react';
import type { DiagramProjector, DiagramSheet, SvgPoint } from '../stepDiagramGeometry';
import {
  TURN_OVER_BOX,
  TURN_OVER_HEAD,
  TURN_OVER_PATH,
  arcEndDirection,
  arcPathData,
  arrowheadPoints,
  arrowheadSize,
  foldAndUnfoldFromArc,
  foldArrowLanding,
  foldArrowTrim,
} from '../stepDiagramGeometry';
import type {
  DiagramLineStyleName,
  StepDiagramPrimitive,
} from '../referenceFinderDiagramToPrimitives';
import {
  DIAGRAM_LABEL_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_SHEET_INK,
  DIAGRAM_TURN_OVER_INK,
} from './diagramInk';
import {
  diagramMarks,
  placeLabels,
  type LabelLayoutOptions,
  type LabelPlacement,
} from './labelLayout';

/**
 * One primitive as SVG, in whatever space the projector maps into.
 *
 * The card fits the paper into a box of its own; the layer over the crease
 * pattern projects through the live camera. Same shapes, same classes, same
 * pen — only the projector differs, which is the whole reason a step is
 * described as primitives rather than drawn twice.
 */

/** Four decimals is under a device pixel at any size this is drawn at. */
const round = (value: number) => Number(value.toFixed(4));

/**
 * A line style's geometry as SVG attributes, in the drawing's own units.
 *
 * `ink` is the pen — see `diagramInk.ts`. Emitted here rather than left in the
 * stylesheet because a stylesheet cannot know how big the drawing is, and that
 * is exactly what these numbers depend on. `dashScale` is the projector's
 * (`DiagramProjector.dashScale`), and shortens the runs alone: the width is
 * the line's weight and stays the pen's.
 */
export function strokeAttributes(style: DiagramLineStyleName, ink: number, dashScale = 1) {
  const pen = DIAGRAM_LINE_INK[style];
  return {
    strokeWidth: pen.width * ink,
    strokeDasharray: pen.dash?.map((run) => run * ink * dashScale).join(' '),
    strokeLinecap: pen.cap,
    strokeOpacity: pen.opacity,
  };
}

/** The primitives a straight-line renderer cannot express. */
export function isDiagramSymbol(primitive: StepDiagramPrimitive): boolean {
  return primitive.kind !== 'line' && primitive.kind !== 'sheet';
}

/**
 * What one drawing of a model shares between its primitives.
 *
 * Two of the shapes are decided by the *rest* of the picture rather than by
 * their own primitive: a letter goes where no ring, no other letter and no
 * reserved corner is (`placeLabels`), and a fold arrow that lands on a mark
 * turns round at the mark's rim (`foldArrowLanding`). Both need every ring in
 * the model, so a caller builds this once from the whole list and draws each
 * primitive against it, rather than each primitive rediscovering the others.
 */
export interface DiagramRenderContext {
  project: DiagramProjector;
  /** The centre of every ring in the picture, in the projector's units. */
  marks: readonly SvgPoint[];
  /** Where each letter goes, by its primitive's index in the list drawn. */
  labels: ReadonlyMap<number, LabelPlacement>;
}

/**
 * The context for drawing `primitives` through `project`. The list handed in
 * is the list to draw — the letters are keyed by their position in it — and
 * `sheet` is the paper they were measured against, whose middle is the side a
 * letter stands away from.
 */
export function createDiagramRenderContext(
  primitives: readonly StepDiagramPrimitive[],
  sheet: DiagramSheet,
  project: DiagramProjector,
  layout: LabelLayoutOptions = {}
): DiagramRenderContext {
  return {
    project,
    marks: diagramMarks(primitives, project),
    labels: placeLabels(primitives, sheet, project, layout),
  };
}

export function diagramPrimitiveShape(
  primitive: StepDiagramPrimitive,
  index: number,
  context: DiagramRenderContext
): ReactNode {
  const { project } = context;
  const mirrored = project.mirrored;
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
      // did not, so they only agreed at one size. The dash scale does not
      // touch it: a phase is a distance along the line, whatever pattern
      // is laid along it, and every span of one line shares that ruler.
      const dashOffset = primitive.dashPhase ? primitive.dashPhase * project.scale : undefined;
      return (
        <line
          key={index}
          className={`step-diagram__line step-diagram__line--${primitive.style}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          strokeDashoffset={dashOffset}
          {...strokeAttributes(primitive.style, project.ink, project.dashScale)}
        />
      );
    }
    case 'arc': {
      return (
        <path
          key={index}
          className={`step-diagram__arc step-diagram__line--${primitive.style}`}
          d={arcPathData(primitive, project)}
          {...strokeAttributes(primitive.style, project.ink, project.dashScale)}
        />
      );
    }
    case 'fold-arrow': {
      // Sized by the pen, not by the paper — see `arrowheadSize`. The trim is
      // done on radii in the same projected units, and the angles it returns
      // then apply to the sheet-unit arcs unchanged.
      const head = arrowheadSize(primitive.out, project);
      const rim = DIAGRAM_MARK_INK.radius * project.ink;
      // Stopped at the far mark's rim, if it lands on one, before the return
      // is derived — the return starts where the outgoing stroke stops.
      const out = foldArrowLanding(primitive.out, context.marks, rim, project);
      // The return, derived here rather than carried: how far to the side it
      // ends is an arrowhead's length, and that is the drawing's business —
      // see the primitive's own note.
      const arrow = foldAndUnfoldFromArc(out, head / project.scale);
      if (!arrow) return null;
      const scaled = {
        out: { ...arrow.out, radius: arrow.out.radius * project.scale },
        back: { ...arrow.back, radius: arrow.back.radius * project.scale },
      };
      const trimmed = foldArrowTrim(scaled, head, rim);
      const tipArc = { ...arrow.back, to: trimmed.tip };
      const tip = project([
        arrow.back.center[0] + arrow.back.radius * Math.cos(trimmed.tip),
        arrow.back.center[1] + arrow.back.radius * Math.sin(trimmed.tip),
      ]);
      return (
        <g key={index} className="step-diagram__arrow">
          <path
            className="step-diagram__arc step-diagram__line--arrow"
            d={arcPathData({ ...arrow.out, from: trimmed.out.from }, project)}
            {...strokeAttributes('arrow', project.ink, project.dashScale)}
          />
          <path
            className="step-diagram__arc step-diagram__line--arrow"
            d={arcPathData({ ...arrow.back, to: trimmed.back.to }, project)}
            {...strokeAttributes('arrow', project.ink, project.dashScale)}
          />
          <polygon
            className="step-diagram__arrowhead"
            points={arrowheadPoints(tip, arcEndDirection(tipArc, project), head)}
          />
        </g>
      );
    }
    case 'turn-over': {
      const at = project(primitive.at);
      const scale = (DIAGRAM_TURN_OVER_INK * project.ink) / TURN_OVER_BOX.width;
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
          r={DIAGRAM_MARK_INK.radius * project.ink}
          strokeWidth={DIAGRAM_MARK_INK.width * project.ink}
        />
      );
    }
    case 'label': {
      // Placed against the whole picture, not this primitive alone. Absent
      // only when the context was built from a different list than the one
      // being drawn, which is a caller's bug; a letter with no place is not
      // drawn somewhere wrong.
      const placement = context.labels.get(index);
      if (!placement) return null;
      return (
        <text
          key={index}
          className={`step-diagram__label step-diagram__label--${primitive.style}`}
          x={placement.x}
          y={placement.y}
          textAnchor={placement.anchor}
          fontSize={DIAGRAM_LABEL_INK.size * project.ink}
          strokeWidth={DIAGRAM_LABEL_INK.halo * project.ink}
        >
          {primitive.text}
        </text>
      );
    }
  }
  return null;
}
