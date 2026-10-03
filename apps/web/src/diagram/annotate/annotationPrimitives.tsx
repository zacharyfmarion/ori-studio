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
 * - A label is a line of text at a fixed share of the frame, its runs in the
 *   diagram's fonts as an upload's text is (`uploadText.ts`), so a page sets
 *   and embeds it the same way.
 *
 * The drawing is in CSS px, the frame's top-left at the origin, its longer
 * side `framePx` across — the size it prints at — so its marks have the
 * weight References' have at that size; a surface places it with a uniform
 * scale and a shift.
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
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_FOLD_RETURN_INK,
  DIAGRAM_PUSH_INK,
  DIAGRAM_ROTATE_INK,
  DIAGRAM_TURN_OVER_INK,
  canvasDiagramInk,
  canvasDiagramPens,
  penInk,
} from '../../cp-workspace/references/diagram/diagramInk';
import type { StepDiagramPrimitive } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { arcPolyline, arcThroughPoints, createOverlayProjector } from '../../cp-workspace/references/stepDiagramGeometry';
import { referencesPaperTokens } from '../../cp-workspace/references/usePaperStyleTokens';
import type { PaperItem, PaperLineItem, PaperLineRole, PaperScene } from '../../lib/paper/paperScene';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { graphemesOf } from '../../lib/paper/textWrap';
import { REFERENCE_COLORS } from '../../themes/applyTheme';
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramAnnotationKind,
  type DiagramHanStyle,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { scriptFonts, textCjkKey } from '../fonts/fontScripts';
import { diagramPaperStyle } from '../pictures/diagramPaperStyle';
import { STEP_DIAGRAM_LINE_WIDTH } from '../pictures/paintStepDiagram';
import { UPLOAD_HAN_KEY, uploadTextFamily, type UploadTextRun } from '../upload/uploadText';
import type { DiagramFontKey } from '../fonts/diagramFontFaces';
import { arrowApex, ARROW_BEND, LABEL_SIZE, type PictureFrame, type PicturePoint } from './annotationModel';

/** The line kinds, and the pen role each is drawn in. */
export const ANNOTATION_LINE_ROLES: Partial<Record<DiagramAnnotationKind, PaperLineRole>> = {
  'valley-line': 'diagram-valley',
  'mountain-line': 'diagram-mountain',
  'hidden-line': 'diagram-hidden',
};

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

/** The annotations ready to draw, on screen or into a file. */
export interface AnnotationDrawing {
  /** The frame, in CSS px: where the drawing's picture is. */
  width: number;
  height: number;
  lines: AnnotationLine[];
  /** The marks, in draw order, and the annotation each is. */
  primitives: StepDiagramPrimitive[];
  primitiveIds: string[];
  context: DiagramRenderContext;
  labels: AnnotationLabel[];
}

/** The style an annotation's marks are drawn in: the diagram's, as References applies it. */
function seenStyle(style: DiagramStyle): PaperStyle {
  return applyPaperStylePolicy(diagramPaperStyle(style), PAPER_STYLE_POLICIES.references);
}

/**
 * The marks' colours as attributes: the style's arrow ink, and the paper's
 * face inside a hollow push. One ink on and off the paper, so nothing is
 * clipped (`oneInk`).
 */
function annotationInk(seen: PaperStyle): DiagramInlineInk {
  const ink = diagramInlineInk({
    ...referencesPaperTokens(seen),
    '--cp-reference-input': REFERENCE_COLORS.light.input,
    '--bg-primary': '#ffffff',
  });
  return { ...ink, ground: { arrow: ink.arrowhead, mark: ink.mark } };
}

/** Picture units to the primitives' y-up space, as References' unit frame is. */
const up = ([u, v]: PicturePoint): [number, number] => [u, -v];

function primitiveOf(annotation: KnownDiagramAnnotation): StepDiagramPrimitive | null {
  const { kind, from, to } = annotation;
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow': {
      const out = arcThroughPoints(up(from), up(arrowApex(from, to, annotation.bend ?? ARROW_BEND)), up(to));
      if (!out) return null;
      return kind === 'fold-unfold-arrow'
        ? { kind: 'fold-arrow', out }
        : { kind: 'one-way-arrow', out, fold: kind === 'valley-arrow' ? 'valley' : 'mountain' };
    }
    case 'push-arrow':
      return { kind: 'push-arrow', from: up(from), to: up(to) };
    case 'turn-over':
      return { kind: 'turn-over', at: up(from), axis: annotation.axis ?? 'vertical' };
    case 'rotate':
      return {
        kind: 'rotate',
        at: up(from),
        amount: annotation.rotate?.amount ?? 'quarter',
        direction: annotation.rotate?.direction ?? 'cw',
      };
    default:
      return null;
  }
}

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
  const primitives: StepDiagramPrimitive[] = [];
  const primitiveIds: string[] = [];
  const labels: AnnotationLabel[] = [];
  const at = ([u, v]: PicturePoint): [number, number] => [u * framePx, v * framePx];
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation)) continue;
    const role = ANNOTATION_LINE_ROLES[annotation.kind];
    if (role) {
      lines.push({ id: annotation.id, role, a: at(annotation.from), b: at(annotation.to) });
      continue;
    }
    if (annotation.kind === 'label') {
      const text = annotation.text ?? '';
      if (text.trim() === '') continue;
      const [x, y] = at(annotation.from);
      const runs = labelRuns(text).map((run) => ({ family: uploadTextFamily(run.key), text: run.text }));
      labels.push({ id: annotation.id, x, y, size: LABEL_SIZE * framePx, fill: seen.arrows.color, runs });
      continue;
    }
    const primitive = primitiveOf(annotation);
    if (primitive) {
      primitives.push(primitive);
      primitiveIds.push(annotation.id);
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
  const arrowPad = (DIAGRAM_ARROWHEAD_INK.length + DIAGRAM_FOLD_RETURN_INK.offset) * ink;
  for (const primitive of drawing.primitives) {
    switch (primitive.kind) {
      case 'fold-arrow':
      case 'one-way-arrow':
        for (const point of arcPolyline(primitive.out)) {
          const { x, y } = project(point);
          take(x, y, arrowPad);
        }
        break;
      case 'push-arrow':
        for (const point of [primitive.from, primitive.to]) {
          const { x, y } = project(point);
          take(x, y, DIAGRAM_PUSH_INK.head * ink);
        }
        break;
      case 'turn-over': {
        const { x, y } = project(primitive.at);
        take(x, y, DIAGRAM_TURN_OVER_INK * ink * 0.6);
        break;
      }
      case 'rotate': {
        const { x, y } = project(primitive.at);
        take(x, y, (DIAGRAM_ROTATE_INK.radius + DIAGRAM_ARROWHEAD_INK.length) * ink);
        break;
      }
      default:
        break;
    }
  }
  for (const label of drawing.labels) {
    const characters = label.runs.reduce((count, run) => count + run.text.length, 0);
    const half = label.size * (0.6 * characters + 0.4);
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
