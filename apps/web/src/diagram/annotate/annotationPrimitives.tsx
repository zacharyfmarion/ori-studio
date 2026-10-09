/**
 * Annotations compiled for drawing (D8): each time a picture is painted, at
 * the size it is painted at, into the vocabulary References draws its steps
 * in, so an annotation's arrow is References' arrow.
 *
 * - A valley, mountain or hidden line is a paper line in the role
 *   `diagram-valley`, `diagram-mountain` or `diagram-hidden`, drawn in the
 *   style's pens as a step's own lines are.
 * - A solid line (17a) is References' own `line` in its `highlight` pen —
 *   the pen a step's reference lines are drawn in, the arrow's weight with a
 *   round cap — in its own colour (`ink`), or, with none, the style's arrow
 *   ink. It cannot be a paper line: a role carries the style's fixed colours.
 * - A fold arrow, a push, a white arrow, the turn-over and rotate glyphs are
 *   step-diagram primitives drawn by `diagramShapes`, in the style's arrow
 *   ink, with no paper to clip to: an annotation is the author's own mark,
 *   one ink wherever it lies.
 * - A circle is References' ring round a point (`point`, highlight), in the
 *   annotation pen — three quarters of the style's arrow pen, in its ink
 *   (decision 7) — so an arrow that lands on it stops at its rim, as
 *   References' do.
 * - A right angle is an ∟ set into its angle with a closed square in its
 *   corner (`right-angle`, Revision 2), in the ring's ink and the style's aux
 *   pen — the existing creases' — a fine, precise mark.
 * - Equal divisions (`divisions`, Revision 2) are a line set off the line
 *   they measure, in the style's aux pen — the existing creases' — with
 *   dividers and ticks across it in the ring's pen, in the ring's ink; their
 *   offset is a print length, stored in mm and drawn in ink.
 * - A label is a line of text at a fixed share of the frame, its runs in the
 *   diagram's fonts as an upload's text is (`uploadText.ts`), so a page sets
 *   and embeds it the same way. Its options (17b) are its own: a colour, Bold
 *   — the weight written on the text and its runs, so a page sets and embeds
 *   Noto Sans Bold — a halo, References' look, a stroke under the letters in
 *   what the text stands on (`paper`), a size in pt, and an offset in pt from
 *   its anchor. A label with none is drawn exactly as before them. A halo
 *   across a References sheet's edge (rf6) is painted with the sheet's face
 *   on the sheet and the page's white off it, so it follows the edge.
 * - A callout is a line from a point to a box of words: the line in the
 *   annotation pen, the box filled with the page's white and outlined in the
 *   arrow pen, its words set as a label's are. Its shape is decided in
 *   picture units (`calloutShape`); the pens are the drawing's. It is drawn
 *   here, not by References: its words are in the diagram's fonts, which
 *   References knows nothing of.
 * - A close-up (15f) is two rings and a line between them, in the annotation
 *   pen and the arrows' ink, as a callout's line is: round the area shown
 *   larger, and round the close-up beside it. What its inside shows — the
 *   picture painted again, the other marks with it — is each surface's to
 *   paint under the marks, as only a surface has the picture
 *   (`paintAnnotations`, the canvas); here it is where that goes.
 * - An enlarge area (Revision 2) is its outline, a circle or a rounded
 *   rectangle turned with its paper, in the annotation pen and the arrows'
 *   ink, as a close-up's ring is; a rounded rectangle on a white casing a
 *   little wider than its pen, which knocks out the creases it crosses (Z5),
 *   and a circle on none. It lies with the close-ups, over the marks and
 *   under the callouts and labels.
 * - An oval or a rectangle (Revision 3) is its outline — an `<ellipse>`, or
 *   a `<rect>` with square, mitred corners (R3-11b A) — turned by its angle,
 *   in the annotation pen and the arrows' ink, a ring's (R3-26 A), with no
 *   fill (R3-11a A) and no casing: it lies over the creases, as the turtle's
 *   ovals do. It is painted under every line and mark drawn on the step
 *   (R3-11d B), in a list of its own (`areas`), so a ring round an area is
 *   the stroke that gives way where it crosses a fold or an arrow.
 * - An x-ray (Revision 3) is a window cut into a flat fold's picture: inside
 *   its rim the picture without its top layers at one point. Only a surface
 *   has the picture's faces, so each paints the inside under the marks, and
 *   the rim with it (`xray/xrayScene.ts`); here it is the window, in a list
 *   of its own (`xRays`), and the rim's pen, 1.5 × the edges' (R3-15b (ii)),
 *   which its reach takes in. Nothing here draws it: each surface hands its
 *   painter to `paintAnnotations` (`xray/xrayPaint.ts`), and one that does
 *   not paint the inside draws no rim either (R3-18), but Pose, its rim
 *   alone (R3-19 A).
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
  strokeAttributes,
  type DiagramRenderContext,
} from '../../cp-workspace/references/diagram/DiagramPrimitives';
import type { StepDiagramPrimitive } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { diagramInlineInk, type DiagramInlineInk } from '../../cp-workspace/references/diagram/diagramColors';
import { markRingWidth } from '../../cp-workspace/references/diagram/labelLayout';
import { markReach, type DiagramMarkPrimitive } from '../../cp-workspace/references/diagram/markReach';
import {
  haloPatternElement,
  sheetHalo,
  type ReachBox,
  type SheetHaloAcross,
} from '../../cp-workspace/references/diagram/sheetHalo';
import {
  canvasDiagramInk,
  canvasDiagramPens,
  penInk,
} from '../../cp-workspace/references/diagram/diagramInk';
import {
  arcThroughPoints,
  createOverlayProjector,
  divisionsDrawn,
  strokePieces,
  type HiddenStretches,
  type PathArrowFold,
} from '../../cp-workspace/references/stepDiagramGeometry';
import { referencesPaperTokens } from '../../cp-workspace/references/usePaperStyleTokens';
import type { PaperItem, PaperLineItem, PaperLineRole, PaperScene } from '../../lib/paper/paperScene';
import { mmToCssPx, penForRole } from '../../lib/paper/paperSvg';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { graphemesOf } from '../../lib/paper/textWrap';
import { REFERENCE_COLORS } from '../../themes/applyTheme';
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramHanStyle,
  type DiagramPathNode,
  type DiagramStyle,
  type DiagramZoomOutline,
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
  behindEnds,
  CALLOUT_TEXT_SIZE,
  calloutDrawnBox,
  calloutShape,
  carriesText,
  closeUpFrame,
  closeUpShape,
  DEFAULT_PLEAT_KINKS,
  divisionsOffsetOf,
  divisionsPartsOf,
  DEFAULT_WHITE_ARROW,
  glyphAngleOf,
  glyphScaleOf,
  isArrowKind,
  LABEL_SIZE,
  labelHalfWidth,
  pathCubics,
  pathLength,
  straightPath,
  type CalloutShape,
  type CloseUpShape,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import { arrowPolyline } from './annotationHit';
import { areaBox, areaOutlineOf, type AreaOutline } from './areaOutline';
import { frameWindow, zoomCornerRadius, zoomOutlineOf, zoomShapeOf } from '../zoom/zoomModel';
import { ANNOTATION_INK_MM } from './canvasInk';
import { hiddenArcs, hiddenStretches } from './behindFlaps';
import { perAnnotation } from './perAnnotation';
import { TEXT_HALO_EMS } from './textStyle';
import type { PictureLayers } from './pictureGeometry';

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
  /** Set in Noto Sans Bold (17b); absent, Regular. */
  bold?: true;
  /**
   * A stroke under its letters, in what it stands on (17b): its colour and its
   * width, in the drawing's px. Across a References sheet's edge (rf6) it is
   * painted by `across`, a pattern of the sheet (`sheetHalo`, which
   * References' own letters are haloed by too): the sheet's face on the
   * sheet, `color` — the page's white — off it, to the edge.
   */
  halo?: { color: string; width: number; across?: SheetHaloAcross };
}

/**
 * The paper a References picture's text stands on (17b), for a halo to be
 * filled with: the sheet's outline, in the marks' units — a References
 * picture's sheet is its frame (D8), an enlarged step's that frame in its
 * window's units — and whether the picture shows its back. Text off it, and
 * text on any other picture (none given), stands on the page's white.
 */
export interface AnnotationPaper {
  outline: readonly PicturePoint[];
  back: boolean;
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

/**
 * A close-up as drawn, in CSS px (15f): its two rings and the line between
 * them, and where its inside shows the picture.
 */
export interface AnnotationCloseUp {
  id: string;
  /** The ring round the area: its centre, and its radius to the middle of its pen. */
  area: { x: number; y: number; r: number };
  /** The close-up's ring, the same; its inside is drawn within this radius, the ring over its edge. */
  inset: { x: number; y: number; r: number };
  /** From rim to rim, between their centres; null where the rings meet. */
  line: { a: [number, number]; b: [number, number] } | null;
  /** The rings' and the line's pen: the annotation pen, a circle's ring's. */
  pen: number;
  /** Their ink: the arrows'. */
  ink: string;
  /** What the close-up's inside is filled with under its picture: the page's white. */
  ground: string;
  /** How many times larger it draws its area. */
  scale: number;
  /** The picture's frame as the close-up draws it (`closeUpFrame`), in the drawing's px. */
  frame: { x: number; y: number; width: number; height: number };
}

/** An enlarge area as drawn, in CSS px (Revision 2). */
export interface AnnotationZoomArea {
  id: string;
  /** Its outline, in the drawing's px: centred, a circle's radius or a rounded rectangle's size, and its turn. */
  outline: DiagramZoomOutline;
  /** Its pen: the annotation pen, a close-up's ring's. */
  pen: number;
  /** Its ink: the arrows'. */
  ink: string;
  /**
   * The white casing under a rounded rectangle (Z5), its stroke's width: the
   * pen and {@link ZOOM_CASING_INKS} of ink each side. Null for a circle,
   * which has none.
   */
  casing: number | null;
  /** What the casing is: the page's white. */
  ground: string;
}

/** An oval or a rectangle as drawn, in CSS px (Revision 3). */
export interface AnnotationArea {
  id: string;
  /** Its outline, in the drawing's px: its kind, centre, size and turn. */
  outline: AreaOutline;
  /** Its pen: the annotation pen, a ring's (R3-26 A). */
  pen: number;
  /** Its ink: the arrows'. */
  ink: string;
}

/** An x-ray's window as drawn, in CSS px (Revision 3): where a surface paints its inside, and its rim. */
export interface AnnotationXRay {
  id: string;
  /** The window, in the drawing's px: its centre, and its radius to the middle of its rim. */
  window: { x: number; y: number; r: number };
  /** The rim's pen, in the drawing's px, and its ink: 1.5 × the edges' (R3-15b (ii)). */
  rim: { width: number; color: string };
}

/** How much heavier an x-ray's rim is than the paper's edges (R3-15b (ii)): Lang's "heavy circle". */
export const XRAY_RIM_EDGES = 1.5;

/**
 * How far an enlarge area's casing reaches past its pen on each side, in ink
 * (Z5): 0.15 mm, a hairline knock-out. It was 1.5 ink (0.5 mm), which Zach
 * found "way too wide. It should just be like a tiny line." (2026-10-06).
 * Measured on his look-2 example at print size, where the knock-out is about
 * 1.65 times its thinnest crease: here 0.42 pt beside a 0.25 pt aux line.
 */
export const ZOOM_CASING_INKS = 0.45;

/** A line as drawn, in CSS px. */
export interface AnnotationLine {
  id: string;
  role: PaperLineRole;
  a: [number, number];
  b: [number, number];
  /** Half its role's pen, in the drawing's px: how far its ink reaches past its ends and to its sides. */
  halfWidth: number;
  /** Its piece, from its start: a line behind a flap is drawn in pieces, each in its role's pen (15e). */
  part?: number;
}

/** A References line, as a solid line compiles to one (17a). */
type LinePrimitive = Extract<StepDiagramPrimitive, { kind: 'line' }>;

/** The marks an annotation can be: the References primitives it compiles to, and a solid line's `line`. */
export type AnnotationPrimitive = DiagramMarkPrimitive | LinePrimitive;

/**
 * One annotation compiled for drawing, in picture units — a mark in the
 * primitives' y-up space — so it is the same whatever size it is drawn at:
 * a line in its pen's role, a label's runs at its point, or a mark References
 * draws.
 */
export type CompiledAnnotation =
  | { kind: 'line'; role: PaperLineRole; from: PicturePoint; to: PicturePoint }
  | { kind: 'label'; at: PicturePoint; runs: { key: DiagramFontKey; text: string }[]; style: CompiledTextStyle }
  | { kind: 'callout'; shape: CalloutShape; at: PicturePoint; runs: { key: DiagramFontKey; text: string }[] }
  | { kind: 'close-up'; shape: CloseUpShape }
  | { kind: 'zoom'; outline: DiagramZoomOutline }
  | { kind: 'area'; outline: AreaOutline }
  | { kind: 'x-ray'; outline: DiagramZoomOutline }
  | { kind: 'mark'; primitive: AnnotationPrimitive };

/** A label's options as it is compiled (17b): each only as it is set. */
export interface CompiledTextStyle {
  color?: string;
  bold?: true;
  halo?: true;
  sizePt?: number;
  offsetPt?: [number, number];
}

/** The annotations ready to draw, on screen or into a file. */
export interface AnnotationDrawing {
  /** The frame, in CSS px: where the drawing's picture is. */
  width: number;
  height: number;
  /** Under the lines and every mark (Revision 3, R3-11d B): an oval's or a rectangle's outline. */
  areas: AnnotationArea[];
  lines: AnnotationLine[];
  /** The marks, in draw order, and the annotation each is. */
  primitives: AnnotationPrimitive[];
  primitiveIds: string[];
  context: DiagramRenderContext;
  /** Over the marks, under the close-ups: an enlarge area's outline. */
  zoomAreas: AnnotationZoomArea[];
  /** Over the marks: a close-up's rings and line. */
  closeUps: AnnotationCloseUp[];
  /** Under the marks, each painted by its surface: an x-ray's window and rim (Revision 3). */
  xRays: AnnotationXRay[];
  /** Over the marks: a callout's box hides what lies under it. */
  callouts: AnnotationCallout[];
  labels: AnnotationLabel[];
}

/**
 * The style an annotation's marks are drawn in: the diagram's, as References
 * applies it. Worked out once per style, as the inks made of it are: every
 * compile asks — a page's layout compiles a step's marks at every size it
 * measures it at — and a diagram's style is replaced, never edited.
 */
function seenStyle(style: DiagramStyle): PaperStyle {
  let seen = seenStyles.get(style);
  if (seen === undefined) {
    seen = applyPaperStylePolicy(diagramPaperStyle(style), PAPER_STYLE_POLICIES.references);
    seenStyles.set(style, seen);
  }
  return seen;
}

const seenStyles = new WeakMap<DiagramStyle, PaperStyle>();

/**
 * `make(seen)`, made once per seen style ({@link seenStyle}'s, one per
 * diagram style): the inks are worked out from its colours — the faint
 * crease's alpha by a search over the paper's lightness — which costs more
 * than compiling a step's marks.
 */
function perSeenStyle<T>(make: (seen: PaperStyle) => T): (seen: PaperStyle) => T {
  const made = new WeakMap<PaperStyle, T>();
  return (seen) => {
    let value = made.get(seen);
    if (value === undefined) {
      value = make(seen);
      made.set(seen, value);
    }
    return value;
  };
}

/** The style's arrow ink: what a solid line with no colour of its own is drawn in (17a). */
export function annotationInkColor(style: DiagramStyle): string {
  return seenStyle(style).arrows.color;
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

/** The marks' colours as a References step's are given them in a file, before an annotation's own are made of them. */
const seenInk = perSeenStyle(
  (seen): DiagramInlineInk =>
    diagramInlineInk({
      ...referencesPaperTokens(seen),
      '--cp-reference-input': REFERENCE_COLORS.light.input,
      '--bg-primary': PAGE_GROUND,
    })
);

/**
 * The marks' colours as attributes: the style's arrow ink, one ink on and off
 * the paper, so nothing is clipped (`oneInk`) — a solid line with no colour
 * of its own, which References draws in its reference ink, and a circle's
 * ring too, which
 * References draws in the paper's edge ink: here it is the author's mark,
 * as the arrows are (decision 7). A hollow push is the page's white inside,
 * not the paper's face: there is no paper under an annotation to match, and
 * it may lie on a photo, on either face, or off the picture.
 */
const annotationInk = perSeenStyle((seen): DiagramInlineInk => {
  const ink = seenInk(seen);
  return {
    ...ink,
    // A solid line with no colour of its own is in the arrows' ink (17a).
    lines: { ...ink.lines, highlight: ink.lines.arrow },
    mark: ink.arrowhead,
    sheet: { ...ink.sheet, front: PAGE_GROUND, back: PAGE_GROUND },
    ground: { arrow: ink.arrowhead, mark: ink.arrowhead },
  };
});

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
    case 'solid-line':
      // References' reference-line pen, in its own colour or, with none, the style's arrow ink (`annotationInk`).
      return {
        kind: 'mark',
        primitive: {
          kind: 'line',
          from: up(from),
          to: up(to),
          style: 'highlight',
          ...(annotation.color !== undefined ? { ink: annotation.color } : {}),
        },
      };
    case 'label': {
      const text = annotation.text ?? '';
      if (text.trim() === '') return null;
      // Its options (17b), each only as it is set: a label with none compiles as one did before them.
      const { color, bold, halo, sizePt, offsetPt } = annotation;
      const style: CompiledTextStyle = {
        ...(color !== undefined ? { color } : {}),
        ...(bold ? { bold } : {}),
        ...(halo ? { halo } : {}),
        ...(sizePt !== undefined ? { sizePt } : {}),
        ...(offsetPt !== undefined ? { offsetPt } : {}),
      };
      return { kind: 'label', at: from, runs: labelRuns(text), style };
    }
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow': {
      const shape = arrowShape(annotation);
      if (shape.kind === 'path') {
        // A path of no length draws nothing, as an arc between two ends that meet does not.
        if (!(pathLength(shape.path) > 0)) return null;
        const cubics = (nodes: readonly DiagramPathNode[]) =>
          pathCubics(nodes).map(([a, b, c, d]) => [up(a), up(b), up(c), up(d)] as const);
        // A return shaped by hand is its own path; one never shaped is derived where it is drawn.
        const back = annotation.kind === 'fold-unfold-arrow' && annotation.back ? { back: cubics(annotation.back) } : {};
        return { kind: 'mark', primitive: { kind: 'path-arrow', path: cubics(shape.path), fold: PATH_FOLD[annotation.kind], ...back } };
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
    case 'star':
      // Its fill as a white arrow's; its turn and size its own, on the page (Revision 3).
      return {
        kind: 'mark',
        primitive: {
          kind: 'star',
          at: up(from),
          fill: annotation.fill ?? 'white',
          angle: glyphAngleOf(annotation),
          scale: glyphScaleOf(annotation),
        },
      };
    case 'eye':
      // The way it looks, the picture's — the sheet's as `up` turns it — and its size its own (Revision 3).
      return {
        kind: 'mark',
        primitive: { kind: 'eye', at: up(from), angle: glyphAngleOf(annotation), scale: glyphScaleOf(annotation) },
      };
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
    case 'divisions':
      // Their side is the picture's, which the y-up sheet and the drawing's
      // y-down page both keep, as a pleat arrow's is; their offset, stored in
      // mm as it prints, in the drawing's ink.
      return {
        kind: 'mark',
        primitive: {
          kind: 'divisions',
          from: up(from),
          to: up(to),
          parts: divisionsPartsOf(annotation),
          offset: divisionsOffsetOf(annotation) / ANNOTATION_INK_MM,
          mirrored: annotation.mirrored === true,
          ticks: annotation.ticks ?? 1,
          numbered: annotation.numbered === true,
          shortDividers: annotation.shortDividers === true,
        },
      };
    case 'close-up':
      return { kind: 'close-up', shape: closeUpShape(annotation) };
    // An enlarge area marks what a later step shows enlarged: its outline.
    case 'zoom':
      return { kind: 'zoom', outline: zoomOutlineOf(annotation) };
    case 'oval':
    case 'rectangle':
      // An outline round an area, sized in picture units and turned by its angle (Revision 3).
      return { kind: 'area', outline: areaOutlineOf(annotation) };
    // A window cut into the picture (Revision 3): a circle, as Enlarge's is.
    case 'x-ray':
      return { kind: 'x-ray', outline: zoomOutlineOf(annotation) };
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

/**
 * The runs of text a step's labels and callouts set, each in its face, Han in
 * the diagram's style, at its weight — a bold label's (17b) at 700, so the
 * page loads and embeds Noto Sans Bold, or its CJK face's Bold: for the
 * page's fonts.
 */
export function annotationTextRuns(
  annotations: readonly DiagramAnnotation[],
  hanStyle: DiagramHanStyle
): UploadTextRun[] {
  const runs: UploadTextRun[] = [];
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation) || !carriesText(annotation.kind)) continue;
    const weight = annotation.kind === 'label' && annotation.bold ? 700 : 400;
    for (const run of labelRuns(annotation.text ?? '')) {
      runs.push({ face: { key: run.key === UPLOAD_HAN_KEY ? hanStyle : run.key, weight }, text: run.text });
    }
  }
  return runs;
}

/**
 * Where a mark lies behind a flap (15e), as shares of its length from its
 * tail — a circle's, of its ring — worked out along the line it is drawn
 * along: a fold arrow's arc or path, a pleat arrow's or a line's chord.
 * Nothing for a mark in front, or of a kind no end of which is ever behind.
 */
function behindStretches(annotation: KnownDiagramAnnotation, layers: PictureLayers, ringRadius: number): HiddenStretches | undefined {
  const { behind } = annotation;
  if (!behind || behindEnds(annotation.kind).length === 0) return undefined;
  if (annotation.kind === 'circle') return behind.from ? hiddenArcs(annotation.from, ringRadius, behind.from, layers) : undefined;
  const line = isArrowKind(annotation.kind) ? arrowPolyline(annotation) : [annotation.from, annotation.to];
  return hiddenStretches(line, behind, layers);
}

/** A mark drawn with its `hidden` stretches dotted: the kinds a stretch behind a flap is drawn on. */
function withHidden(primitive: AnnotationPrimitive, hidden: HiddenStretches): AnnotationPrimitive {
  switch (primitive.kind) {
    case 'fold-arrow':
    case 'one-way-arrow':
    case 'path-arrow':
    case 'pleat-arrow':
    case 'point':
    case 'line':
      return { ...primitive, hidden };
    default:
      return primitive;
  }
}

/**
 * The annotations compiled for a frame `frame` whose longer side is `framePx`
 * CSS px. One this build cannot read is not drawn: only its own build knows
 * what it is. Given its picture's `layers` — a flat fold's — a mark behind a
 * flap is dotted where it is under it (15e); without, it is drawn in front.
 * Given its `paper` — a References picture's (17b) — a label's halo is
 * filled with the face it stands on, and across the sheet's edge with the
 * face on it and the page's white off it (rf6); without, with the page's
 * white.
 */
export function annotationDrawing(
  annotations: readonly DiagramAnnotation[],
  frame: PictureFrame,
  framePx: number,
  style: DiagramStyle,
  layers: PictureLayers | null = null,
  paper: AnnotationPaper | null = null
): AnnotationDrawing {
  const seen = seenStyle(style);
  // What a halo is filled with, by where the label lies on the paper, in the drawing's px (17b, rf6).
  const haloOf = haloPaint(seen, paper, framePx);
  const ink = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH);
  const arrowCss = seen.arrows.width * PT_TO_CSS_PX;
  // The aux creases' pen, at its pt width: what the marks that measure — a right angle, equal divisions — are drawn in (`auxMarkPen`).
  const aux = { pen: seen.auxCreases.pen, css: seen.auxCreases.pen.width * PT_TO_CSS_PX };
  const pens = canvasDiagramPens(STEP_DIAGRAM_LINE_WIDTH, arrowCss, aux);
  // The arrow is the style's pen, at its pt width, as on a References step's
  // page; and a solid line (17a), References' reference line, the arrow's
  // weight with no floor, as the baked scene draws it (`diagramToPaperScene`).
  const project = createOverlayProjector({ origin: [0, 0], ex: [framePx, 0], ey: [0, -framePx] }, ink, {
    ...pens,
    arrow: penInk(seen.arrows, arrowCss / ink),
    highlight: { ...pens.highlight, width: arrowCss / ink },
  });
  // The pens the lines are painted in, as `paintAnnotations` and the canvas paint them.
  const surface = diagramSurfaceStyle(style);
  const lines: AnnotationLine[] = [];
  const primitives: AnnotationPrimitive[] = [];
  const primitiveIds: string[] = [];
  const closeUps: AnnotationCloseUp[] = [];
  const zoomAreas: AnnotationZoomArea[] = [];
  const areas: AnnotationArea[] = [];
  const xRays: AnnotationXRay[] = [];
  // An x-ray's rim (R3-15b (ii)): 1.5 × the edges' pen, in its ink.
  const rim = { width: XRAY_RIM_EDGES * surface.edges.width * PT_TO_CSS_PX, color: surface.edges.color };
  const callouts: AnnotationCallout[] = [];
  const labels: AnnotationLabel[] = [];
  const at = ([u, v]: PicturePoint): [number, number] => [u * framePx, v * framePx];
  // A callout's pens: the arrow pen round its box, the annotation pen — a circle's ring's — along its line.
  const boxPen = calloutPen(style);
  const linePen = markRingWidth(project);
  // A circle's ring, in picture units: where a ring behind a flap is worked out.
  const ringRadius = (project.marks.ringRadius * project.ink) / framePx;
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation)) continue;
    const compiled = compiledAnnotation(annotation);
    if (!compiled) continue;
    // Behind a flap, on a picture that knows its layers.
    const hidden = layers && annotation.behind ? behindStretches(annotation, layers, ringRadius) : undefined;
    switch (compiled.kind) {
      case 'line': {
        const [a, b] = [at(compiled.from), at(compiled.to)];
        if (!hidden?.length) {
          lines.push({ id: annotation.id, role: compiled.role, a, b, halfWidth: ((penForRole(surface, compiled.role)?.width ?? 0) * PT_TO_CSS_PX) / 2 });
          break;
        }
        // A line behind a flap is a drawn piece and a hidden-line piece, each its role's pen.
        strokePieces(0, 1, hidden).forEach((piece, part) => {
          const role = piece.hidden ? 'diagram-hidden' : compiled.role;
          lines.push({
            id: annotation.id,
            part,
            role,
            a: [a[0] + (b[0] - a[0]) * piece.start, a[1] + (b[1] - a[1]) * piece.start],
            b: [a[0] + (b[0] - a[0]) * piece.end, a[1] + (b[1] - a[1]) * piece.end],
            halfWidth: ((penForRole(surface, role)?.width ?? 0) * PT_TO_CSS_PX) / 2,
          });
        });
        break;
      }
      case 'label': {
        const [ax, ay] = at(compiled.at);
        const runs = compiled.runs.map((run) => ({ family: uploadTextFamily(run.key), text: run.text }));
        const { color, bold, halo, sizePt, offsetPt } = compiled.style;
        // Its options (17b): words hung off its anchor by a print length, a size
        // in pt, its own colour; each, unset, as a label was drawn before them.
        const x = offsetPt ? ax + offsetPt[0] * PT_TO_CSS_PX : ax;
        const y = offsetPt ? ay + offsetPt[1] * PT_TO_CSS_PX : ay;
        const size = sizePt !== undefined ? sizePt * PT_TO_CSS_PX : LABEL_SIZE * framePx;
        const drawn: AnnotationLabel = { id: annotation.id, x, y, size, fill: color ?? seen.arrows.color, runs, ...(bold ? { bold } : {}) };
        labels.push(halo ? { ...drawn, halo: haloOf(drawn, TEXT_HALO_EMS * size) } : drawn);
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
      case 'close-up': {
        const { area, inset, line, scale } = compiled.shape;
        const box = closeUpFrame(compiled.shape, frame);
        closeUps.push({
          id: annotation.id,
          area: { x: area.centre[0] * framePx, y: area.centre[1] * framePx, r: area.radius * framePx },
          inset: { x: inset.centre[0] * framePx, y: inset.centre[1] * framePx, r: inset.radius * framePx },
          line: line ? { a: at(line[0]), b: at(line[1]) } : null,
          pen: linePen,
          ink: seen.arrows.color,
          ground: PAGE_GROUND,
          scale,
          frame: { x: box.x * framePx, y: box.y * framePx, width: box.width * framePx, height: box.height * framePx },
        });
        break;
      }
      case 'zoom': {
        const { centre, radius, size, angle } = compiled.outline;
        const rounded = zoomShapeOf(compiled.outline) === 'rounded';
        zoomAreas.push({
          id: annotation.id,
          outline: {
            centre: at(centre),
            ...(radius !== undefined ? { radius: radius * framePx } : {}),
            ...(size !== undefined ? { size: [size[0] * framePx, size[1] * framePx] as [number, number] } : {}),
            ...(angle ? { angle } : {}),
          },
          pen: linePen,
          ink: seen.arrows.color,
          casing: rounded ? linePen + 2 * ZOOM_CASING_INKS * project.ink : null,
          ground: PAGE_GROUND,
        });
        break;
      }
      case 'area': {
        // An oval or a rectangle (Revision 3): its outline in the ring's pen and the arrows' ink, nothing filled.
        const { outline } = compiled;
        areas.push({
          id: annotation.id,
          outline: { ...outline, centre: at(outline.centre), size: [outline.size[0] * framePx, outline.size[1] * framePx] },
          pen: linePen,
          ink: seen.arrows.color,
        });
        break;
      }
      case 'x-ray': {
        const { centre, radius } = compiled.outline;
        xRays.push({ id: annotation.id, window: { x: centre[0] * framePx, y: centre[1] * framePx, r: (radius ?? 0) * framePx }, rim });
        break;
      }
      case 'mark':
        primitives.push(hidden?.length ? withHidden(compiled.primitive, hidden) : compiled.primitive);
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
    areas,
    lines,
    primitives,
    primitiveIds,
    context,
    zoomAreas,
    closeUps,
    xRays,
    callouts,
    labels,
  };
}

/** A label's halo, `width` wide in the drawing's px (17b, rf6). */
type HaloPaint = (label: AnnotationLabel, width: number) => NonNullable<AnnotationLabel['halo']>;

/**
 * What a halo is filled with on a drawing `framePx` across, by where its
 * label reaches ({@link labelReach}) on a References picture's sheet: wholly
 * on it, the paper's face the picture shows — read from the style's inks
 * before an annotation's whiten them (17b); wholly off it, the page's white;
 * across its edge (rf6), the face on the sheet and the page's white off it
 * (`sheetHalo`), so the halo follows the edge exactly. On every other
 * picture, the page's white. A face that is the page's white is one colour
 * wherever it lies.
 */
function haloPaint(seen: PaperStyle, paper: AnnotationPaper | null, framePx: number): HaloPaint {
  if (!paper || paper.outline.length < 3) return (_, width) => ({ color: PAGE_GROUND, width });
  const { sheet } = seenInk(seen);
  const face = paper.back ? sheet.back : sheet.front;
  if (face.toLowerCase() === PAGE_GROUND) return (_, width) => ({ color: PAGE_GROUND, width });
  const outline = paper.outline.map(([x, y]) => ({ x: x * framePx, y: y * framePx }));
  const paint = sheetHalo(outline, face, PAGE_GROUND, 'annotation-halo-');
  return (label, width) => ({ ...paint(labelReach(label, width), label.size), width });
}

/**
 * What a label reaches, in its drawing's px: its words at their size and
 * weight, and a halo `haloWidth` wide half that past them (17b). The box a
 * file is cropped to ({@link annotationReach}), so a halo never reaches past
 * it: wholly inside the sheet, it is wholly on it.
 */
function labelReach(label: AnnotationLabel, haloWidth: number): ReachBox {
  const halo = haloWidth / 2;
  const half = labelHalfWidth(label.runs.map((run) => run.text).join(''), { bold: label.bold, size: label.size }) + halo;
  return { minX: label.x - half, maxX: label.x + half, minY: label.y - label.size - halo, maxY: label.y + label.size + halo };
}

/**
 * Whether equal divisions crowd on a picture whose frame `frame` prints
 * `frameMm` across its longer side: a part too short for its ticks even at
 * their floor (ED10), measured as a page draws them at that size.
 */
export function divisionsCrowded(
  annotation: KnownDiagramAnnotation,
  frame: PictureFrame,
  frameMm: number,
  style: DiagramStyle
): boolean {
  if (annotation.kind !== 'divisions' || !(frameMm > 0)) return false;
  const drawing = annotationDrawing([annotation], frame, mmToCssPx(frameMm), style);
  const primitive = drawing.primitives[0];
  if (primitive?.kind !== 'divisions') return false;
  return divisionsDrawn(primitive.from, primitive.to, primitive, drawing.context.project)?.crowded ?? false;
}

/**
 * The annotations a close-up draws again inside it (15f): every one but the
 * close-ups, which never show in each other.
 */
export function closeUpMarks(annotations: readonly DiagramAnnotation[]): DiagramAnnotation[] {
  return annotations.filter((annotation) => !isKnownAnnotation(annotation) || annotation.kind !== 'close-up');
}

/**
 * What a drawing reaches, in its own px: its frame, and past it whatever its
 * marks reach — an arrow may start off the picture — as far as their ink and
 * no further: it is the room a page leaves a picture and the box a step's
 * file is cropped to, so a mark cut there is lost and a reach past its ink
 * is paper taken from the picture for nothing. Measured as a page draws the
 * marks (`paintAnnotations`), every join of a stroke round unless the mark
 * mitres its own. An x-ray's window only with `xRays`, on a surface that
 * draws it — every surface, on a step with layers (R3-18b A): no room grows
 * for a rim it does not print (review of 18e).
 */
export function annotationReach(
  drawing: AnnotationDrawing,
  { xRays = false }: { xRays?: boolean } = {}
): { x: number; y: number; width: number; height: number } {
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
  // Its marks as drawn: as far as their ink, and no further (`markReach`); a
  // solid line (17a) its pen's half-width round each end, as far as its round
  // cap reaches, and its sides.
  for (const primitive of drawing.primitives) {
    if (primitive.kind === 'line') {
      const half = strokeAttributes(primitive.style, ink, project.dashScale, project.pens).strokeWidth / 2;
      for (const end of [primitive.from, primitive.to]) {
        const { x, y } = project(end);
        take(x, y, half);
      }
    } else {
      markReach(primitive, project, drawing.context.marks, take);
    }
  }
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
  // An oval or a rectangle (Revision 3), its outline and half its pen round
  // it, exactly: an ellipse's turned extents, a mitred rectangle's corners.
  for (const { outline, pen } of drawing.areas) {
    const box = areaBox(outline, pen / 2);
    take(box.x, box.y, 0);
    take(box.x + box.width, box.y + box.height, 0);
  }
  // An enlarge area, its outline and half its pen or its casing, the wider,
  // round it: a turned rectangle's box.
  for (const { outline, pen, casing } of drawing.zoomAreas) {
    const box = frameWindow(outline);
    const half = Math.max(pen, casing ?? 0) / 2;
    take(box.x, box.y, half);
    take(box.x + box.width, box.y + box.height, half);
  }
  // An x-ray's window, its rim and half its pen round it (Revision 3), where it is drawn.
  if (xRays) for (const { window, rim } of drawing.xRays) take(window.x, window.y, window.r + rim.width / 2);
  // A close-up, its two rings and half their pen round them: its line runs
  // between their rims, and its inside is drawn within the outer one.
  for (const { area, inset, pen } of drawing.closeUps) {
    take(area.x, area.y, area.r + pen / 2);
    take(inset.x, inset.y, inset.r + pen / 2);
  }
  // A label at its size and weight, and its halo half its width past its letters (17b).
  for (const label of drawing.labels) {
    const reach = labelReach(label, label.halo?.width ?? 0);
    minX = Math.min(minX, reach.minX);
    maxX = Math.max(maxX, reach.maxX);
    minY = Math.min(minY, reach.minY);
    maxY = Math.max(maxY, reach.maxY);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const round = (value: number) => Number(value.toFixed(3));

/**
 * One label as SVG: a `<text>` of runs, each run its own font as an upload's
 * are. Bold (17b) writes its weight on the text and each run, which a page
 * reads off the markup to set and embed it (`setUploadText`); a halo is a
 * stroke painted under the fill, round at its joins, as References draws its
 * letters'. A label with neither is the markup it always was.
 *
 * A halo across the sheet's edge (rf6) is the same one stroke, painted with
 * its pattern (`haloPatternElement`, which says why one stroke), which goes
 * in the document with it, its id under `scope` when one is given.
 */
function labelElement(label: AnnotationLabel, scope = ''): ReactNode {
  const { halo } = label;
  const across = halo?.across;
  const text = (
    <text
      key={across ? undefined : label.id}
      x={round(label.x)}
      y={round(label.y + LABEL_BASELINE * label.size)}
      fontSize={round(label.size)}
      textAnchor="middle"
      fill={label.fill}
      fontWeight={label.bold ? 700 : undefined}
      stroke={across ? `url(#${across.id}${scope})` : halo?.color}
      strokeWidth={halo ? round(halo.width) : undefined}
      strokeLinejoin={halo ? 'round' : undefined}
      paintOrder={halo ? 'stroke' : undefined}
    >
      {label.runs.map((run, index) => (
        <tspan key={index} fontFamily={run.family} fontWeight={label.bold ? 700 : 400}>
          {run.text}
        </tspan>
      ))}
    </text>
  );
  if (!halo || !across) return text;
  return (
    <g key={label.id}>
      {haloPatternElement(across, halo.color, scope)}
      {text}
    </g>
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

/** One close-up's rings and the line between them as SVG (15f): its inside is the surface's, under the marks. */
export function closeUpElement(closeUp: AnnotationCloseUp): ReactNode {
  const { area, inset, line } = closeUp;
  const pen = { fill: 'none', stroke: closeUp.ink, strokeWidth: round(closeUp.pen) };
  return (
    <g key={closeUp.id}>
      <circle cx={round(area.x)} cy={round(area.y)} r={round(area.r)} {...pen} />
      {line && (
        <line
          x1={round(line.a[0])}
          y1={round(line.a[1])}
          x2={round(line.b[0])}
          y2={round(line.b[1])}
          {...pen}
          strokeLinecap="round"
        />
      )}
      <circle cx={round(inset.x)} cy={round(inset.y)} r={round(inset.r)} {...pen} />
    </g>
  );
}

/**
 * One enlarge area as SVG (Revision 2): a rounded rectangle's white casing,
 * then its outline in the annotation pen, turned with it; a circle its
 * outline alone.
 */
export function zoomAreaElement(area: AnnotationZoomArea): ReactNode {
  const { outline } = area;
  const [cx, cy] = outline.centre;
  const shape = (paint: { stroke: string; strokeWidth: number }, key: string) => {
    if (zoomShapeOf(outline) === 'circle') {
      return <circle key={key} cx={round(cx)} cy={round(cy)} r={round(outline.radius!)} fill="none" {...paint} />;
    }
    const [width, height] = outline.size!;
    const r = round(zoomCornerRadius(outline));
    return (
      <rect
        key={key}
        x={round(cx - width / 2)}
        y={round(cy - height / 2)}
        width={round(width)}
        height={round(height)}
        rx={r}
        ry={r}
        fill="none"
        transform={outline.angle ? `rotate(${round(outline.angle)} ${round(cx)} ${round(cy)})` : undefined}
        {...paint}
      />
    );
  };
  return (
    <g key={area.id}>
      {area.casing !== null && shape({ stroke: area.ground, strokeWidth: round(area.casing) }, 'casing')}
      {shape({ stroke: area.ink, strokeWidth: round(area.pen) }, 'outline')}
    </g>
  );
}

/**
 * One oval or rectangle as SVG (Revision 3): an `<ellipse>`, or a `<rect>`
 * whose corners are mitred square whatever join the caller wraps it in
 * (R3-11b A), turned with it, in its pen and ink, nothing filled.
 */
export function areaElement(area: AnnotationArea): ReactNode {
  const { outline } = area;
  const [cx, cy] = outline.centre;
  const [width, height] = outline.size;
  const paint = {
    fill: 'none',
    stroke: area.ink,
    strokeWidth: round(area.pen),
    transform: outline.angle ? `rotate(${round(outline.angle)} ${round(cx)} ${round(cy)})` : undefined,
  };
  return outline.kind === 'rectangle' ? (
    <rect
      key={area.id}
      x={round(cx - width / 2)}
      y={round(cy - height / 2)}
      width={round(width)}
      height={round(height)}
      strokeLinejoin="miter"
      {...paint}
    />
  ) : (
    <ellipse key={area.id} cx={round(cx)} cy={round(cy)} rx={round(width / 2)} ry={round(height / 2)} {...paint} />
  );
}

/**
 * The ovals and rectangles, as React (Revision 3): painted before the step's
 * lines and every mark (R3-11d B), which a surface draws after them. `wrap`
 * puts each in a group of the caller's, by its annotation's id.
 */
export function annotationAreas(drawing: AnnotationDrawing, wrap?: (shape: ReactNode, annotationId: string) => ReactNode): ReactNode {
  return drawing.areas.map((area) => (wrap ? wrap(areaElement(area), area.id) : areaElement(area)));
}

/**
 * The marks, enlarge areas, close-ups, callouts and labels, as React: the
 * shapes `diagramShapes` draws, the enlarge areas and the close-ups' rings
 * over them, the callouts over those, then the labels over everything. `wrap` puts each in a group of the
 * caller's, by its annotation's id. A halo's pattern across the sheet's edge
 * (rf6) goes with its label, as References' clips go with its marks
 * (`diagramShapes`): a `url(#…)` the document does not hold paints nothing.
 * `scope` follows each of their ids, for a surface that shares one document
 * with others: the canvas.
 */
export function annotationMarks(
  drawing: AnnotationDrawing,
  wrap?: (shape: ReactNode, annotationId: string) => ReactNode,
  scope = ''
): ReactNode {
  const shapes = diagramShapes(drawing.primitives, drawing.context, {
    wrap: wrap ? (shape, index) => wrap(shape, drawing.primitiveIds[index]!) : undefined,
  });
  return (
    <>
      {shapes}
      {drawing.zoomAreas.map((area) => (wrap ? wrap(zoomAreaElement(area), area.id) : zoomAreaElement(area)))}
      {drawing.closeUps.map((closeUp) => (wrap ? wrap(closeUpElement(closeUp), closeUp.id) : closeUpElement(closeUp)))}
      {drawing.callouts.map((callout) => (wrap ? wrap(calloutElement(callout), callout.id) : calloutElement(callout)))}
      {drawing.labels.map((label) => (wrap ? wrap(labelElement(label, scope), label.id) : labelElement(label, scope)))}
    </>
  );
}

/**
 * The drawing as a paper scene: its ovals and rectangles as one markup item
 * under everything (Revision 3, R3-11d B), its lines as lines, its marks and
 * labels as one markup item over them. Its fraction digits are set in Noto
 * Sans, as a References step's letters are on a page. Null when it draws
 * nothing.
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
  const areas = renderToStaticMarkup(annotationAreas(drawing));
  const items: PaperItem[] = [];
  if (areas !== '') items.push({ kind: 'markup', svg: areas, bounds, hidden: false });
  items.push(...lines);
  if (svg !== '') items.push({ kind: 'markup', svg, bounds, hidden: false });
  if (items.length === 0) return null;
  return { bounds, sheet: Math.max(drawing.width, drawing.height), items };
}
