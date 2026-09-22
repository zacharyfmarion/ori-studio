/**
 * A step diagram as a paper scene: what the painter needs to put a precrease
 * step on a page in the paper style, from the same `StepDiagramModel` the
 * card and the big view draw.
 *
 * The paper is one face and the step's lines are lines with roles, so the
 * painter draws them with the style's pens, erodes an existing crease at the
 * sheet's edge and hides them all when the style says so — exactly as it does
 * for a folded figure. Everything the painter has no word for — the fold
 * arrow, the turn-over glyph, a band's wash, the rings and the letters — is
 * drawn by `diagramPrimitiveShape`, the one implementation that draws them on
 * screen, into a markup item with its colours written in (D12, D13: the
 * References inks and paper through the `references` policy). No React state
 * and no store: a test hands it a model and reads the page.
 */
import { createElement, Fragment } from 'react';
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
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { REFERENCE_COLORS } from '../../themes/applyTheme';
import {
  createDiagramRenderContext,
  diagramPrimitiveShape,
  type DiagramRenderContext,
} from './diagram/DiagramPrimitives';
import { diagramInlineInk, type DiagramInlineTokens } from './diagram/diagramColors';
import type { LabelPlacement } from './diagram/labelLayout';
import { penInk } from './diagram/diagramInk';
import { seenFromTheBack } from './diagram/diagramModel';
import type {
  DiagramLineStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from './referenceFinderDiagramToPrimitives';
import {
  DIAGRAM_PADDING,
  arcPolyline,
  onSheetBoundary,
  sheetCorners,
  withPens,
  type DiagramProjector,
  type SheetPoint,
} from './stepDiagramGeometry';
import { referencesPaperTokens } from './usePaperStyleTokens';

export interface DiagramToPaperSceneOptions {
  /** The style the step is painted in; the `references` policy is applied here. */
  style: PaperStyle;
  /**
   * Sheet units to scene px: the fit a card draws through, or the big view's
   * camera. Its `mirrored` says the picture is of the paper's back, and the
   * scene follows it — the sheet's back, every fold named from that side —
   * as the card follows the flag it built its projector from.
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
   * The ground a letter's halo is painted in — the page's background, or
   * white when the page has none, since a letter is pushed off the sheet on
   * purpose and its halo is what it stands on there. On screen it is the
   * workspace's ground.
   */
  ground?: Hex;
}

/** A letter's halo when the page has no background: a printed diagram's paper. */
const DEFAULT_GROUND: Hex = '#ffffff';

/**
 * Which pen a line style draws with on the page. A style not here — the
 * accent's `highlight`, an `arrow` drawn as a plain line, a pinch of no known
 * direction — has no pen of its own in the style and keeps its on-screen
 * look through the markup instead.
 */
const LINE_ROLES: Partial<Record<DiagramLineStyleName, PaperLineRole>> = {
  edge: 'edge',
  mountain: 'mountain',
  'pinch-mountain': 'mountain',
  valley: 'valley',
  'pinch-valley': 'valley',
  crease: 'aux',
  dotted: 'aux',
  unfolded: 'aux',
};

/**
 * The scene for a step. Items in draw order: the sheet and its border, then a
 * band's wash (drawn under the lines on screen, so under them here), then the
 * lines as the model orders them, then the symbols over everything. `bounds`
 * is the card's box round the sheet — the padding band a letter at a corner is
 * pushed into — grown to whatever the letters took, and `sheet` is the paper's
 * longer side in scene px, the unit erode is measured in.
 */
export function diagramToPaperScene(
  model: StepDiagramModel,
  options: DiagramToPaperSceneOptions
): PaperScene {
  const seen = applyPaperStylePolicy(options.style, PAPER_STYLE_POLICIES.references);
  const project = withPens(options.project, {
    ...options.project.pens,
    // The arrow is the style's pen: its width in pt as CSS px, in the
    // drawing's ink, with the pen's own dash and cap.
    arrow: penInk(seen.arrows, (seen.arrows.width * PT_TO_CSS_PX) / options.project.ink),
  });
  const mirrored = options.mirrored ?? project.mirrored;
  const drawn = mirrored ? seenFromTheBack(model.primitives) : model.primitives;
  const sheet = model.sheet;
  const point = (p: SheetPoint): ScenePoint => {
    const { x, y } = project(p);
    return [x, y];
  };

  const outline = sheetCorners(sheet);
  const corners = outline.map(point);
  const sheetPx = Math.max(sheet.width, sheet.height) * project.scale;

  const context = createDiagramRenderContext(
    drawn,
    sheet,
    project,
    // No box to hold the letters in, as on the big view: a card's bounds are
    // its viewBox, and a page has no edge of its own. Charging a letter for
    // leaving a box the reader never saw puts it somewhere the view does not,
    // which is the one thing an as-shown export must not do; the page grows
    // to hold them instead.
    {},
    { visible: seen.auxCreases.visible, erode: seen.erode },
    diagramInlineInk(inlineTokens(seen, options.ground ?? DEFAULT_GROUND), seen.arrows.color)
  );

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
  const items: PaperItem[] = [
    {
      kind: 'face',
      face: 0,
      side: mirrored ? 'back' : 'front',
      rings: [corners],
      shade: 1,
      hidden: false,
    },
    // The paper's border. On screen it is drawn for us — the card strokes the
    // sheet rect, the big view has the document's own border creases under
    // the overlay — but a page carries only what the scene says, and a face
    // is closed with a hairline in its own fill, never the edge pen. Without
    // these four a light paper on a blank page is invisible but for its
    // creases, where every other surface's export draws its outline.
    ...outline.map((from, index) => lineItem('edge', from, outline[(index + 1) % outline.length]!)),
  ];
  const wash = markupItem(drawn, washes, context, bounds);
  if (wash) items.push(wash);
  items.push(...lines);
  const over = markupItem(drawn, symbols, context, bounds);
  if (over) items.push(over);
  return { bounds, sheet: sheetPx, items };
}

/**
 * The tokens the card's classes read, as the style has them: the eight the
 * workspace root carries, the accent the light theme gives a reference
 * (a printed diagram is on light paper), the edge pen for a letter's ink and
 * the page's ground for its halo.
 */
function inlineTokens(seen: PaperStyle, ground: Hex): DiagramInlineTokens {
  return {
    ...referencesPaperTokens(seen),
    '--cp-reference-input': REFERENCE_COLORS.light.input,
    '--text-primary': seen.edges.color,
    '--bg-primary': ground,
  };
}

/**
 * The listed primitives drawn by their shapes, as one markup item; null when
 * there are none, or none of them draws anything. The indices are into the
 * drawn list, which is what the context's letters are keyed by.
 */
function markupItem(
  drawn: readonly StepDiagramPrimitive[],
  indices: readonly number[],
  context: DiagramRenderContext,
  bounds: SceneBounds
): PaperMarkupItem | null {
  if (indices.length === 0) return null;
  const shapes = indices.map((index) => diagramPrimitiveShape(drawn[index]!, index, context));
  const svg = renderToStaticMarkup(createElement(Fragment, null, ...shapes));
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
