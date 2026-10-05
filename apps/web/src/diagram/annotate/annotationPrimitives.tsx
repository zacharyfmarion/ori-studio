/**
 * Annotations compiled for drawing (D8): each time a picture is painted, at
 * the size it is painted at, into the vocabulary References draws its steps
 * in, so an annotation's arrow is References' arrow.
 *
 * - A valley, mountain or hidden line is a paper line in the role
 *   `diagram-valley`, `diagram-mountain` or `diagram-hidden`, drawn in the
 *   style's pens as a step's own lines are.
 * - A fold arrow, a push, a white arrow, the turn-over and rotate glyphs are
 *   step-diagram primitives drawn by `diagramShapes`, in the style's arrow
 *   ink, with no paper to clip to: an annotation is the author's own mark,
 *   one ink wherever it lies.
 * - A circle is References' ring round a point (`point`, highlight), in the
 *   annotation pen — three quarters of the style's arrow pen, in its ink
 *   (decision 7) — so an arrow that lands on it stops at its rim, as
 *   References' do.
 * - A right angle is an open square in its corner (`right-angle`, decision
 *   11), in the ring's pen and ink: a precise mark, as a circle is.
 * - A label is a line of text at a fixed share of the frame, its runs in the
 *   diagram's fonts as an upload's text is (`uploadText.ts`), so a page sets
 *   and embeds it the same way.
 * - A callout is a line from a point to a box of words: the line in the
 *   annotation pen, the box filled with the page's white and outlined in the
 *   arrow pen, its words set as a label's are. Its shape is decided in
 *   picture units (`calloutShape`); the pens are the drawing's. It is drawn
 *   here, not by References: its words are in the diagram's fonts, which
 *   References knows nothing of.
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
import { markRingWidth } from '../../cp-workspace/references/diagram/labelLayout';
import { markReach, type DiagramMarkPrimitive } from '../../cp-workspace/references/diagram/markReach';
import {
  canvasDiagramInk,
  canvasDiagramPens,
  penInk,
} from '../../cp-workspace/references/diagram/diagramInk';
import { arcThroughPoints, createOverlayProjector, type PathArrowFold } from '../../cp-workspace/references/stepDiagramGeometry';
import { referencesPaperTokens } from '../../cp-workspace/references/usePaperStyleTokens';
import type { PaperItem, PaperLineItem, PaperLineRole, PaperScene } from '../../lib/paper/paperScene';
import { penForRole } from '../../lib/paper/paperSvg';
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
import { diagramPaperStyle, diagramSurfaceStyle } from '../pictures/diagramPaperStyle';
import { STEP_DIAGRAM_LINE_WIDTH } from '../pictures/paintStepDiagram';
import { UPLOAD_HAN_KEY, uploadTextFamily, type UploadTextRun } from '../upload/uploadText';
import type { DiagramFontKey } from '../fonts/diagramFontFaces';
import {
  arrowApex,
  arrowShape,
  CALLOUT_TEXT_SIZE,
  calloutDrawnBox,
  calloutShape,
  carriesText,
  DEFAULT_PLEAT_KINKS,
  DEFAULT_WHITE_ARROW,
  LABEL_SIZE,
  labelHalfWidth,
  pathCubics,
  pathLength,
  straightPath,
  type CalloutShape,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import { perAnnotation } from './perAnnotation';

/** Where a label's baseline sits below its point, in ems: a capital's middle on the point. A callout's words sit so on its box's middle. */
export const LABEL_BASELINE = 0.36;

/** A label as drawn: its centre, its size and its runs, each in its script's font. */
export interface AnnotationLabel {
  id: string;
  x: number;
  y: number;
  size: number;
  fill: string;
  runs: { family: string; text: string }[];
}

/** A callout as drawn, in CSS px: its line, its box and its words, and the pens they are drawn in. */
export interface AnnotationCallout {
  id: string;
  /** From the point it marks to the box's outline; null when the point is inside the box. */
  line: { a: [number, number]; b: [number, number] } | null;
  /** The line's pen: the annotation pen, a circle's ring's. */
  linePen: number;
  /**
   * The box's outline, its stroke's middle: half its pen outside the box its
   * words were measured for ({@link calloutShape}), so the white inside is
   * that box at any pen.
   */
  box: { x: number; y: number; width: number; height: number };
  /** The box's pen: the arrow pen, mitred at its corners. */
  boxPen: number;
  /** The ink the line, the outline and the words are drawn in: the arrows'. */
  ink: string;
  /** What the box is filled with: the page's white, so it reads over the picture. */
  ground: string;
  /** Its words, centred in the box, as a label's are drawn. */
  label: AnnotationLabel;
}

/** A line as drawn, in CSS px. */
export interface AnnotationLine {
  id: string;
  role: PaperLineRole;
  a: [number, number];
  b: [number, number];
  /** Half its role's pen, in the drawing's px: how far its ink reaches past its ends and to its sides. */
  halfWidth: number;
}

/** The marks an annotation can be: the References primitives it compiles to. */
export type AnnotationPrimitive = DiagramMarkPrimitive;

/**
 * One annotation compiled for drawing, in picture units — a mark in the
 * primitives' y-up space — so it is the same whatever size it is drawn at:
 * a line in its pen's role, a label's runs at its point, or a mark References
 * draws.
 */
export type CompiledAnnotation =
  | { kind: 'line'; role: PaperLineRole; from: PicturePoint; to: PicturePoint }
  | { kind: 'label'; at: PicturePoint; runs: { key: DiagramFontKey; text: string }[] }
  | { kind: 'callout'; shape: CalloutShape; at: PicturePoint; runs: { key: DiagramFontKey; text: string }[] }
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
  /** Over the marks: a callout's box hides what lies under it. */
  callouts: AnnotationCallout[];
  labels: AnnotationLabel[];
}

/** The style an annotation's marks are drawn in: the diagram's, as References applies it. */
function seenStyle(style: DiagramStyle): PaperStyle {
  return applyPaperStylePolicy(diagramPaperStyle(style), PAPER_STYLE_POLICIES.references);
}

/**
 * A callout's outline's pen, in CSS px whatever the frame: the style's arrow
 * pen at its pt width, as a References step's page draws an arrow.
 */
export function calloutPen(style: DiagramStyle): number {
  return seenStyle(style).arrows.width * PT_TO_CSS_PX;
}

/** The page an annotation is printed on: a hollow push or white arrow is this inside. */
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
 * short to have an arc, a label or a callout with no text. Every kind says which (a
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
    case 'pleat-arrow':
      // Its Zs' side is the picture's, which the y-up sheet and the drawing's
      // y-down page both keep: flipped twice.
      return {
        kind: 'mark',
        primitive: {
          kind: 'pleat-arrow',
          from: up(from),
          to: up(to),
          kinks: annotation.kinks ?? DEFAULT_PLEAT_KINKS,
          mirrored: annotation.mirrored === true,
        },
      };
    case 'white-arrow': {
      // Always a path; one read without is the straight one it was laid as.
      const nodes = annotation.path ?? straightPath(from, to);
      if (!(pathLength(nodes) > 0)) return null;
      return {
        kind: 'mark',
        primitive: {
          kind: 'white-arrow',
          path: pathCubics(nodes).map(([a, b, c, d]) => [up(a), up(b), up(c), up(d)] as const),
          width: annotation.width ?? DEFAULT_WHITE_ARROW.width,
          tail: annotation.tail ?? DEFAULT_WHITE_ARROW.tail,
          fill: annotation.fill ?? 'white',
        },
      };
    }
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
    case 'right-angle':
      // `to` says only which way it opens: the drawing sizes it.
      return { kind: 'mark', primitive: { kind: 'right-angle', at: up(from), toward: up(to) } };
    case 'angle-mark': {
      // `to` and `other` say only which way its arms run: the drawing sizes it.
      if (!annotation.other) return null;
      return {
        kind: 'mark',
        primitive: { kind: 'angle-mark', at: up(from), arms: [up(to), up(annotation.other)], ticks: annotation.ticks ?? 1 },
      };
    }
    case 'callout': {
      // As a label with no words draws nothing, so does a callout: an empty box says nothing.
      const text = annotation.text ?? '';
      return text.trim() === '' ? null : { kind: 'callout', shape: calloutShape(annotation), at: to, runs: labelRuns(text) };
    }
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

/** The runs of text a step's labels and callouts set, each in its face, Han in the diagram's style: for the page's fonts. */
export function annotationTextRuns(
  annotations: readonly DiagramAnnotation[],
  hanStyle: DiagramHanStyle
): UploadTextRun[] {
  const runs: UploadTextRun[] = [];
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation) || !carriesText(annotation.kind)) continue;
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
  // The pens the lines are painted in, as `paintAnnotations` and the canvas paint them.
  const surface = diagramSurfaceStyle(style);
  const lines: AnnotationLine[] = [];
  const primitives: AnnotationPrimitive[] = [];
  const primitiveIds: string[] = [];
  const callouts: AnnotationCallout[] = [];
  const labels: AnnotationLabel[] = [];
  const at = ([u, v]: PicturePoint): [number, number] => [u * framePx, v * framePx];
  // A callout's pens: the arrow pen round its box, the annotation pen — a circle's ring's — along its line.
  const boxPen = calloutPen(style);
  const linePen = markRingWidth(project);
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation)) continue;
    const compiled = compiledAnnotation(annotation);
    if (!compiled) continue;
    switch (compiled.kind) {
      case 'line':
        lines.push({
          id: annotation.id,
          role: compiled.role,
          a: at(compiled.from),
          b: at(compiled.to),
          halfWidth: ((penForRole(surface, compiled.role)?.width ?? 0) * PT_TO_CSS_PX) / 2,
        });
        break;
      case 'label': {
        const [x, y] = at(compiled.at);
        const runs = compiled.runs.map((run) => ({ family: uploadTextFamily(run.key), text: run.text }));
        labels.push({ id: annotation.id, x, y, size: LABEL_SIZE * framePx, fill: seen.arrows.color, runs });
        break;
      }
      case 'callout': {
        const { line, box } = compiled.shape;
        const [x, y] = at(compiled.at);
        const runs = compiled.runs.map((run) => ({ family: uploadTextFamily(run.key), text: run.text }));
        callouts.push({
          id: annotation.id,
          line: line ? { a: at(line[0]), b: at(line[1]) } : null,
          linePen,
          // The pen outside the box the words were measured for: a heavy one never covers them.
          box: calloutDrawnBox(
            { x: box.x * framePx, y: box.y * framePx, width: box.width * framePx, height: box.height * framePx },
            boxPen
          ),
          boxPen,
          ink: seen.arrows.color,
          ground: PAGE_GROUND,
          label: { id: annotation.id, x, y, size: CALLOUT_TEXT_SIZE * framePx, fill: seen.arrows.color, runs },
        });
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
  return {
    width: frame.width * framePx,
    height: frame.height * framePx,
    lines,
    primitives,
    primitiveIds,
    context,
    callouts,
    labels,
  };
}

/**
 * What a drawing reaches, in its own px: its frame, and past it whatever its
 * marks reach — an arrow may start off the picture — as far as their ink and
 * no further: it is the room a page leaves a picture and the box a step's
 * file is cropped to, so a mark cut there is lost and a reach past its ink
 * is paper taken from the picture for nothing. Measured as a page draws the
 * marks (`paintAnnotations`), every join of a stroke round unless the mark
 * mitres its own.
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
  // A line, its pen's half-width round each end: as far as a butt end's
  // corner or a round cap reaches, and its sides.
  for (const line of drawing.lines) {
    take(line.a[0], line.a[1], Math.max(2 * ink, line.halfWidth));
    take(line.b[0], line.b[1], Math.max(2 * ink, line.halfWidth));
  }
  // Its marks as drawn: as far as their ink, and no further (`markReach`).
  for (const primitive of drawing.primitives) markReach(primitive, project, drawing.context.marks, take);
  // A callout, exactly: its box and half its outline's pen round it — a
  // rectangle's mitred corner reaches no further — and its line's round ends.
  // Its words are inside its box (`CALLOUT_PAD_EMS`, `CALLOUT_HALF_HEIGHT_EMS`).
  for (const { box, boxPen, line, linePen } of drawing.callouts) {
    take(box.x, box.y, boxPen / 2);
    take(box.x + box.width, box.y + box.height, boxPen / 2);
    if (line) {
      take(line.a[0], line.a[1], linePen / 2);
      take(line.b[0], line.b[1], linePen / 2);
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
 * One callout as SVG: its line, then its box over the line's end — filled
 * with the page's white, so it reads over whatever it lies on — then its
 * words, as a label's are set. The box's corners are mitred, whatever join
 * the caller wraps it in.
 */
export function calloutElement(callout: AnnotationCallout): ReactNode {
  const { line, box } = callout;
  return (
    <g key={callout.id}>
      {line && (
        <line
          x1={line.a[0]}
          y1={line.a[1]}
          x2={line.b[0]}
          y2={line.b[1]}
          fill="none"
          stroke={callout.ink}
          strokeWidth={callout.linePen}
          strokeLinecap="round"
        />
      )}
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={callout.ground}
        stroke={callout.ink}
        strokeWidth={callout.boxPen}
        strokeLinejoin="miter"
      />
      {labelElement(callout.label)}
    </g>
  );
}

/**
 * The marks, callouts and labels, as React: the shapes `diagramShapes` draws,
 * the callouts over them, then the labels over those. `wrap` puts each in a
 * group of the caller's, by its annotation's id.
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
      {drawing.callouts.map((callout) => (wrap ? wrap(calloutElement(callout), callout.id) : calloutElement(callout)))}
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
