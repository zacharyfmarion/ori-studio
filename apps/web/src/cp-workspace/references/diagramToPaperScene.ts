/**
 * A step diagram as a paper scene: what the painter needs to put a precrease
 * step on a page in the paper style, from the same `StepDiagramModel` the
 * card and the big view draw.
 *
 * The paper is one face and the step's lines are lines with roles, so the
 * painter draws them with the style's pens and erodes an aux-pen line at the
 * sheet's edge, exactly as it does for a folded figure. Which of those lines
 * are on the page is decided here rather than by the painter's aux switch: the
 * creases an earlier step made always are, and the pattern's own aux lines
 * are when the caller's option says so — References' "Show auxiliary creases"
 * (`referencesAuxCreases`) — or, without one, the style's switch. Everything
 * the painter has no word for — the fold arrow, the turn-over glyph, a band's
 * wash, the rings and the letters — is drawn by `diagramShapes`, the one
 * implementation that draws them on screen, into a markup item with its
 * colours written in.
 *
 * Nothing here is References' own. The caller names the surface whose policy
 * the style is read through and the tokens the markup is inked from:
 * References passes its `references` policy and its workspace tokens (D12,
 * D13; `referencesMarkupTokens`). No React state and no store: a test hands
 * it a model and reads the page.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  PaperItem,
  PaperLineItem,
  PaperLineRole,
  PaperMarkupItem,
  PaperScene,
  SceneBounds,
  ScenePoint,
} from '../../lib/paper/paperScene';
import { PT_TO_CSS_PX, type Hex, type PaperStyle } from '../../lib/paper/paperStyle';
import {
  applyPaperStylePolicy,
  PAPER_STYLE_POLICIES,
  surfacePaperStyle,
  type PaperSurface,
} from '../../lib/paper/paperStyleResolve';
import {
  createDiagramRenderContext,
  diagramShapes,
  type DiagramRenderContext,
} from '../../lib/stepDiagram/DiagramPrimitives';
import { diagramInlineInk, type DiagramMarkupTokens } from '../../lib/stepDiagram/diagramColors';
import { placeLabels, type LabelLayoutOptions, type LabelPlacement } from '../../lib/stepDiagram/labelLayout';
import { penInk } from '../../lib/stepDiagram/diagramInk';
import { isDiagramMark, markReach } from '../../lib/stepDiagram/markReach';
import { seenFromTheBack } from '../../lib/stepDiagram/diagramModel';
import type {
  DiagramLineStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from '../../lib/stepDiagram/stepDiagramModel';
import {
  DIAGRAM_PADDING,
  arcExtremes,
  arcPolyline,
  onSheetBoundary,
  sheetCorners,
  withPens,
  type DiagramProjector,
  type SheetPoint,
} from '../../lib/stepDiagram/stepDiagramGeometry';

export interface DiagramToPaperSceneOptions {
  /** The style the step is painted in, before the surface's policy. */
  style: PaperStyle;
  /**
   * The surface whose policy the style is read through
   * (`PAPER_STYLE_POLICIES`): which of its fields the scene takes — the
   * paper, the pens, the arrow — and so the switch the pattern's aux lines
   * follow when `showAux` does not say. A References step passes
   * `references`, on its own pages and on a Diagram's.
   */
  surface: PaperSurface;
  /**
   * Sheet units to scene px: the fit a card draws through, or the big view's
   * projector at the page's scale (`referencesStepScene`). Its `mirrored`
   * says the picture is of the paper's back, and the scene follows it — the
   * sheet's back, every fold named from that side — as the card follows the
   * flag it built its projector from.
   */
  project: DiagramProjector;
  /**
   * The picture is of the paper's back. Absent, it is read off the projector,
   * which is right for a unit-frame model drawn through a fit; a model-frame
   * model's frame already reverses handedness (`frame.rs`: `y_axis` is screen
   * "up", a left-handed pair), so a projector onto the canvas reports the
   * opposite of which face the reader is on. The panel knows that
   * (`sideAt`) and says so here; the projector's flag keeps deciding the
   * sweep of an arc and the turn of an arrowhead in the markup, which is what
   * it is for.
   */
  mirrored?: boolean;
  /**
   * Whether the pattern's aux lines are on the page: the surface's own
   * option, References' "Show auxiliary creases". Absent or null follows the
   * style's switch as the surface reads it.
   */
  showAux?: boolean | null;
  /**
   * The colours the markup is written in, from the style as the surface
   * reads it — its policy applied — by the names the card's classes read them
   * by: the paper, the pens' inks, and the accent every letter is inked in.
   * The ground is the page's, `ground`. References' are its workspace tokens
   * (`referencesMarkupTokens`).
   */
  markupTokens: (seen: PaperStyle) => DiagramMarkupTokens;
  /**
   * The bounds grown to hold every mark as it is drawn — its arrows, glyphs
   * and rings (`markReach`), and its accent lines in their pens — not only
   * its letters: for a step on a Diagram page, whose arrow pen is the
   * author's and may be far heavier than a card's, and whose sheet may be
   * small, so its arrows leave the padding band a card keeps for them.
   */
  marksInBounds?: boolean;
  /**
   * The ground a letter's halo is painted in — the page's background, or
   * white when the page has none, since a letter is pushed off the sheet on
   * purpose and its halo is what it stands on there. On screen it is the
   * workspace's ground. A mark that leaves the sheet — an arrow, the turn-over
   * glyph, a ring — is inked against it there: the style's ink where that
   * reads, black or white where it does not (`referencesGroundInk`).
   */
  ground?: Hex;
}

/** The ground when the page has none: a printed diagram's paper, which is how a transparent page reads. */
const DEFAULT_GROUND: Hex = '#ffffff';

/**
 * Which pen a line style draws with on the page. A step's mountain and valley
 * are its instruction — fold here, this way — so they take the diagram-crease
 * pens, not the fold pens a crease pattern is drawn in; the finished card's
 * lines are that pattern, and take the fold pens. A style not here — the
 * accent's `highlight`, an `arrow` drawn as a plain line, a pinch of no known
 * direction — has no pen of its own in the style and keeps its on-screen
 * look through the markup instead.
 */
const LINE_ROLES: Partial<Record<DiagramLineStyleName, PaperLineRole>> = {
  edge: 'edge',
  mountain: 'diagram-mountain',
  'pinch-mountain': 'diagram-mountain',
  valley: 'diagram-valley',
  'pinch-valley': 'diagram-valley',
  'fold-mountain': 'mountain',
  'fold-valley': 'valley',
  crease: 'aux',
  aux: 'aux',
  dotted: 'aux',
  unfolded: 'aux',
};

/**
 * The scene for a step. Items in draw order: the sheet, then a band's wash
 * (drawn under the lines on screen, so under them here), then the lines as the
 * model orders them, then the sheet's border over them, then the symbols over
 * everything. `bounds`
 * is the card's box round the sheet — the padding band a letter at a corner is
 * pushed into — grown to whatever the letters took, and `sheet` is the paper's
 * longer side in scene px, the unit erode is measured in.
 */
export function diagramToPaperScene(
  model: StepDiagramModel,
  options: DiagramToPaperSceneOptions
): PaperScene {
  const { seen, project, mirrored, drawn } = sceneDrawing(model, options);
  const showAux = options.showAux ?? seen.auxCreases.visible;
  const sheet = model.sheet;
  const point = (p: SheetPoint): ScenePoint => {
    const { x, y } = project(p);
    return [x, y];
  };

  const outline = sheetCorners(sheet);
  const corners = outline.map(point);
  const sheetPx = Math.max(sheet.width, sheet.height) * project.scale;

  const context = createDiagramRenderContext(drawn, sheet, project, {
    layout: LETTER_LAYOUT,
    creases: { showAux, erode: seen.erode },
    // The page's ground is also what a mark off the sheet is inked against:
    // the style's ink where that reads on it, black or white where it does
    // not (X11 of the paper export plan). The paper it is clipped to is the
    // face below, the sheet's own corners.
    inline: diagramInlineInk({
      ...options.markupTokens(seen),
      '--bg-primary': options.ground ?? DEFAULT_GROUND,
    }),
    // The face below, which a letter on it is haloed in: the caller's word
    // over the projector's handedness, as for the face itself.
    back: mirrored,
  });

  /** A line on the sheet, in scene px; an aux line's end on the sheet's edge is flagged for erode. */
  const lineItem = (role: PaperLineRole, from: SheetPoint, to: SheetPoint): PaperLineItem => ({
    kind: 'line',
    role,
    a: point(from),
    b: point(to),
    onBoundary:
      role === 'aux'
        ? [onSheetBoundary(from, sheet), onSheetBoundary(to, sheet)]
        : [false, false],
    face: 0,
    hidden: false,
  });

  const lines: PaperLineItem[] = [];
  const washes: number[] = [];
  const symbols: number[] = [];
  drawn.forEach((primitive, index) => {
    switch (primitive.kind) {
      case 'sheet':
        // The face and the outline below are the sheet, wherever the frame
        // put it.
        return;
      case 'line': {
        if (primitive.style === 'aux' && !showAux) return;
        const role = LINE_ROLES[primitive.style];
        if (role === undefined) symbols.push(index);
        else lines.push(lineItem(role, primitive.from, primitive.to));
        return;
      }
      case 'arc': {
        const role = LINE_ROLES[primitive.style];
        if (role === undefined) {
          symbols.push(index);
          return;
        }
        // The painter has no arc: the runs between the arc's samples.
        const run = arcPolyline(primitive);
        for (let i = 1; i < run.length; i += 1) {
          lines.push(lineItem(role, run[i - 1]!, run[i]!));
        }
        return;
      }
      case 'region':
        washes.push(index);
        return;
      default:
        symbols.push(index);
    }
  });

  const bounds = paddedBounds(corners, sheetPx, context.labels);
  if (options.marksInBounds) grownToMarks(bounds, drawn, symbols, project, context);
  const items: PaperItem[] = [
    {
      kind: 'face',
      face: 0,
      side: mirrored ? 'back' : 'front',
      rings: [corners],
      shade: 1,
      hidden: false,
    },
  ];
  const wash = markupItem(drawn, washes, context, bounds);
  if (wash) items.push(wash);
  items.push(...lines);
  // The paper's border. On screen it is drawn for us — the card strokes the
  // sheet rect, the big view has the document's own border creases under the
  // overlay — but a page carries only what the scene says, and a face is
  // closed with a hairline in its own fill, never the edge pen. Without its
  // sides a light paper on a blank page is invisible but for its creases, where
  // every other surface's export draws its outline. Over the step's lines, not
  // under them: a crease that ends on the edge, drawn after it, laid its own
  // grey across the outline and broke it into pieces.
  items.push(
    ...outline.map((from, index) => lineItem('edge', from, outline[(index + 1) % outline.length]!))
  );
  const over = markupItem(drawn, symbols, context, bounds);
  if (over) items.push(over);
  return { bounds, sheet: sheetPx, items };
}

/**
 * The style the painter draws a step's scene with: the style as the
 * surface's renderers draw it — the policy applied, and every crease in its
 * own pen (`surfacePaperStyle`), as the other surfaces hand theirs. Its aux
 * switch stays on: the scene already holds exactly the aux-pen lines the page
 * carries, and the creases an earlier step made are among them.
 */
export function diagramScenePaintStyle(style: PaperStyle, surface: PaperSurface): PaperStyle {
  const painted = surfacePaperStyle(style, PAPER_STYLE_POLICIES[surface]);
  return { ...painted, auxCreases: { ...painted.auxCreases, visible: true } };
}

/**
 * Where the letters may go on a step's page: no box to hold them in, as on
 * the big view. A card's bounds are its viewBox, and a page has no edge of
 * its own; charging a letter for leaving a box the reader never saw would
 * push it somewhere the view does not, so the page grows to hold them
 * instead.
 */
const LETTER_LAYOUT: LabelLayoutOptions = {};

/** What a step's drawing on its page is made from: its style read through its surface, and its projector. */
type SceneDrawingOptions = Pick<DiagramToPaperSceneOptions, 'style' | 'surface' | 'project' | 'mirrored'>;

/**
 * What a step is drawn through on its page: the style as the surface sees
 * it, the projector with the style's arrow pen and the accent at its weight,
 * the face it shows, and its primitives named from that face.
 */
function sceneDrawing(model: StepDiagramModel, options: SceneDrawingOptions) {
  const seen = applyPaperStylePolicy(options.style, PAPER_STYLE_POLICIES[options.surface]);
  const ink = options.project.ink;
  const markWidth = (seen.arrows.width * PT_TO_CSS_PX) / ink;
  const project = withPens(options.project, {
    ...options.project.pens,
    // The arrow is the style's pen: its width in pt as CSS px, in the
    // drawing's ink, with the pen's own dash and cap — so on a page painted
    // at the screen's ratio, which a step's page is, it is the pen's pt.
    arrow: penInk(seen.arrows, markWidth),
    // The accent over the lines a step lines up is a mark of the step, as the
    // arrow is, and drawn at the arrow's weight, in its own ink.
    highlight: { ...options.project.pens.highlight, width: markWidth },
  });
  const mirrored = options.mirrored ?? project.mirrored;
  const drawn = mirrored ? seenFromTheBack(model.primitives) : model.primitives;
  return { seen, project, mirrored, drawn };
}

/**
 * Where a step's letters go on its page, by each one's index in the model,
 * in scene px, and the projector they were placed through (17d): the one
 * layout {@link diagramToPaperScene} draws them by — every letter against
 * the whole picture, its rings, its loud lines and the letters before it —
 * so a letter lifted from a References card lands where the baked one is
 * drawn, and the two cannot drift apart.
 */
export function diagramLetterPlacements(
  model: StepDiagramModel,
  options: SceneDrawingOptions
): { placements: ReadonlyMap<number, LabelPlacement>; project: DiagramProjector } {
  const { project, drawn } = sceneDrawing(model, options);
  return { placements: placeLabels(drawn, model.sheet, project, LETTER_LAYOUT), project };
}

/**
 * `bounds` grown to the listed primitives as they are drawn: a mark as far as
 * its ink (`markReach`), an accent line or arc its pen's half round it, a
 * round cap's or a butt end's corners reaching no further. A letter is in
 * them already.
 */
function grownToMarks(
  bounds: SceneBounds,
  drawn: readonly StepDiagramPrimitive[],
  indices: readonly number[],
  project: DiagramProjector,
  context: DiagramRenderContext
): void {
  const take = (x: number, y: number, pad: number) => {
    bounds.minX = Math.min(bounds.minX, x - pad);
    bounds.minY = Math.min(bounds.minY, y - pad);
    bounds.maxX = Math.max(bounds.maxX, x + pad);
    bounds.maxY = Math.max(bounds.maxY, y + pad);
  };
  for (const index of indices) {
    const primitive = drawn[index]!;
    if (isDiagramMark(primitive)) {
      markReach(primitive, project, context.marks, take);
      continue;
    }
    if (primitive.kind !== 'line' && primitive.kind !== 'arc') continue;
    const half = ((project.pens[primitive.style]?.width ?? 0) * project.ink) / 2;
    if (primitive.kind === 'line') {
      for (const end of [primitive.from, primitive.to]) {
        const { x, y } = project(end);
        take(x, y, half);
      }
    } else {
      for (const { x, y } of arcExtremes(primitive, project)) take(x, y, half);
    }
  }
}

/**
 * The listed primitives drawn by their shapes, as one markup item; null when
 * there are none, or none of them draws anything. The indices are into the
 * drawn list, which is what the context's letters are keyed by. The clip pair
 * the marks among them are drawn through, when any need it, is in the same
 * item: a page is one document, and the item is where the marks are.
 */
function markupItem(
  drawn: readonly StepDiagramPrimitive[],
  indices: readonly number[],
  context: DiagramRenderContext,
  bounds: SceneBounds
): PaperMarkupItem | null {
  if (indices.length === 0) return null;
  const svg = renderToStaticMarkup(diagramShapes(drawn, context, { indices }));
  if (svg === '') return null;
  return { kind: 'markup', svg, bounds, hidden: false };
}

/**
 * The card's box round the sheet: its corners' extent plus the padding band
 * a card keeps (`DIAGRAM_PADDING` of the box on each side, which is that
 * share of the sheet's longer side over what is left), so a letter or an
 * arrow past the paper's edge has the room on the page it has on a card —
 * and then the letters themselves, since nothing held them inside the band
 * and the page is cropped to this.
 */
function paddedBounds(
  corners: readonly ScenePoint[],
  sheetPx: number,
  labels: ReadonlyMap<number, LabelPlacement>
): SceneBounds {
  const pad = (sheetPx * DIAGRAM_PADDING) / (1 - 2 * DIAGRAM_PADDING);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  for (const { box } of labels.values()) {
    bounds.minX = Math.min(bounds.minX, box.x);
    bounds.minY = Math.min(bounds.minY, box.y);
    bounds.maxX = Math.max(bounds.maxX, box.x + box.width);
    bounds.maxY = Math.max(bounds.maxY, box.y + box.height);
  }
  return bounds;
}
