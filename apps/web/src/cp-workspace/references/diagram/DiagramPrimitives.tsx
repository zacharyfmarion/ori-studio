import type { ReactNode } from 'react';
import type {
  DiagramProjector,
  DiagramSheet,
  SheetPoint,
  SvgPoint,
} from '../stepDiagramGeometry';
import {
  ROTATE_FRACTION,
  TURN_OVER_HEAD_PATH,
  TURN_OVER_PATH,
  arcPathData,
  arrowheadPath,
  angleMarkDrawn,
  angleMarkPathData,
  cubicPathData,
  erodeCreaseOnSheet,
  foldArrowDrawn,
  halfArrowheadPath,
  offPaperPathData,
  oneWayArrowDrawn,
  paperRingPoints,
  pathArrowDrawn,
  pleatArrowDrawn,
  polygonPathData,
  polylinePathData,
  pushArrowDrawn,
  rightAngleDrawn,
  rotateGlyphDrawn,
  sheetCorners,
  turnOverDrawn,
  whiteArrowDrawn,
  WHITE_ARROW_MITER_LIMIT,
} from '../stepDiagramGeometry';
import type {
  DiagramLineStyleName,
  StepDiagramPrimitive,
} from '../referenceFinderDiagramToPrimitives';
import type { DiagramInlineInk, DiagramInlineStroke } from './diagramColors';
import {
  DIAGRAM_LABEL_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_ROTATE_INK,
  DIAGRAM_SHEET_INK,
  type DiagramPens,
} from './diagramInk';
import {
  diagramMarks,
  markRingWidth,
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
 *
 * A mark that can leave the paper — an arrow, the turn-over glyph, a ring —
 * is drawn twice, through a clip of the paper and a clip of everything else,
 * so it is in the style's ink on the sheet and in one that reads on the
 * ground off it ({@link canLeavePaper}). A drawing is put in its document
 * by {@link diagramShapes}, which carries the clip pair with the shapes.
 */

/** The font a letter is set in when the picture leaves the app: the app's own stack, named. */
export const INLINE_LABEL_FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';

/** Where the fraction's baseline sits below the glyph's centre, in ems: a figure's middle on the centre. */
const ROTATE_FRACTION_BASELINE = 0.36;

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
   * The outline the paper is filled with, in the projector's units: what a
   * letter's halo is painted to match when the letter stands on it, and what
   * a mark that can leave the paper is clipped to (X11 of the paper export
   * plan). The card's sheet rectangle; the big view's hull of the border
   * creases, which the canvas fills.
   */
  paper: readonly SvgPoint[];
  /**
   * The ids of the clip pair that a mark which can leave the paper is drawn
   * through — the paper, and everything else — or null when there is no
   * paper to clip to, and every mark is on the ground.
   */
  clip: DiagramPaperClip | null;
  /**
   * The picture is of the paper's back: which face the sheet is filled with,
   * and the halo of a letter that stands on it. Not the projector's
   * `mirrored`, which is a handedness for an arc's sweep and agrees with the
   * face only through a card's fit (`DiagramRenderOptions.back`).
   */
  back: boolean;
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

/** The `id`s of the two clip paths a drawing's marks are drawn through. */
export interface DiagramPaperClip {
  /** The paper. */
  inside: string;
  /** Everything but the paper. */
  outside: string;
}

/** What else a drawing is made with, beyond its primitives, its sheet and its projector. */
export interface DiagramRenderOptions {
  /** Where the letters may go: the box they are held in and the corners kept clear. */
  layout?: LabelLayoutOptions;
  creases?: DiagramCreaseOptions;
  /** The colours as attributes, for a file; absent or null on screen. */
  inline?: DiagramInlineInk | null;
  /**
   * The outline the paper is filled with, in the primitives' own space.
   * Absent, the sheet's rectangle (`sheetCorners`) — what a card fills. The big
   * view passes the hull the canvas fills (`sheetOutline`), so a letter's halo
   * and a mark's ink agree with the paper the reader sees.
   */
  outline?: readonly SheetPoint[];
  /**
   * What the clip pair's ids are made from. On screen, a React id: every card
   * and the big view share one document, and a `url(#…)` finds the first
   * element of its id there. Absent, one read off the paper's outline, so two
   * drawings that happen to share an id share its geometry too.
   */
  id?: string;
  /**
   * The picture is of the paper's back. Absent, read off the projector, which
   * is right for a card's fit (`createDiagramProjector` flips y, so its
   * handedness is the face). A projector onto the canvas's model space is not:
   * that frame is left-handed already (`frame.rs`), so its `mirrored` is true
   * on the front — the big view and a step's export say which face instead.
   */
  back?: boolean;
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
  options: DiagramRenderOptions = {}
): DiagramRenderContext {
  const paper = (options.outline ?? sheetCorners(sheet)).map((corner) => project(corner));
  const id = safeId(options.id ?? `step-diagram-${outlineHash(paper)}`);
  return {
    project,
    marks: diagramMarks(primitives, project),
    labels: placeLabels(primitives, sheet, project, options.layout ?? {}),
    sheet,
    paper,
    clip: paper.length >= 3 ? { inside: `${id}-paper`, outside: `${id}-ground` } : null,
    back: options.back ?? project.mirrored,
    creases: options.creases ?? DEFAULT_DIAGRAM_CREASES,
    inline: options.inline ?? null,
  };
}

/** An id as `url(#…)` takes it anywhere: React's own carry characters a selector does not. */
function safeId(id: string): string {
  return id.replace(/[^\w-]/g, '');
}

/** A short name for an outline, the same for the same outline (FNV-1a over its points). */
function outlineHash(paper: readonly SvgPoint[]): string {
  let hash = 0x811c9dc5;
  for (const char of paperRingPoints(paper)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Whether a primitive is a mark that can leave the paper: a fold arrow, a
 * line or arc in the arrow's pen, the turn-over glyph, a ring. These draw in
 * the style's ink on the paper and in the ground's off it (X11 of the paper
 * export plan). Letters have their own rule (their halo, {@link labelOnPaper});
 * creases and edges lie on the paper by definition.
 */
export function canLeavePaper(primitive: StepDiagramPrimitive): boolean {
  switch (primitive.kind) {
    case 'fold-arrow':
    case 'one-way-arrow':
    case 'path-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'rotate':
    case 'turn-over':
    case 'right-angle':
    case 'angle-mark':
    case 'point':
      return true;
    case 'line':
    case 'arc':
      return primitive.style === 'arrow';
    default:
      return false;
  }
}

/**
 * The inline ink a mark draws in off the paper: the arrow's and the ring's
 * ground inks in place of the paper's.
 */
function offPaperInk(ink: DiagramInlineInk): DiagramInlineInk {
  return {
    ...ink,
    lines: { ...ink.lines, arrow: { ...ink.lines.arrow, color: ink.ground.arrow } },
    arrowhead: ink.ground.arrow,
    mark: ink.ground.mark,
  };
}

/** A file whose ground takes every mark's own ink: one copy of each is the whole picture. */
function oneInk(ink: DiagramInlineInk): boolean {
  return ink.ground.arrow === ink.arrowhead && ink.ground.mark === ink.mark;
}

/** How much of a drawing a caller draws, and how ({@link diagramShapes}). */
export interface DiagramShapesOptions {
  /**
   * Which primitives to draw, in this order: indices into the list the
   * context was built from, which is what its letters are keyed by. All of
   * them when absent.
   */
  indices?: readonly number[];
  /**
   * The paper as rings, when it is more than the context's outline: the layer
   * over the canvas adds the flap a fold has lifted ({@link diagramPaperClipDefs}).
   */
  rings?: readonly (readonly SvgPoint[])[];
  /** A shape inside a group of the caller's: the layer tags each with the flap it rides. */
  wrap?: (shape: ReactNode, index: number) => ReactNode;
}

/**
 * A drawing's shapes, after the clip pair their marks are drawn through.
 *
 * The one way to draw them. A mark that can leave the paper names its clips
 * by `url(#…)`, and a reference to a clip the document does not hold is not
 * an error anywhere: a browser draws both copies unclipped, one over the
 * other. So the clips and the shapes that name them are put in the document
 * together, here, by the card, the layer over the canvas and a step's export
 * alike.
 */
export function diagramShapes(
  primitives: readonly StepDiagramPrimitive[],
  context: DiagramRenderContext,
  { indices, rings, wrap }: DiagramShapesOptions = {}
): ReactNode {
  const drawn = indices ?? primitives.map((_, index) => index);
  const defs = diagramPaperClipDefs(
    drawn.map((index) => primitives[index]!),
    context,
    rings
  );
  const shapes = drawn.map((index) => {
    const shape = diagramPrimitiveShape(primitives[index]!, index, context);
    return wrap ? wrap(shape, index) : shape;
  });
  return (
    <>
      {defs}
      {shapes}
    </>
  );
}

/**
 * The clip pair a drawing's marks are drawn through, as `<defs>`: the paper,
 * and everything else. Null when none of `primitives` needs it — no mark, no
 * paper, or a file whose ground takes the marks' own inks.
 *
 * `rings` is the paper when it is more than the context's outline: the layer
 * over the canvas adds the flap a fold has lifted, which is paper wherever it
 * goes. Each ring is a polygon in the clip, so the paper is their union; the
 * rest is one evenodd path, whose double-counted overlap the paper's copy of
 * each mark, drawn on top, covers ({@link offPaperPathData}).
 */
function diagramPaperClipDefs(
  primitives: readonly StepDiagramPrimitive[],
  context: DiagramRenderContext,
  rings: readonly (readonly SvgPoint[])[] = [context.paper]
): ReactNode {
  const { clip, inline } = context;
  if (!clip || (inline && oneInk(inline)) || !primitives.some(canLeavePaper)) return null;
  return (
    <defs>
      <clipPath id={clip.inside}>
        {rings.map((ring, index) => (
          <polygon key={index} points={paperRingPoints(ring)} />
        ))}
      </clipPath>
      <clipPath id={clip.outside}>
        <path d={offPaperPathData(rings)} clipRule="evenodd" />
      </clipPath>
    </defs>
  );
}

/**
 * A mark that can leave the paper, drawn in both its inks: once through
 * everything but the paper, in the ground's ink, and once over it through the
 * paper, in its own. On screen the first copy's group carries the class that
 * gives it the theme's ink; in a file its attributes carry the ground's.
 *
 * With no paper to clip to, the mark is all ground. In a file whose ground
 * takes the mark's own ink, one copy is the whole of it, and the markup is
 * what it was before there were two.
 */
function onAndOffPaper(
  context: DiagramRenderContext,
  index: number,
  draw: (context: DiagramRenderContext) => ReactNode
): ReactNode {
  const { clip, inline } = context;
  if (inline && oneInk(inline)) return draw(context);
  const off = inline ? { ...context, inline: offPaperInk(inline) } : context;
  const ground = inked(context, 'step-diagram__ground', () => ({}));
  if (!clip) {
    return (
      <g key={index} {...ground}>
        {draw(off)}
      </g>
    );
  }
  return (
    <g key={index}>
      <g {...ground} clipPath={`url(#${clip.outside})`}>
        {draw(off)}
      </g>
      <g clipPath={`url(#${clip.inside})`}>{draw(context)}</g>
    </g>
  );
}

/**
 * Whether a letter stands on the paper: its box's middle inside the paper's
 * outline. The outline is convex, so the middle is inside when it is on the
 * same side of every edge, whichever way round the projector winds it.
 */
export function labelOnPaper(box: LabelPlacement['box'], paper: readonly SvgPoint[]): boolean {
  if (paper.length < 3) return false;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  let sign = 0;
  for (let i = 0; i < paper.length; i += 1) {
    const a = paper[i]!;
    const b = paper[(i + 1) % paper.length]!;
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
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

/**
 * One primitive's shape. Drawn through {@link diagramShapes}, which puts the
 * clips it names beside it.
 */
function diagramPrimitiveShape(
  primitive: StepDiagramPrimitive,
  index: number,
  context: DiagramRenderContext
): ReactNode {
  // The face, which the sheet is filled with and a letter on it is haloed
  // in — not the projector's handedness (`DiagramRenderContext.back`).
  const { project, back } = context;
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
            back ? 'step-diagram__sheet step-diagram__sheet--back' : 'step-diagram__sheet',
            (ink) => ({ fill: back ? ink.sheet.back : ink.sheet.front, stroke: ink.sheet.stroke })
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
      const draw = (inks: DiagramRenderContext) => (
        <line
          key={index}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          strokeDashoffset={dashOffset}
          {...stroke}
          {...inked(inks, `step-diagram__line step-diagram__line--${primitive.style}`, (ink) =>
            strokeInk(ink.lines[primitive.style], stroke.strokeOpacity)
          )}
        />
      );
      return canLeavePaper(primitive) ? onAndOffPaper(context, index, draw) : draw(context);
    }
    case 'arc': {
      const stroke = strokeAttributes(primitive.style, project.ink, project.dashScale, project.pens);
      const draw = (inks: DiagramRenderContext) => (
        <path
          key={index}
          d={arcPathData(primitive, project)}
          {...stroke}
          {...inked(inks, `step-diagram__arc step-diagram__line--${primitive.style}`, (ink) =>
            strokeInk(ink.lines[primitive.style], stroke.strokeOpacity)
          )}
        />
      );
      return canLeavePaper(primitive) ? onAndOffPaper(context, index, draw) : draw(context);
    }
    case 'fold-arrow': {
      const arrow = foldArrowDrawn(primitive.out, project, context.marks);
      if (!arrow) return null;
      const stroke = strokeAttributes('arrow', project.ink, project.dashScale, project.pens);
      const outPath = arcPathData(arrow.out, project);
      const backPath = arcPathData(arrow.back, project);
      // On the return's end and along it, so the stroke runs into the notch
      // and its cap is buried in the head.
      const headPath = arrowheadPath(arrow.head);
      return onAndOffPaper(context, index, (inks) => {
        const arrowInk = inked(inks, 'step-diagram__arc step-diagram__line--arrow', (ink) =>
          strokeInk(ink.lines.arrow, stroke.strokeOpacity)
        );
        return (
          <g key={index} {...inked(inks, 'step-diagram__arrow', () => ({}))}>
            <path d={outPath} {...stroke} {...arrowInk} />
            <path d={backPath} {...stroke} {...arrowInk} />
            <path
              d={headPath}
              {...inked(inks, 'step-diagram__arrowhead', (ink) => ({ fill: ink.arrowhead }))}
            />
          </g>
        );
      });
    }
    case 'one-way-arrow': {
      // The fold arrow's head and its landing on a mark; no return.
      const arrow = oneWayArrowDrawn(primitive.out, project, context.marks);
      const stroke = strokeAttributes('arrow', project.ink, project.dashScale, project.pens);
      const centre = project(primitive.out.center);
      return onAndOffPaper(context, index, (inks) => {
        const arrowInk = inked(inks, 'step-diagram__arc step-diagram__line--arrow', (ink) =>
          strokeInk(ink.lines.arrow, stroke.strokeOpacity)
        );
        return (
          <g key={index} {...inked(inks, 'step-diagram__arrow', () => ({}))}>
            {arrow.shaft && <path d={arcPathData(arrow.shaft, project)} {...stroke} {...arrowInk} />}
            {primitive.fold === 'valley' ? (
              <path
                d={arrowheadPath(arrow.head)}
                {...inked(inks, 'step-diagram__arrowhead', (ink) => ({ fill: ink.arrowhead }))}
              />
            ) : (
              // A mountain fold's head is an outline, in the shaft's pen but solid.
              <path
                d={halfArrowheadPath(arrow.head, centre)}
                {...stroke}
                strokeDasharray={undefined}
                strokeLinejoin="miter"
                {...arrowInk}
              />
            )}
          </g>
        );
      });
    }
    case 'path-arrow': {
      // The arc arrows' rules, along a path: see `pathArrowGeometry`.
      const arrow = pathArrowDrawn(primitive.path, primitive.fold, project, context.marks);
      if (!arrow) return null;
      const stroke = strokeAttributes('arrow', project.ink, project.dashScale, project.pens);
      return onAndOffPaper(context, index, (inks) => {
        const arrowInk = inked(inks, 'step-diagram__arc step-diagram__line--arrow', (ink) =>
          strokeInk(ink.lines.arrow, stroke.strokeOpacity)
        );
        return (
          <g key={index} {...inked(inks, 'step-diagram__arrow', () => ({}))}>
            {arrow.shaft && <path d={cubicPathData(arrow.shaft)} {...stroke} {...arrowInk} />}
            {arrow.back && <path d={polylinePathData(arrow.back)} {...stroke} {...arrowInk} />}
            {primitive.fold === 'mountain' ? (
              // A mountain fold's head is an outline, in the shaft's pen but solid.
              <path
                d={halfArrowheadPath(arrow.head, arrow.inside)}
                {...stroke}
                strokeDasharray={undefined}
                strokeLinejoin="miter"
                {...arrowInk}
              />
            ) : (
              <path
                d={arrowheadPath(arrow.head)}
                {...inked(inks, 'step-diagram__arrowhead', (ink) => ({ fill: ink.arrowhead }))}
              />
            )}
          </g>
        );
      });
    }
    case 'pleat-arrow': {
      // A lightning bolt in the arrow's pen, solid, its Zs mitred sharp, and
      // the valley arrow's head on its last run.
      const arrow = pleatArrowDrawn(primitive.from, primitive.to, primitive.kinks, primitive.mirrored, project);
      if (!arrow) return null;
      const stroke = strokeAttributes('arrow', project.ink, 1, project.pens);
      const shaft = arrow.shaft && polylinePathData(arrow.shaft.map(({ x, y }) => [x, y] as const));
      return onAndOffPaper(context, index, (inks) => (
        <g key={index} {...inked(inks, 'step-diagram__arrow', () => ({}))}>
          {shaft && (
            <path
              d={shaft}
              fill="none"
              {...stroke}
              strokeDasharray={undefined}
              strokeLinejoin="miter"
              {...inked(inks, 'step-diagram__arc step-diagram__line--arrow', (ink) =>
                strokeInk(ink.lines.arrow, stroke.strokeOpacity)
              )}
            />
          )}
          <path
            d={arrowheadPath(arrow.head)}
            {...inked(inks, 'step-diagram__arrowhead', (ink) => ({ fill: ink.arrowhead }))}
          />
        </g>
      ));
    }
    case 'push-arrow': {
      const outline = pushArrowDrawn(primitive.from, primitive.to, project);
      if (!outline) return null;
      const d = polygonPathData(outline);
      const stroke = strokeAttributes('arrow', project.ink, 1, project.pens);
      // Hollow: the paper's face inside, so a line under it does not run
      // through the shape, and the outline in the arrow's pen, solid.
      return onAndOffPaper(context, index, (inks) => (
        <g key={index} {...inked(inks, 'step-diagram__arrow', () => ({}))}>
          <path
            d={d}
            stroke="none"
            {...inked(inks, back ? 'step-diagram__sheet step-diagram__sheet--back' : 'step-diagram__sheet', (sheet) => ({
              fill: back ? sheet.sheet.back : sheet.sheet.front,
            }))}
          />
          <path
            d={d}
            {...stroke}
            strokeDasharray={undefined}
            strokeLinejoin="miter"
            {...inked(inks, 'step-diagram__arc step-diagram__line--arrow', (line) =>
              strokeInk(line.lines.arrow, stroke.strokeOpacity)
            )}
          />
        </g>
      ));
    }
    case 'white-arrow': {
      const outline = whiteArrowDrawn(primitive.path, primitive.width, primitive.tail, project);
      if (!outline) return null;
      const d = polygonPathData(outline);
      const stroke = strokeAttributes('arrow', project.ink, 1, project.pens);
      // A push arrow's look along a path: hollow, the paper's face inside, the
      // outline in the arrow's pen, solid — mitred to the white arrow's own
      // limit, which its outline's corners were shaped to.
      return onAndOffPaper(context, index, (inks) => (
        <g key={index} {...inked(inks, 'step-diagram__arrow', () => ({}))}>
          <path
            d={d}
            stroke="none"
            {...inked(inks, back ? 'step-diagram__sheet step-diagram__sheet--back' : 'step-diagram__sheet', (sheet) => ({
              fill: back ? sheet.sheet.back : sheet.sheet.front,
            }))}
          />
          <path
            d={d}
            {...stroke}
            strokeDasharray={undefined}
            strokeLinejoin="miter"
            strokeMiterlimit={WHITE_ARROW_MITER_LIMIT}
            {...inked(inks, 'step-diagram__arc step-diagram__line--arrow', (line) =>
              strokeInk(line.lines.arrow, stroke.strokeOpacity)
            )}
          />
        </g>
      ));
    }
    case 'rotate': {
      const glyph = rotateGlyphDrawn(primitive.at, primitive.direction, project);
      const { centre } = glyph;
      const stroke = strokeAttributes('arrow', project.ink, 1, project.pens);
      const size = DIAGRAM_ROTATE_INK.fraction * project.ink;
      return onAndOffPaper(context, index, (inks) => {
        const arrowInk = inked(inks, 'step-diagram__arc step-diagram__line--arrow', (ink) =>
          strokeInk(ink.lines.arrow, stroke.strokeOpacity)
        );
        const headInk = inked(inks, 'step-diagram__arrowhead', (ink) => ({ fill: ink.arrowhead }));
        return (
          <g key={index} {...inked(inks, 'step-diagram__rotate', () => ({}))}>
            {glyph.strokes.map((d, part) => (
              <path key={`stroke-${part}`} d={d} {...stroke} strokeDasharray={undefined} {...arrowInk} />
            ))}
            {glyph.heads.map((arrowhead, part) => (
              <path key={`head-${part}`} d={arrowheadPath(arrowhead)} {...headInk} />
            ))}
            <text
              x={round(centre.x)}
              y={round(centre.y + ROTATE_FRACTION_BASELINE * size)}
              textAnchor="middle"
              fontSize={round(size)}
              {...inked(inks, 'step-diagram__rotate-fraction', (ink) => ({
                fill: ink.arrowhead,
                fontFamily: INLINE_LABEL_FONT,
                fontWeight: 700,
              }))}
            >
              {ROTATE_FRACTION[primitive.amount]}
            </text>
          </g>
        );
      });
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
      // Drawn in screen space, not mirrored with the paper: it is a
      // symbol for what the folder does, not part of the pattern.
      const glyph = turnOverDrawn(primitive.at, primitive.axis, project);
      const stroke = strokeAttributes('arrow', project.ink / glyph.scale, 1, project.pens);
      // The clip is outside the glyph's own transform, in the drawing's units
      // like the paper's outline, so the glyph's group sits inside each copy.
      return onAndOffPaper(context, index, (inks) => (
        <g
          key={index}
          {...inked(inks, 'step-diagram__turn-over', () => ({}))}
          transform={glyph.transform}
        >
          <path
            d={TURN_OVER_PATH}
            {...stroke}
            {...inked(inks, 'step-diagram__arc step-diagram__line--arrow', (ink) =>
              strokeInk(ink.lines.arrow, stroke.strokeOpacity)
            )}
          />
          <path
            d={TURN_OVER_HEAD_PATH}
            {...inked(inks, 'step-diagram__arrowhead', (ink) => ({ fill: ink.arrowhead }))}
          />
        </g>
      ));
    }
    case 'right-angle': {
      // An open square in the corner (decision 11 of the Annotate plan): its
      // two legs in a ring's pen and ink, solid, ending square on the lines it
      // marks and mitred at its own corner — set here, as whatever it is drawn
      // in may join round.
      const legs = rightAngleDrawn(primitive.at, primitive.toward, project);
      if (!legs) return null;
      const d = polylinePathData(legs.map(({ x, y }) => [x, y] as const));
      return onAndOffPaper(context, index, (inks) => (
        <path
          key={index}
          d={d}
          strokeWidth={markRingWidth(project)}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          {...inked(inks, 'step-diagram__point step-diagram__right-angle', (ink) => ({
            fill: 'none',
            stroke: ink.mark,
          }))}
        />
      ));
    }
    case 'angle-mark': {
      // An arc across the angle and ticks across its halves (15b of the
      // second Annotate plan), in a ring's pen and ink, as a right angle is.
      const shape = angleMarkDrawn(primitive.at, primitive.arms, primitive.ticks, project);
      if (!shape) return null;
      const d = angleMarkPathData(shape);
      return onAndOffPaper(context, index, (inks) => (
        <path
          key={index}
          d={d}
          strokeWidth={markRingWidth(project)}
          strokeLinecap="butt"
          {...inked(inks, 'step-diagram__point step-diagram__angle-mark', (ink) => ({
            fill: 'none',
            stroke: ink.mark,
          }))}
        />
      ));
    }
    case 'point': {
      const at = project(primitive.at);
      return onAndOffPaper(context, index, (inks) => (
        <circle
          key={index}
          cx={at.x}
          cy={at.y}
          r={project.marks.ringRadius * project.ink}
          strokeWidth={markRingWidth(project)}
          {...inked(inks, `step-diagram__point step-diagram__point--${primitive.style}`, (ink) => ({
            fill: 'none',
            stroke: ink.mark,
          }))}
        />
      ));
    }
    case 'label': {
      // Placed against the whole picture, not this primitive alone. Absent
      // only when the context was built from a different list than the one
      // being drawn, which is a caller's bug; a letter with no place is not
      // drawn somewhere wrong.
      const placement = context.labels.get(index);
      if (!placement) return null;
      // The halo is what the letter stands on: the paper, on the face the
      // picture shows, or the ground round it where a letter was pushed off
      // the sheet — so it reads as a knock-out, never as a ring.
      const onPaper = labelOnPaper(placement.box, context.paper);
      const ground = onPaper
        ? back
          ? ' step-diagram__label--on-back'
          : ' step-diagram__label--on-paper'
        : '';
      return (
        <text
          key={index}
          x={placement.x}
          y={placement.y}
          textAnchor={placement.anchor}
          fontSize={project.marks.labelSize * project.ink}
          strokeWidth={DIAGRAM_LABEL_INK.halo * project.ink}
          {...inked(context, `step-diagram__label step-diagram__label--${primitive.style}${ground}`, (ink) => ({
            fill: ink.label.fill[primitive.style],
            stroke: onPaper ? (back ? ink.sheet.back : ink.sheet.front) : ink.label.halo,
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
  // Every kind is drawn above: a new one is a compile error here until it is,
  // rather than a shape that silently draws nothing.
  const _undrawn: never = primitive;
  return null;
}
