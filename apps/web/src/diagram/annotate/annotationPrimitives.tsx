/**
 * Annotations compiled for drawing (D8): each time a picture is painted, at
 * the size it is painted at, into the vocabulary References draws its steps
 * in, so an annotation's arrow is References' arrow.
 *
 * - A valley, mountain or hidden line is a paper line in the role
 *   `diagram-valley`, `diagram-mountain` or `diagram-hidden`, drawn in the
 *   style's pens as a step's own lines are.
 * - A fold arrow, a push, the turn-over and rotate glyphs are step-diagram
 *   primitives drawn by `diagramShapes`, in the style's arrow ink, with no
 *   paper to clip to: an annotation is the author's own mark, one ink
 *   wherever it lies.
 * - A circle is References' ring round a point (`point`, highlight), in the
 *   annotation pen — three quarters of the style's arrow pen, in its ink
 *   (decision 7) — so an arrow that lands on it stops at its rim, as
 *   References' do.
 * - A label is a line of text at a fixed share of the frame, its runs in the
 *   diagram's fonts as an upload's text is (`uploadText.ts`), so a page sets
 *   and embeds it the same way.
 *
 * The drawing is in CSS px, the frame's top-left at the origin, its longer
 * side `framePx` across — the size it prints at — so its marks have the
 * weight References' have at that size; a surface places it with a uniform
 * scale and a shift. Each annotation is compiled once, in picture units
 * (`compiledAnnotation`), and every drawing of it — the canvas at each step
 * of a drag, a card, a page — scales that.
 *
 * Pure: no DOM, no store.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  INLINE_LABEL_FONT,
  createDiagramRenderContext,
  diagramShapes,
  type DiagramRenderContext,
} from '../../cp-workspace/references/diagram/DiagramPrimitives';
import { diagramInlineInk, type DiagramInlineInk } from '../../cp-workspace/references/diagram/diagramColors';
import { markOuterRadius } from '../../cp-workspace/references/diagram/labelLayout';
import {
  canvasDiagramInk,
  canvasDiagramPens,
  penInk,
} from '../../cp-workspace/references/diagram/diagramInk';
import type { StepDiagramPrimitive } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import {
  arcPolyline,
  arcPolylineDeviation,
  arcThroughPoints,
  arrowheadExtent,
  createOverlayProjector,
  foldArrowDrawn,
  mitredCornerReach,
  oneWayArrowDrawn,
  pathArrowDrawn,
  pushArrowDrawn,
  rotateGlyphDrawn,
  turnOverDrawn,
  type Arrowhead,
  type DiagramArc,
  type PathArrowFold,
} from '../../cp-workspace/references/stepDiagramGeometry';
import { flattenPath } from '../../lib/cubicBezier';
import { referencesPaperTokens } from '../../cp-workspace/references/usePaperStyleTokens';
import type { PaperItem, PaperLineItem, PaperLineRole, PaperScene } from '../../lib/paper/paperScene';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { graphemesOf } from '../../lib/paper/textWrap';
import { REFERENCE_COLORS } from '../../themes/applyTheme';
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramHanStyle,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { scriptFonts, textCjkKey } from '../fonts/fontScripts';
import { diagramPaperStyle } from '../pictures/diagramPaperStyle';
import { STEP_DIAGRAM_LINE_WIDTH } from '../pictures/paintStepDiagram';
import { UPLOAD_HAN_KEY, uploadTextFamily, type UploadTextRun } from '../upload/uploadText';
import type { DiagramFontKey } from '../fonts/diagramFontFaces';
import {
  arrowApex,
  arrowShape,
  LABEL_SIZE,
  labelHalfWidth,
  pathCubics,
  pathLength,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import { perAnnotation } from './perAnnotation';

/** Where a label's baseline sits below its point, in ems: a capital's middle on the point. */
const LABEL_BASELINE = 0.36;

/** A label as drawn: its centre, its size and its runs, each in its script's font. */
export interface AnnotationLabel {
  id: string;
  x: number;
  y: number;
  size: number;
  fill: string;
  runs: { family: string; text: string }[];
}

/** A line as drawn, in CSS px. */
export interface AnnotationLine {
  id: string;
  role: PaperLineRole;
  a: [number, number];
  b: [number, number];
}

/** The marks an annotation can be: the References primitives it compiles to. */
export type AnnotationPrimitive = Extract<
  StepDiagramPrimitive,
  { kind: 'fold-arrow' | 'one-way-arrow' | 'path-arrow' | 'push-arrow' | 'turn-over' | 'rotate' | 'point' }
>;

/**
 * One annotation compiled for drawing, in picture units — a mark in the
 * primitives' y-up space — so it is the same whatever size it is drawn at:
 * a line in its pen's role, a label's runs at its point, or a mark References
 * draws.
 */
export type CompiledAnnotation =
  | { kind: 'line'; role: PaperLineRole; from: PicturePoint; to: PicturePoint }
  | { kind: 'label'; at: PicturePoint; runs: { key: DiagramFontKey; text: string }[] }
  | { kind: 'mark'; primitive: AnnotationPrimitive };

/** The annotations ready to draw, on screen or into a file. */
export interface AnnotationDrawing {
  /** The frame, in CSS px: where the drawing's picture is. */
  width: number;
  height: number;
  lines: AnnotationLine[];
  /** The marks, in draw order, and the annotation each is. */
  primitives: AnnotationPrimitive[];
  primitiveIds: string[];
  context: DiagramRenderContext;
  labels: AnnotationLabel[];
}

/** The style an annotation's marks are drawn in: the diagram's, as References applies it. */
function seenStyle(style: DiagramStyle): PaperStyle {
  return applyPaperStylePolicy(diagramPaperStyle(style), PAPER_STYLE_POLICIES.references);
}

/** The page an annotation is printed on: a hollow push is this inside. */
const PAGE_GROUND = '#ffffff';

/**
 * The marks' colours as attributes: the style's arrow ink, one ink on and off
 * the paper, so nothing is clipped (`oneInk`) — a circle's ring too, which
 * References draws in the paper's edge ink: here it is the author's mark,
 * as the arrows are (decision 7). A hollow push is the page's white inside,
 * not the paper's face: there is no paper under an annotation to match, and
 * it may lie on a photo, on either face, or off the picture.
 */
function annotationInk(seen: PaperStyle): DiagramInlineInk {
  const ink = diagramInlineInk({
    ...referencesPaperTokens(seen),
    '--cp-reference-input': REFERENCE_COLORS.light.input,
    '--bg-primary': PAGE_GROUND,
  });
  return {
    ...ink,
    mark: ink.arrowhead,
    sheet: { ...ink.sheet, front: PAGE_GROUND, back: PAGE_GROUND },
    ground: { arrow: ink.arrowhead, mark: ink.arrowhead },
  };
}

/** The head a shaped fold arrow carries, by its kind. */
const PATH_FOLD = {
  'valley-arrow': 'valley',
  'mountain-arrow': 'mountain',
  'fold-unfold-arrow': 'fold-unfold',
} as const satisfies Record<string, PathArrowFold>;

/** Picture units to the primitives' y-up space, as References' unit frame is. */
const up = ([u, v]: readonly [number, number]): [number, number] => [u, -v];

/**
 * What an annotation is drawn as, or null when it draws nothing: an arrow too
 * short to have an arc, a label with no text. Every kind says which (a
 * switch, so a new kind is a compile error here until it does).
 */
function compileAnnotation(annotation: KnownDiagramAnnotation): CompiledAnnotation | null {
  const { from, to } = annotation;
  switch (annotation.kind) {
    case 'valley-line':
      return { kind: 'line', role: 'diagram-valley', from, to };
    case 'mountain-line':
      return { kind: 'line', role: 'diagram-mountain', from, to };
    case 'hidden-line':
      return { kind: 'line', role: 'diagram-hidden', from, to };
    case 'label': {
      const text = annotation.text ?? '';
      return text.trim() === '' ? null : { kind: 'label', at: from, runs: labelRuns(text) };
    }
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow': {
      const shape = arrowShape(annotation);
      if (shape.kind === 'path') {
        // A path of no length draws nothing, as an arc between two ends that meet does not.
        if (!(pathLength(shape.path) > 0)) return null;
        const path = pathCubics(shape.path).map(([a, b, c, d]) => [up(a), up(b), up(c), up(d)] as const);
        return { kind: 'mark', primitive: { kind: 'path-arrow', path, fold: PATH_FOLD[annotation.kind] } };
      }
      const out = arcThroughPoints(up(from), up(arrowApex(from, to, shape.bend)), up(to));
      if (!out) return null;
      return {
        kind: 'mark',
        primitive:
          annotation.kind === 'fold-unfold-arrow'
            ? { kind: 'fold-arrow', out }
            : { kind: 'one-way-arrow', out, fold: annotation.kind === 'valley-arrow' ? 'valley' : 'mountain' },
      };
    }
    case 'push-arrow':
      return { kind: 'mark', primitive: { kind: 'push-arrow', from: up(from), to: up(to) } };
    case 'turn-over':
      return { kind: 'mark', primitive: { kind: 'turn-over', at: up(from), axis: annotation.axis ?? 'vertical' } };
    case 'rotate':
      return {
        kind: 'mark',
        primitive: {
          kind: 'rotate',
          at: up(from),
          amount: annotation.rotate?.amount ?? 'quarter',
          direction: annotation.rotate?.direction ?? 'cw',
        },
      };
    case 'circle':
      // No letter (decision 8): a label names it, if anything does.
      return { kind: 'mark', primitive: { kind: 'point', at: up(from), style: 'highlight' } };
  }
}

/** An annotation compiled for drawing ({@link CompiledAnnotation}), once per annotation object. */
export const compiledAnnotation = perAnnotation(compileAnnotation);

/**
 * A label's text in runs, each in the font its script is set in, as the
 * sanitizer gives an upload's text: Han under the key a page swaps for the
 * diagram's Han style (`UPLOAD_HAN_KEY`).
 */
export function labelRuns(text: string): { key: DiagramFontKey; text: string }[] {
  const graphemes = graphemesOf(text);
  const keys = scriptFonts(graphemes, textCjkKey(text, UPLOAD_HAN_KEY));
  const runs: { key: DiagramFontKey; text: string }[] = [];
  graphemes.forEach((grapheme, index) => {
    const key = keys[index]!;
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.text += grapheme;
    else runs.push({ key, text: grapheme });
  });
  return runs;
}

/** The runs of text a step's labels set, each in its face, Han in the diagram's style: for the page's fonts. */
export function annotationTextRuns(
  annotations: readonly DiagramAnnotation[],
  hanStyle: DiagramHanStyle
): UploadTextRun[] {
  const runs: UploadTextRun[] = [];
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation) || annotation.kind !== 'label') continue;
    for (const run of labelRuns(annotation.text ?? '')) {
      runs.push({ face: { key: run.key === UPLOAD_HAN_KEY ? hanStyle : run.key, weight: 400 }, text: run.text });
    }
  }
  return runs;
}

/**
 * The annotations compiled for a frame `frame` whose longer side is `framePx`
 * CSS px. One this build cannot read is not drawn: only its own build knows
 * what it is.
 */
export function annotationDrawing(
  annotations: readonly DiagramAnnotation[],
  frame: PictureFrame,
  framePx: number,
  style: DiagramStyle
): AnnotationDrawing {
  const seen = seenStyle(style);
  const ink = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH);
  const arrowCss = seen.arrows.width * PT_TO_CSS_PX;
  const pens = canvasDiagramPens(STEP_DIAGRAM_LINE_WIDTH, arrowCss);
  // The arrow is the style's pen, at its pt width, as on a References step's page.
  const project = createOverlayProjector({ origin: [0, 0], ex: [framePx, 0], ey: [0, -framePx] }, ink, {
    ...pens,
    arrow: penInk(seen.arrows, arrowCss / ink),
  });
  const lines: AnnotationLine[] = [];
  const primitives: AnnotationPrimitive[] = [];
  const primitiveIds: string[] = [];
  const labels: AnnotationLabel[] = [];
  const at = ([u, v]: PicturePoint): [number, number] => [u * framePx, v * framePx];
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation)) continue;
    const compiled = compiledAnnotation(annotation);
    if (!compiled) continue;
    switch (compiled.kind) {
      case 'line':
        lines.push({ id: annotation.id, role: compiled.role, a: at(compiled.from), b: at(compiled.to) });
        break;
      case 'label': {
        const [x, y] = at(compiled.at);
        const runs = compiled.runs.map((run) => ({ family: uploadTextFamily(run.key), text: run.text }));
        labels.push({ id: annotation.id, x, y, size: LABEL_SIZE * framePx, fill: seen.arrows.color, runs });
        break;
      }
      case 'mark':
        primitives.push(compiled.primitive);
        primitiveIds.push(annotation.id);
        break;
    }
  }
  const sheet = { width: frame.width, height: frame.height, centre: [frame.width / 2, -frame.height / 2] as const };
  const context = createDiagramRenderContext(primitives, sheet, project, {
    layout: {},
    // No paper to clip to: every mark is in its one ink.
    outline: [],
    inline: annotationInk(seen),
    back: false,
  });
  return { width: frame.width * framePx, height: frame.height * framePx, lines, primitives, primitiveIds, context, labels };
}

/** How far a shaped arrow's shaft may stand off the points it is measured along, in ink: far under its pen. */
const REACH_FLATTEN_INK = 0.05;

/**
 * What a drawing reaches, in its own px: its frame, and past it whatever its
 * marks reach — an arrow may start off the picture. Generous rather than
 * exact: it is the box a step's file is cropped to, and a mark cut there is
 * worse than a little more paper.
 */
export function annotationReach(drawing: AnnotationDrawing): { x: number; y: number; width: number; height: number } {
  const { project } = drawing.context;
  const ink = project.ink;
  let minX = 0;
  let minY = 0;
  let maxX = drawing.width;
  let maxY = drawing.height;
  const take = (x: number, y: number, pad: number) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  };
  for (const line of drawing.lines) {
    take(line.a[0], line.a[1], 2 * ink);
    take(line.b[0], line.b[1], 2 * ink);
  }
  // An arrow, exactly where it is drawn: its strokes, and its head as drawn
  // — a mountain's barb included, which a heavier pen makes bigger — with
  // room for the pen's width and the mitre at a sharp corner. A stroke is
  // drawn as a curve and measured along points on it: an arc's room grows by
  // how far it bows out between them; a shaped arrow's points are close
  // enough that it never matters.
  const pen = project.pens.arrow.width * ink;
  const arrowStrokes = (points: Iterable<readonly [number, number]>) => {
    for (const [x, y] of points) take(x, y, pen);
  };
  const arcStroke = (arc: DiagramArc | null) => {
    if (!arc) return;
    const bow = arcPolylineDeviation(arc) * project.scale;
    for (const point of arcPolyline(arc)) {
      const { x, y } = project(point);
      take(x, y, pen + bow);
    }
  };
  const arrowhead = (head: Arrowhead) => {
    for (const { x, y } of arrowheadExtent(head)) take(x, y, Math.max(2 * ink, 1.5 * pen));
  };
  for (const primitive of drawing.primitives) {
    switch (primitive.kind) {
      case 'fold-arrow': {
        const arrow = foldArrowDrawn(primitive.out, project, drawing.context.marks);
        if (!arrow) break;
        arcStroke(arrow.out);
        arcStroke(arrow.back);
        arrowhead(arrow.head);
        break;
      }
      case 'one-way-arrow': {
        const arrow = oneWayArrowDrawn(primitive.out, project, drawing.context.marks);
        arcStroke(arrow.shaft);
        arrowhead(arrow.head);
        break;
      }
      case 'path-arrow': {
        const arrow = pathArrowDrawn(primitive.path, primitive.fold, project, drawing.context.marks);
        if (!arrow) break;
        const shaft = arrow.shaft ? flattenPath(arrow.shaft, REACH_FLATTEN_INK * ink) : [];
        arrowStrokes([...shaft, ...(arrow.back ?? [])]);
        arrowhead(arrow.head);
        break;
      }
      case 'push-arrow': {
        // Its outline's corners, its mitres out past them.
        const outline = pushArrowDrawn(primitive.from, primitive.to, project);
        if (!outline) break;
        const mitres = mitredCornerReach(outline, pen);
        outline.forEach(({ x, y }, index) => take(x, y, mitres[index]!));
        break;
      }
      case 'turn-over': {
        for (const { x, y } of turnOverDrawn(primitive.at, primitive.axis, project).corners) take(x, y, pen);
        break;
      }
      case 'rotate': {
        // Its circle's box — a little more than its arcs reach at the gaps at
        // its sides — and its heads, filled, which a heavy pen makes longer.
        const glyph = rotateGlyphDrawn(primitive.at, primitive.direction, project);
        take(glyph.centre.x, glyph.centre.y, glyph.radius + pen / 2);
        for (const head of glyph.heads) for (const { x, y } of [head.tip, head.notch, ...head.barbs]) take(x, y, 0);
        break;
      }
      case 'point': {
        // The ring's outer edge: its radius and half its stroke.
        const { x, y } = project(primitive.at);
        take(x, y, markOuterRadius(project));
        break;
      }
      default: {
        // Every mark an annotation can be has its reach above: a new one is a
        // compile error here until it does, rather than cut off in a file.
        const _unreached: never = primitive;
        break;
      }
    }
  }
  for (const label of drawing.labels) {
    const half = (labelHalfWidth(label.runs.map((run) => run.text).join('')) / LABEL_SIZE) * label.size;
    minX = Math.min(minX, label.x - half);
    maxX = Math.max(maxX, label.x + half);
    minY = Math.min(minY, label.y - label.size);
    maxY = Math.max(maxY, label.y + label.size);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const round = (value: number) => Number(value.toFixed(3));

/** One label as SVG: a `<text>` of runs, each run its own font as an upload's are. */
function labelElement(label: AnnotationLabel): ReactNode {
  return (
    <text
      key={label.id}
      x={round(label.x)}
      y={round(label.y + LABEL_BASELINE * label.size)}
      fontSize={round(label.size)}
      textAnchor="middle"
      fill={label.fill}
    >
      {label.runs.map((run, index) => (
        <tspan key={index} fontFamily={run.family} fontWeight={400}>
          {run.text}
        </tspan>
      ))}
    </text>
  );
}

/**
 * The marks and labels, as React: the shapes `diagramShapes` draws, then the
 * labels over them. `wrap` puts each in a group of the caller's, by its
 * annotation's id.
 */
export function annotationMarks(
  drawing: AnnotationDrawing,
  wrap?: (shape: ReactNode, annotationId: string) => ReactNode
): ReactNode {
  const shapes = diagramShapes(drawing.primitives, drawing.context, {
    wrap: wrap ? (shape, index) => wrap(shape, drawing.primitiveIds[index]!) : undefined,
  });
  return (
    <>
      {shapes}
      {drawing.labels.map((label) => (wrap ? wrap(labelElement(label), label.id) : labelElement(label)))}
    </>
  );
}

/**
 * The drawing as a paper scene: its lines as lines, its marks and labels as
 * one markup item over them. Its fraction digits are set in Noto Sans, as a
 * References step's letters are on a page. Null when it draws nothing.
 */
export function annotationScene(drawing: AnnotationDrawing): PaperScene | null {
  const lines: PaperLineItem[] = drawing.lines.map((line) => ({
    kind: 'line',
    role: line.role,
    a: line.a,
    b: line.b,
    onBoundary: [false, false],
    face: 0,
    hidden: false,
  }));
  const svg = renderToStaticMarkup(annotationMarks(drawing)).replaceAll(
    `font-family="${INLINE_LABEL_FONT}"`,
    `font-family="${uploadTextFamily('latin')}"`
  );
  const bounds = { minX: 0, minY: 0, maxX: drawing.width, maxY: drawing.height };
  const items: PaperItem[] = [...lines];
  if (svg !== '') items.push({ kind: 'markup', svg, bounds, hidden: false });
  if (items.length === 0) return null;
  return { bounds, sheet: Math.max(drawing.width, drawing.height), items };
}
