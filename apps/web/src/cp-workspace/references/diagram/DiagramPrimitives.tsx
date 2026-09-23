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
  erodeCreaseOnSheet,
  foldAndUnfoldFromArc,
  foldArrowLanding,
  foldArrowTrim,
} from '../stepDiagramGeometry';
import type {
  DiagramLineStyleName,
  StepDiagramPrimitive,
} from '../referenceFinderDiagramToPrimitives';
import type { DiagramInlineInk, DiagramInlineStroke } from './diagramColors';
import {
  DIAGRAM_LABEL_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_SHEET_INK,
  DIAGRAM_TURN_OVER_INK,
  type DiagramPens,
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
 * pattern projects through the live camera; a step's export paints the same
 * shapes into a file. Same shapes, same pen — only the projector differs,
 * which is the whole reason a step is described as primitives rather than
 * drawn twice. On screen a shape carries a class and `theme.css` colours it;
 * in a file there is no stylesheet, so the context carries the colours
 * instead (`DiagramRenderContext.inline`) and the shape writes them as
 * attributes with no class at all.
 */

/** The font a letter is set in when the picture leaves the app: the app's own stack, named. */
const INLINE_LABEL_FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';

/** Four decimals is under a device pixel at any size this is drawn at. */
const round = (value: number) => Number(value.toFixed(4));

/**
 * A line style's geometry as SVG attributes, in the drawing's own units.
 *
 * `ink` is the pen — see `diagramInk.ts`. Emitted here rather than left in the
 * stylesheet because a stylesheet cannot know how big the drawing is, and that
 * is exactly what these numbers depend on. `dashScale` is the projector's
 * (`DiagramProjector.dashScale`), and shortens the runs alone: the width is
 * the line's weight and stays the pen's. `pens` is the projector's table too
 * (`DiagramProjector.pens`); the card's is the one in `diagramInk.ts`.
 */
export function strokeAttributes(
  style: DiagramLineStyleName,
  ink: number,
  dashScale = 1,
  pens: DiagramPens = DIAGRAM_LINE_INK
) {
  const pen = pens[style];
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
  /** The paper the primitives were measured against; where erode finds its edge. */
  sheet: DiagramSheet;
  /**
   * What the paper style says about the lines drawn in its aux pen — the
   * creases an earlier step made (`crease`) and the pattern's own aux lines
   * (`aux`): whether the aux lines are drawn, and how far either is pulled
   * back from the sheet's edge as a fraction of the sheet (D8).
   */
  creases: DiagramCreaseOptions;
  /**
   * The colours as attributes, for a picture no stylesheet reaches. Null on
   * screen, where every shape carries its class and `theme.css` colours it.
   */
  inline: DiagramInlineInk | null;
}

export interface DiagramCreaseOptions {
  /**
   * Whether the pattern's aux lines are drawn (`referencesAuxCreases`). The
   * creases an earlier step made are the paper as it stands, and always are.
   */
  showAux: boolean;
  erode: number;
}

/** Drawn, at the edge: the diagrams before there was a style. */
export const DEFAULT_DIAGRAM_CREASES: DiagramCreaseOptions = { showAux: true, erode: 0 };

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
  layout: LabelLayoutOptions = {},
  creases: DiagramCreaseOptions = DEFAULT_DIAGRAM_CREASES,
  inline: DiagramInlineInk | null = null
): DiagramRenderContext {
  return {
    project,
    marks: diagramMarks(primitives, project),
    labels: placeLabels(primitives, sheet, project, layout),
    sheet,
    creases,
    inline,
  };
}

/**
 * A shape's class on screen, or its colours in a file: the one place the two
 * part, so every shape below says which class it would carry and which
 * attributes the class would have given it.
 */
function inked(
  context: DiagramRenderContext,
  className: string,
  attributes: (ink: DiagramInlineInk) => Record<string, string | number | undefined>
): Record<string, string | number | undefined> {
  return context.inline ? attributes(context.inline) : { className };
}

/** A stroke's colour and opacity as attributes, the pen's own opacity folded in. */
function strokeInk(stroke: DiagramInlineStroke, penOpacity: number | undefined) {
  const opacity = (stroke.opacity ?? 1) * (penOpacity ?? 1);
  return {
    fill: 'none',
    stroke: stroke.color,
    strokeOpacity: opacity === 1 ? undefined : opacity,
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
          {...inked(
            context,
            mirrored ? 'step-diagram__sheet step-diagram__sheet--back' : 'step-diagram__sheet',
            (ink) => ({ fill: mirrored ? ink.sheet.back : ink.sheet.front, stroke: ink.sheet.stroke })
          )}
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
      // A line in the aux pen is pulled back from the paper's edge, and the
      // pattern's own aux lines are the reader's to show or hide; every other
      // line is the step's own.
      let ends: [readonly [number, number], readonly [number, number]] | null = [
        primitive.from,
        primitive.to,
      ];
      if (primitive.style === 'crease' || primitive.style === 'aux') {
        if (primitive.style === 'aux' && !context.creases.showAux) return null;
        ends = erodeCreaseOnSheet(primitive.from, primitive.to, context.sheet, context.creases.erode);
        if (!ends) return null;
      }
      const from = project(ends[0]);
      const to = project(ends[1]);
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
      const stroke = strokeAttributes(primitive.style, project.ink, project.dashScale, project.pens);
      return (
        <line
          key={index}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          strokeDashoffset={dashOffset}
          {...stroke}
          {...inked(context, `step-diagram__line step-diagram__line--${primitive.style}`, (ink) =>
            strokeInk(ink.lines[primitive.style], stroke.strokeOpacity)
          )}
        />
      );
    }
    case 'arc': {
      const stroke = strokeAttributes(primitive.style, project.ink, project.dashScale, project.pens);
      return (
        <path
          key={index}
          d={arcPathData(primitive, project)}
          {...stroke}
          {...inked(context, `step-diagram__arc step-diagram__line--${primitive.style}`, (ink) =>
            strokeInk(ink.lines[primitive.style], stroke.strokeOpacity)
          )}
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
      const stroke = strokeAttributes('arrow', project.ink, project.dashScale, project.pens);
      const arrowInk = inked(context, 'step-diagram__arc step-diagram__line--arrow', (ink) =>
        strokeInk(ink.lines.arrow, stroke.strokeOpacity)
      );
      const headInk = inked(context, 'step-diagram__arrowhead', (ink) => ({ fill: ink.arrowhead }));
      return (
        <g key={index} {...inked(context, 'step-diagram__arrow', () => ({}))}>
          <path
            d={arcPathData({ ...arrow.out, from: trimmed.out.from }, project)}
            {...stroke}
            {...arrowInk}
          />
          <path
            d={arcPathData({ ...arrow.back, to: trimmed.back.to }, project)}
            {...stroke}
            {...arrowInk}
          />
          <polygon
            points={arrowheadPoints(tip, arcEndDirection(tipArc, project), head)}
            {...headInk}
          />
        </g>
      );
    }
    case 'region': {
      // Under the lines, over the paper: a fill, no stroke, so the band reads
      // as a stretch of the sheet and not as one more crease.
      const points = primitive.corners
        .map((corner) => project(corner))
        .map((p) => `${round(p.x)},${round(p.y)}`)
        .join(' ');
      return (
        <polygon
          key={index}
          points={points}
          {...inked(context, 'step-diagram__region', (ink) => ({
            fill: ink.region.fill,
            fillOpacity: ink.region.opacity,
            stroke: 'none',
          }))}
        />
      );
    }
    case 'turn-over': {
      const at = project(primitive.at);
      const scale = (DIAGRAM_TURN_OVER_INK * project.ink) / TURN_OVER_BOX.width;
      // Drawn in screen space, not mirrored with the paper: it is a
      // symbol for what the folder does, not part of the pattern.
      const x = at.x - (TURN_OVER_BOX.width / 2) * scale;
      const y = at.y - (TURN_OVER_BOX.height / 2) * scale;
      const stroke = strokeAttributes('arrow', project.ink / scale, 1, project.pens);
      return (
        <g
          key={index}
          {...inked(context, 'step-diagram__turn-over', () => ({}))}
          transform={`translate(${round(x)} ${round(y)}) scale(${round(scale)})`}
        >
          <path
            d={TURN_OVER_PATH}
            {...stroke}
            {...inked(context, 'step-diagram__arc step-diagram__line--arrow', (ink) =>
              strokeInk(ink.lines.arrow, stroke.strokeOpacity)
            )}
          />
          <polygon
            points={arrowheadPoints(
              { x: TURN_OVER_HEAD.at[0], y: TURN_OVER_HEAD.at[1] },
              { x: Math.cos(TURN_OVER_HEAD.angle), y: Math.sin(TURN_OVER_HEAD.angle) },
              TURN_OVER_HEAD.size
            )}
            {...inked(context, 'step-diagram__arrowhead', (ink) => ({ fill: ink.arrowhead }))}
          />
        </g>
      );
    }
    case 'point': {
      const at = project(primitive.at);
      return (
        <circle
          key={index}
          cx={at.x}
          cy={at.y}
          r={DIAGRAM_MARK_INK.radius * project.ink}
          strokeWidth={DIAGRAM_MARK_INK.width * project.ink}
          {...inked(context, `step-diagram__point step-diagram__point--${primitive.style}`, (ink) => ({
            fill: 'none',
            stroke: ink.mark,
          }))}
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
          x={placement.x}
          y={placement.y}
          textAnchor={placement.anchor}
          fontSize={DIAGRAM_LABEL_INK.size * project.ink}
          strokeWidth={DIAGRAM_LABEL_INK.halo * project.ink}
          {...inked(context, `step-diagram__label step-diagram__label--${primitive.style}`, (ink) => ({
            fill: ink.label.fill[primitive.style],
            stroke: ink.label.halo,
            strokeLinejoin: 'round',
            paintOrder: 'stroke',
            fontFamily: INLINE_LABEL_FONT,
            fontWeight: 700,
          }))}
        >
          {primitive.text}
        </text>
      );
    }
  }
  return null;
}
