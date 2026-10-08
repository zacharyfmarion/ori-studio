/**
 * An enlarged step painted (Revision 2, "Rendering on every surface"): the
 * window of its own picture its frame takes in, on the close-up's recipe —
 *
 * 1. a clip in the frame's shape, a circle or a rectangle with rounded
 *    corners (0.22 of its shorter side), turned with the frame;
 * 2. under it, the step's own picture painted again larger — at the size that
 *    puts the window where the surface wants it, so its pens keep their print
 *    weight — and only what lies near the window ({@link zoomCull});
 * 3. the boundary over it (`zoomEdge.ts`), in the paper's edges pen;
 * 4. the step's marks, which are in the window's units, drawn by the surface
 *    on the window as on any picture's frame, unclipped.
 *
 * Each surface paints its own picture (step 2), as it does for a close-up's
 * inside: a card and a file the picture as a document of its own
 * ({@link paintZoomedPicture}), a page through its own painter
 * (`pagePictures.ts`), the canvas as an image under its marks
 * (`DiagramZoomView`). What they share — where the picture and the frame
 * land, the clip, the boundary — is here.
 *
 * Pure: no DOM, no store.
 */
import { ANNOTATE_SELECTION_INK, CARD_FRAME_PX } from '../annotate/canvasInk';
import { frameOf, type PictureFrame } from '../annotate/annotationModel';
import { annotatedPicture, hasDrawnAnnotations, paintAnnotations } from '../annotate/paintAnnotations';
import type { AnnotationPaper } from '../annotate/annotationPrimitives';
import type { PictureCover, PictureLayers } from '../annotate/pictureGeometry';
import type {
  DiagramAnnotation,
  DiagramAsset,
  DiagramStep,
  DiagramStyle,
  DiagramZoomOutline,
} from '../document/diagramDocument';
import { DEFAULT_PAPER_SIZE_MM } from '../../lib/paper/paperPage';
import { mmToCssPx, PT_PER_CSS_PX } from '../../lib/paper/paperSvg';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { diagramSurfaceStyle } from '../pictures/diagramPaperStyle';
import {
  paintSource,
  STEP_CARD_PADDING_MM,
  stepPictureSource,
  type PaintedPicture,
  type StepPictureSource,
} from '../pictures/paintDiagramStep';
import { paintedFrameLongerPx, stepPictureFrame } from '../pictures/pictureFrame';
import { prefixIds } from '../pictures/prefixIds';
import { SVG_NS } from '../upload/svgSanitize';
import { marksInWindow, sourcePaper, viewOfStep, type StepZoomView } from './stepView';
import { paperSilhouette, zoomEdgeDrawn, zoomEdgePaths, zoomOvershootMm, type ZoomEdgeDrawn } from './zoomEdge';
import { zoomCornerRadius, zoomEdgeOf, zoomShapeOf, type PictureBox } from './zoomModel';

/** How much of the page's white lies over the picture outside an enlarged step's frame, where it is shown. */
export const ZOOM_SURROUND_DIM = 0.45;

/**
 * The margin round an enlarged step's window as a card paints it, a share of
 * the window's longer side: a card's 1 mm at its 50 mm. The canvas lays the
 * window out with it too, so it fits as any picture with its margin does.
 */
export const ZOOM_CARD_MARGIN = STEP_CARD_PADDING_MM / DEFAULT_PAPER_SIZE_MM;

/** The page every picture prints on: what the picture outside a frame is dimmed toward. */
const PAGE_WHITE = '#ffffff';

/** Where an enlarged step's window, its whole picture and its frame land on a surface, in its units. */
export interface ZoomPlacement {
  /** The surface's units per picture unit. */
  k: number;
  /** The window: the box the step's marks are drawn on. */
  window: PictureBox;
  /** The whole picture's frame: where a surface paints its picture for the window to land on `window`. */
  pictureFrame: PictureBox;
  /** The frame. */
  outline: DiagramZoomOutline;
}

/**
 * An enlarged step's window put on `window`, a box in a surface's units of
 * the window's own shape; its picture's frame, `pictureFrame` in picture
 * units, and its frame placed with it by the same scale and shift.
 */
export function zoomPlacement(view: StepZoomView, pictureFrame: PictureFrame, window: PictureBox): ZoomPlacement {
  const k = Math.max(window.width, window.height) / Math.max(view.window.width, view.window.height);
  const [x, y] = [window.x - view.window.x * k, window.y - view.window.y * k];
  const { centre, radius, size, angle } = view.frame;
  return {
    k,
    window,
    pictureFrame: { x, y, width: pictureFrame.width * k, height: pictureFrame.height * k },
    outline: {
      centre: [x + centre[0] * k, y + centre[1] * k],
      ...(radius !== undefined ? { radius: radius * k } : {}),
      ...(size !== undefined ? { size: [size[0] * k, size[1] * k] as [number, number] } : {}),
      ...(angle ? { angle } : {}),
    },
  };
}

/** A box `width` × `height` of `frame`'s shape, its longer side `longer`, at `x`, `y`. */
export function windowBox(frame: PictureFrame, longer: number, x = 0, y = 0): PictureBox {
  return { x, y, width: frame.width * longer, height: frame.height * longer };
}

/**
 * What a surface paints of an enlarged step's picture, in picture units: its
 * window, grown by the overshoot its boundary runs on by as it prints at
 * `printedMm` across — an item farther off cannot show through the frame.
 */
export function zoomCull(view: StepZoomView, printedMm: number): PictureBox {
  const longer = Math.max(view.window.width, view.window.height);
  const grow = printedMm > 0 ? (zoomOvershootMm(view.frame, printedMm / longer) / printedMm) * longer : 0;
  const { x, y, width, height } = view.window;
  return { x: x - grow, y: y - grow, width: width + 2 * grow, height: height + 2 * grow };
}

/** The frame's outline as one SVG shape, in a surface's units: what the picture is clipped to. */
export function zoomClipShape(outline: DiagramZoomOutline): string {
  const [cx, cy] = outline.centre;
  if (zoomShapeOf(outline) === 'circle') return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(outline.radius!)}"/>`;
  const [width, height] = outline.size!;
  const r = zoomCornerRadius(outline);
  const turn = outline.angle ? ` transform="rotate(${num(outline.angle)} ${num(cx)} ${num(cy)})"` : '';
  return (
    `<rect x="${num(cx - width / 2)}" y="${num(cy - height / 2)}" width="${num(width)}" height="${num(height)}" ` +
    `rx="${num(r)}" ry="${num(r)}"${turn}/>`
  );
}

/** The paper's edges pen, its width in a surface's units at `unitsPerPx` of them to a CSS px: the boundary's. */
export function zoomEdgePen(style: DiagramStyle, unitsPerPx: number): { width: number; color: string } {
  const { edges } = diagramSurfaceStyle(style);
  return { width: edges.width * PT_TO_CSS_PX * unitsPerPx, color: edges.color };
}

/** What a surface needs, beside the picture it paints, to paint an enlarged step's window. */
export interface ZoomPaint {
  style: DiagramStyle;
  /** The step's paper (`paperSilhouette`): what a Cut frame is drawn over; null for none. */
  silhouette: readonly PictureCover[] | null;
  /** The surface's units per CSS px: what its pens are sized by. */
  unitsPerPx: number;
  /** The window's longer side as it prints, in mm: what the overshoot and the gaps drawn through are measured at. */
  printedMm: number;
  /** Put before every id the window declares, so two on one page never share one. */
  idPrefix: string;
}

/** What an enlarged step's boundary draws on a surface that prints its window `printedMm` across. */
export function zoomBoundary(view: StepZoomView, silhouette: readonly PictureCover[] | null, printedMm: number): ZoomEdgeDrawn {
  const longer = Math.max(view.window.width, view.window.height);
  const edge = zoomEdgeOf(view.zoom.shape, view.zoom.edge);
  return zoomEdgeDrawn(view.frame, edge, silhouette, printedMm / longer);
}

/**
 * An enlarged step's window on a surface: `picture` — the step's picture,
 * which the surface painted onto `placement.pictureFrame` — clipped to the
 * frame, and the boundary over it. What it draws reaches the window and half
 * the boundary's pen past it.
 */
export function paintZoomed(
  view: StepZoomView,
  placement: ZoomPlacement,
  picture: string | null,
  paint: ZoomPaint
): { markup: string; bounds: PictureBox } {
  const pen = zoomEdgePen(paint.style, paint.unitsPerPx);
  const paths = zoomEdgePaths(placement.outline, zoomBoundary(view, paint.silhouette, paint.printedMm));
  const id = `${paint.idPrefix}zoom-clip`;
  const boundary = paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="${pen.color}" stroke-width="${num(pen.width)}" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join('');
  const clipped = picture
    ? `<defs><clipPath id="${id}">${zoomClipShape(placement.outline)}</clipPath></defs><g clip-path="url(#${id})">${picture}</g>`
    : '';
  const half = pen.width / 2;
  const { window } = placement;
  return {
    markup: `<g data-zoom-window="">${clipped}${boundary}</g>`,
    bounds: { x: window.x - half, y: window.y - half, width: window.width + 2 * half, height: window.height + 2 * half },
  };
}

/** An enlarged step's window as a card and a file draw it: what {@link paintZoomedPicture} is painted from. */
export interface ZoomedSource {
  view: StepZoomView;
  source: StepPictureSource;
  /** The step's picture's frame, in picture units. */
  pictureFrame: PictureFrame;
  silhouette: readonly PictureCover[] | null;
}

/**
 * What a step's window is painted from, when it is enlarged and shows one
 * (`stepView`); null for a step that shows its whole picture, or none.
 */
export function zoomedSource(step: DiagramStep, assets: Readonly<Record<string, DiagramAsset>>): ZoomedSource | null {
  const view = viewOfStep(step).zoom;
  if (!view) return null;
  const source = stepPictureSource(step, assets);
  const pictureFrame = stepPictureFrame(step, assets);
  return source && pictureFrame ? { view, source, pictureFrame, silhouette: paperSilhouette(step, assets) } : null;
}

/** What a window is painted from, for a cache's key: the frame, its shape and how its edge draws. */
export function zoomedKey({ view }: ZoomedSource): string {
  return JSON.stringify([view.frame, view.zoom.shape, view.zoom.edge ?? null]);
}

/**
 * An enlarged step's window as a picture of its own, as a card shows it: the
 * window `scale` times the size every picture opens at (50 mm) across its
 * longer side, with `paddingMm` round it; the picture's frame is the window.
 * Painted afresh at that size, as a close-up's inside is: a scene and a
 * References card at their print weight, an upload or a fixed picture larger
 * whole. Null when the picture does not paint.
 */
export function paintZoomedPicture(
  zoomed: ZoomedSource,
  style: DiagramStyle,
  { scale = 1, paddingMm = STEP_CARD_PADDING_MM }: { scale?: number; paddingMm?: number } = {}
): PaintedPicture | null {
  const drawn = windowDocument(zoomed, style, scale, paddingMm, 1);
  if (!drawn) return null;
  const { markup, width, height, window } = drawn;
  return {
    svg: `<svg xmlns="${SVG_NS}" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">${markup}</svg>`,
    widthPx: width,
    heightPx: height,
    frame: window,
  };
}

/**
 * An enlarged step's window as Export Picture writes it: the card's picture
 * ({@link paintZoomedPicture}) with `paddingMm` round it, as a file sized and
 * drawn in pt, as every captured picture and step file is — so a drawing
 * editor opens it at the size it prints, its pens at their pt widths.
 */
export function zoomedPictureFile(zoomed: ZoomedSource, style: DiagramStyle, paddingMm: number): string | null {
  const drawn = windowDocument(zoomed, style, 1, paddingMm, PT_PER_CSS_PX);
  if (!drawn) return null;
  const [width, height] = [num(drawn.width), num(drawn.height)];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="${SVG_NS}" width="${width}pt" height="${height}pt" viewBox="0 0 ${width} ${height}">${drawn.markup}</svg>`
  );
}

/**
 * An enlarged step's window, `scale` times a card's, with `paddingMm` round
 * it, in a document's units, `u` of them to a CSS px: its markup, its size
 * and where the window is.
 */
function windowDocument(
  { view, source, pictureFrame, silhouette }: ZoomedSource,
  style: DiagramStyle,
  scale: number,
  paddingMm: number,
  u: number
): { markup: string; width: number; height: number; window: PictureBox } | null {
  const window = frameOf(view.window.width, view.window.height);
  const atOne = paintedFrameLongerPx(source);
  if (!window || !atOne || !(scale > 0)) return null;
  const pad = mmToCssPx(paddingMm) * u;
  const placement = zoomPlacement(view, pictureFrame, windowBox(window, CARD_FRAME_PX * scale * u, pad, pad));
  const printedMm = DEFAULT_PAPER_SIZE_MM * scale;
  // Painted at the size in CSS px the picture's frame takes, and nested there.
  const painted = paintSource(
    source,
    style,
    undefined,
    Math.max(placement.pictureFrame.width, placement.pictureFrame.height) / u / atOne,
    zoomCull(view, printedMm)
  );
  const nested = painted && nestedOn(painted, placement.pictureFrame, 'zoom-picture-');
  const { markup } = paintZoomed(view, placement, nested, { style, silhouette, unitsPerPx: u, printedMm, idPrefix: '' });
  return {
    markup,
    width: placement.window.width + 2 * pad,
    height: placement.window.height + 2 * pad,
    window: placement.window,
  };
}

/**
 * An enlarged step as its card shows it: its window ({@link paintZoomedPicture})
 * with its marks drawn on it at a card's size — those near it (`marksInWindow`) — a mark behind a flap dotted
 * where the window's `layers` say, a close-up's inside the window painted
 * larger. One SVG document; null when the picture does not paint.
 */
export function zoomedCardPicture(
  zoomed: ZoomedSource,
  annotations: readonly DiagramAnnotation[],
  style: DiagramStyle,
  layers: PictureLayers | null = null
): string | null {
  const painted = paintZoomedPicture(zoomed, style);
  if (!painted) return null;
  const marks = marksInWindow(zoomed.view.window, annotations);
  if (!hasDrawnAnnotations(marks)) return painted.svg;
  return annotatedPicture(
    painted,
    marks,
    style,
    1,
    layers,
    (scale) => paintZoomedPicture(zoomed, style, { scale }),
    sourcePaper(zoomed.source, zoomed.view.window)
  );
}

/**
 * How far round an enlarged step's window its canvas paints the picture
 * when the frame is selected (Revision 2, Controls), in surround cells — a
 * cell the window's longer side at the scale painted — each way: as far as
 * the canvas steps back to reach the frame's grips, and some, never the
 * whole model at the window's scale, which for a small window is many
 * frames across.
 */
export const ZOOM_SURROUND_REACH = 2;

/** Steps per doubling the surround's scale is held to: within 19% of the window's, so a resize repaints rarely. */
const SURROUND_SCALE_STEPS = 4;

/**
 * The most cells a surround reaches across that takes in more than the
 * window (`alsoShow`): past it, what it takes in is cut off at this many
 * rather than painted larger than a few cards.
 */
export const ZOOM_SURROUND_MOST_CELLS = 24;

/**
 * What the canvas paints round a selected frame (Revision 2): the step's
 * picture at a scale held to quarter octaves of the one that puts its window
 * at a card's 50 mm, and the box in picture units it is cut to — the window
 * grown by {@link ZOOM_SURROUND_REACH} cells each way, and `alsoShow` (the
 * frame's anchor face, which its selection outlines) as far as
 * {@link ZOOM_SURROUND_MOST_CELLS} allow, snapped out to a grid of cells — so
 * a frame moved or resized a little paints nothing new. Null for a picture
 * that does not paint.
 */
export function zoomSurroundRegion(
  zoomed: ZoomedSource,
  alsoShow: PictureBox | null = null
): { scale: number; region: PictureBox } | null {
  const atOne = paintedFrameLongerPx(zoomed.source);
  const { window } = zoomed.view;
  const longer = Math.max(window.width, window.height);
  if (!atOne || !(longer > 0)) return null;
  const exact = CARD_FRAME_PX / longer / atOne;
  const scale = 2 ** (Math.round(Math.log2(exact) * SURROUND_SCALE_STEPS) / SURROUND_SCALE_STEPS);
  // A cell: the window's longer side at the scale held to, in picture units.
  const cell = CARD_FRAME_PX / scale / atOne;
  const reach = ZOOM_SURROUND_REACH * cell;
  let [x, y] = [window.x - reach, window.y - reach];
  let [right, bottom] = [window.x + window.width + reach, window.y + window.height + reach];
  if (alsoShow) {
    // As far as the most cells allow from the window's middle, each way.
    const most = (ZOOM_SURROUND_MOST_CELLS / 2) * cell;
    const [mx, my] = [window.x + window.width / 2, window.y + window.height / 2];
    x = Math.min(x, Math.max(mx - most, alsoShow.x));
    y = Math.min(y, Math.max(my - most, alsoShow.y));
    right = Math.max(right, Math.min(mx + most, alsoShow.x + alsoShow.width));
    bottom = Math.max(bottom, Math.min(my + most, alsoShow.y + alsoShow.height));
  }
  [x, y] = [Math.floor(x / cell) * cell, Math.floor(y / cell) * cell];
  [right, bottom] = [Math.ceil(right / cell) * cell, Math.ceil(bottom / cell) * cell];
  return { scale, region: { x, y, width: right - x, height: bottom - y } };
}

/**
 * The step's picture painted at `scale`, only what lies over `region`
 * (picture units), and cut to it: a document no larger than the region at
 * that scale, its frame — the whole picture's, where it would lie — placed
 * as a painted picture's is, so a surface lays it as it lays the whole.
 */
export function paintZoomSurround(
  source: StepPictureSource,
  style: DiagramStyle,
  scale: number,
  region: PictureBox
): PaintedPicture | null {
  const painted = paintSource(source, style, undefined, scale, region);
  if (!painted) return null;
  const unit = Math.max(painted.frame.width, painted.frame.height);
  const box = {
    x: painted.frame.x + region.x * unit,
    y: painted.frame.y + region.y * unit,
    width: region.width * unit,
    height: region.height * unit,
  };
  const body = painted.svg.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  return {
    svg:
      `<svg xmlns="${SVG_NS}" width="${num(box.width)}" height="${num(box.height)}" ` +
      `viewBox="${num(box.x)} ${num(box.y)} ${num(box.width)} ${num(box.height)}">${body}</svg>`,
    widthPx: box.width,
    heightPx: box.height,
    frame: { ...painted.frame, x: painted.frame.x - box.x, y: painted.frame.y - box.y },
  };
}

/** A painted picture nested whole, its frame on `frame`, every id it declares under `idPrefix`. */
export function nestedOn(painted: PaintedPicture, frame: PictureBox, idPrefix: string): string | null {
  const longer = Math.max(painted.frame.width, painted.frame.height);
  if (!(longer > 0)) return null;
  const m = Math.max(frame.width, frame.height) / longer;
  const at = { x: frame.x - painted.frame.x * m, y: frame.y - painted.frame.y * m };
  const body = prefixIds(painted.svg.replace(/^\s*<\?xml[^>]*\?>\s*/, ''), idPrefix);
  return (
    `<svg x="${num(at.x)}" y="${num(at.y)}" width="${num(painted.widthPx * m)}" height="${num(painted.heightPx * m)}" ` +
    `viewBox="0 0 ${num(painted.widthPx)} ${num(painted.heightPx)}" overflow="visible">${body}</svg>`
  );
}

/**
 * The frame's dashed pen in Pose, in CSS px: on a live view, drawn at the
 * screen's own size; on a posed picture, which the stage shows some four
 * times the size it is painted at, a quarter of that.
 */
export const ZOOM_GHOST_PEN = { live: 1.5, picture: 0.5 } as const;

/**
 * The frame as Pose shows it over the whole picture — outlined dashed in the
 * selection's ink, `pen` wide in a surface's units, everything outside it
 * dimmed by {@link ZOOM_SURROUND_DIM} of the page's white when `dim` (a live
 * view's camera is not dimmed) — `outline` placed there. Screen only: no
 * page prints it.
 */
export function zoomFrameGhost(outline: DiagramZoomOutline, box: PictureBox, pen: number, dim: boolean): string {
  const [d] = zoomEdgePaths(outline, { kind: 'whole' });
  if (!d) return '';
  const shade = dim
    ? `<path d="M ${num(box.x)} ${num(box.y)} h ${num(box.width)} v ${num(box.height)} h ${num(-box.width)} Z ${d}" ` +
      `fill="${PAGE_WHITE}" fill-opacity="${ZOOM_SURROUND_DIM}" fill-rule="evenodd"/>`
    : '';
  return (
    `${shade}<path d="${d}" fill="none" stroke="${ANNOTATE_SELECTION_INK}" stroke-width="${num(pen)}" ` +
    `stroke-dasharray="${num(4 * pen)} ${num(3 * pen)}" data-zoom-frame-ghost=""/>`
  );
}

/**
 * An enlarged step in Pose (Revision 2, Controls): its whole picture, the
 * frame outlined dashed in the selection's ink and everything outside it
 * dimmed, and its marks — in the window's units — ghosted where they lie,
 * at `opacity`. The picture with its marks, as one SVG document, the box
 * grown to whatever they and the frame's outline reach past it — all of the
 * outline, marks or none, as an area round the model's edge reaches.
 */
export function posedZoomPicture(
  painted: PaintedPicture,
  view: StepZoomView,
  pictureFrame: PictureFrame,
  annotations: readonly DiagramAnnotation[],
  style: DiagramStyle,
  opacity: number,
  layers: PictureLayers | null = null,
  paper: AnnotationPaper | null = null
): string {
  const longer = Math.max(painted.frame.width, painted.frame.height);
  const k = longer / Math.max(pictureFrame.width, pictureFrame.height);
  const window = {
    x: painted.frame.x + view.window.x * k,
    y: painted.frame.y + view.window.y * k,
    width: view.window.width * k,
    height: view.window.height * k,
  };
  const placement = zoomPlacement(view, pictureFrame, window);
  const marks = paintAnnotations(annotations, window, CARD_FRAME_PX, style, layers, { paper });
  // The picture, its marks, and its frame's outline, which may reach past the picture: an area round the model's edge.
  const reach = ZOOM_GHOST_PEN.picture / 2;
  const boxes = [
    { x: 0, y: 0, width: painted.widthPx, height: painted.heightPx },
    { x: window.x - reach, y: window.y - reach, width: window.width + 2 * reach, height: window.height + 2 * reach },
    ...(marks ? [marks.bounds] : []),
  ];
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const width = Math.max(...boxes.map((box) => box.x + box.width)) - x;
  const height = Math.max(...boxes.map((box) => box.y + box.height)) - y;
  const picture = painted.svg.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  const ghost = zoomFrameGhost(placement.outline, { x, y, width, height }, ZOOM_GHOST_PEN.picture, true);
  const drawn = marks ? (opacity < 1 ? `<g opacity="${opacity}">${marks.markup}</g>` : marks.markup) : '';
  return (
    `<svg xmlns="${SVG_NS}" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="${num(x)} ${num(y)} ${num(width)} ${num(height)}">${picture}${ghost}${drawn}</svg>`
  );
}

/**
 * A step's marks as a live view in Pose ghosts them (D8), over the picture's
 * frame `frame` in the view's px: on the frame, or — an enlarged step's
 * marks being in its window's units — on its window, with its frame
 * outlined over the camera, undimmed. Null when nothing draws.
 */
export function poseGhostMarkup(
  annotations: readonly DiagramAnnotation[],
  frame: PictureBox,
  style: DiagramStyle,
  zoom: StepZoomView | null = null
): string | null {
  const pictureFrame = frameOf(frame.width, frame.height);
  if (!zoom || !pictureFrame) return paintAnnotations(annotations, frame, CARD_FRAME_PX, style)?.markup ?? null;
  const k = Math.max(frame.width, frame.height);
  const window = {
    x: frame.x + zoom.window.x * k,
    y: frame.y + zoom.window.y * k,
    width: zoom.window.width * k,
    height: zoom.window.height * k,
  };
  const placement = zoomPlacement(zoom, pictureFrame, window);
  const marks = paintAnnotations(annotations, window, CARD_FRAME_PX, style)?.markup ?? '';
  return `${zoomFrameGhost(placement.outline, frame, ZOOM_GHOST_PEN.live, false)}${marks}`;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
