/**
 * The painter: a {@link PaperScene} and a {@link PaperStyle} to an SVG page.
 *
 * The one place a scene's CSS px become points. Every producer hands over the
 * picture at the camera its surface showed; this module places it on a page
 * in pt (`width`/`height` with a matching viewBox, so an editor reads a 0.75 pt
 * pen as 0.75 pt), inks each face with the paper colour its side and shade
 * call for, and draws each line with the pen its role names. No React, no
 * store, no CP-workspace imports: the simulator worker can call it, and a test
 * can read the page off a hand-built scene.
 */
import { shadeColor } from '@treemaker/origami-simulator';
import type { PaperPage } from './paperPage';
import type {
  PaperFaceItem,
  PaperLineItem,
  PaperLineRole,
  PaperScene,
  ScenePoint,
} from './paperScene';
import { hexToUnitRgb } from './paperStyleResolve';
import { PT_TO_CSS_PX, type Hex, type PaperStyle, type Pen } from './paperStyle';

/** Points per CSS px: the 'as-shown' page is the screen at 96 px per inch. */
export const PT_PER_CSS_PX = 0.75;

export const PT_PER_MM = 72 / 25.4;

/**
 * Hairline stroke on each face, in its own fill colour.
 *
 * SVG renderers antialias adjacent polygon edges independently, which leaves a
 * visible seam grid across a dense mesh where the two coverages do not sum to
 * one. Stroking each face in its own colour closes the seam without changing
 * the colour. Every face the painter draws is opaque, so every face gets one.
 */
export const SEAM_STROKE_WIDTH_PT = 0.4;

export interface PaperSvgResult {
  svg: string;
  widthPt: number;
  heightPt: number;
}

/**
 * Points per scene px for a page: the screen's own ratio, or whatever makes
 * the unfolded sheet span the sheet size asked for. A scene with no sheet
 * extent (an empty one) has nothing to scale by and takes the screen's ratio.
 */
export function pagePtPerPx(scene: PaperScene, page: PaperPage): number {
  if (page.sheet === 'as-shown' || !(scene.sheet > 0)) return PT_PER_CSS_PX;
  return (page.sheet.mm * PT_PER_MM) / scene.sheet;
}

/**
 * The widest pen the style draws a line with, in pt: the edge and fold pens,
 * and the aux pen when aux creases show.
 */
export function widestPenPt(style: PaperStyle): number {
  let widest = 0;
  for (const role of ['edge', 'mountain', 'valley', 'aux'] as const) {
    const pen = penForRole(style, role);
    if (pen) widest = Math.max(widest, pen.width);
  }
  return widest;
}

/**
 * The widest pen the painter will draw, in CSS px: a scene producer's ink
 * allowance for the tree and the stroke its hidden test measures a line by.
 */
export function widestPenCssPx(style: PaperStyle): number {
  return widestPenPt(style) * PT_TO_CSS_PX;
}

/**
 * The margin around the artwork, in pt: the page's `paddingMm`, or, when that
 * is smaller, room for the stroke that straddles the artwork's edge — half the
 * widest pen, or half the seam hairline. The crop is the geometry's extent,
 * and a pen is centred on it, so a zero margin would clip the outer half of
 * every outline; the default 5 mm is well clear of any pen.
 */
export function pageMarginPt(style: PaperStyle, page: PaperPage): number {
  const strokeRoomPt = Math.max(widestPenPt(style), SEAM_STROKE_WIDTH_PT) / 2;
  return Math.max(page.paddingMm * PT_PER_MM, strokeRoomPt);
}

/**
 * Paint a scene onto a page. The artwork is cropped to the scene's bounds —
 * hidden pieces included, so the page does not move when they are dropped —
 * with the margin ({@link pageMarginPt}) around it, at `sheet`'s scale. The
 * pens keep their pt widths whatever the scale, as a drawing editor's do.
 */
export function paperSceneToSvg(
  scene: PaperScene,
  style: PaperStyle,
  page: PaperPage
): PaperSvgResult {
  const ptPerPx = pagePtPerPx(scene, page);
  const marginPt = pageMarginPt(style, page);
  const { bounds } = scene;
  const widthPt = (bounds.maxX - bounds.minX) * ptPerPx + marginPt * 2;
  const heightPt = (bounds.maxY - bounds.minY) * ptPerPx + marginPt * 2;
  const place = ([x, y]: ScenePoint): ScenePoint => [
    (x - bounds.minX) * ptPerPx + marginPt,
    (y - bounds.minY) * ptPerPx + marginPt,
  ];

  const elements: string[] = [];
  if (page.background !== null) {
    elements.push(
      `  <rect x="0" y="0" width="${num(widthPt)}" height="${num(heightPt)}" ` +
        `fill="${page.background}"/>`
    );
  }
  elements.push(
    ...sceneElements(scene, style, {
      project: place,
      unitsPerPt: 1,
      keepHiddenFaces: page.keepHiddenFaces,
    })
  );

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${num(widthPt)}pt" height="${num(heightPt)}pt" ` +
      `viewBox="0 0 ${num(widthPt)} ${num(heightPt)}" role="img" aria-label="Folded paper">`,
    // Round joins so the seam hairline cannot spike at a sliver's corner; each
    // line carries its own cap.
    '  <g stroke-linejoin="round">',
    ...elements,
    '  </g>',
    '</svg>',
  ].join('\n');
  return { svg, widthPt, heightPt };
}

export interface PaperSvgBodyOptions {
  /** A scene point to the page's user units. */
  project: (point: ScenePoint) => ScenePoint;
  /**
   * Page user units per pt. A pen is stated in pt, and a page whose unit is not
   * the pt — the crease-pattern export's px box — draws it at that many units,
   * dashes with it. `1` is a page in pt, which is the painter's own.
   */
  unitsPerPt: number;
  keepHiddenFaces: boolean;
}

/**
 * The elements of a scene alone, with no `<svg>` wrapper, for a page another
 * writer owns: the crease-pattern export composes its folded figure beside the
 * sheet and places it by its own layout. The same pens, seam and erode rules
 * as {@link paperSceneToSvg}, at the caller's projection; the caller wraps the
 * result in whatever group it places the picture with, and gives that group
 * round joins as the page does, or the seam hairline can spike at a corner.
 */
export function paperSceneSvgBody(
  scene: PaperScene,
  style: PaperStyle,
  options: PaperSvgBodyOptions
): string {
  return sceneElements(scene, style, options).join('\n');
}

function sceneElements(
  scene: PaperScene,
  style: PaperStyle,
  { project, unitsPerPt, keepHiddenFaces }: PaperSvgBodyOptions
): string[] {
  // Erode is a fraction of the sheet in the scene's own px, before any
  // projection, so a page scale does not change it.
  const erodePx = style.erode * scene.sheet;
  const elements: string[] = [];
  for (const item of scene.items) {
    if (item.hidden && !keepHiddenFaces) continue;
    const element =
      item.kind === 'face'
        ? faceElement(item, style, project, unitsPerPt)
        : lineElement(item, style, erodePx, project, unitsPerPt);
    if (element) elements.push(element);
  }
  return elements;
}

/** The colour a face is filled with: its side's paper, under its shade. */
export function paperFaceFill(style: PaperStyle, side: PaperFaceItem['side'], shade: number): Hex {
  const paper = side === 'front' ? style.paper.front : style.paper.back;
  return unitRgbToHex(shadeColor(hexToUnitRgb(paper), shade));
}

/**
 * The pen a line's role draws with, or null when the style leaves that role
 * out: aux creases are in the scene whenever the mesh carries them, and it is
 * the style that says whether they show.
 */
export function penForRole(style: PaperStyle, role: PaperLineRole): Pen | null {
  switch (role) {
    case 'edge':
      return style.edges;
    case 'mountain':
      return style.mountainFolds;
    case 'valley':
      return style.valleyFolds;
    case 'aux':
      return style.auxCreases.visible ? style.auxCreases.pen : null;
  }
}

function faceElement(
  face: PaperFaceItem,
  style: PaperStyle,
  place: (point: ScenePoint) => ScenePoint,
  unitsPerPt: number
): string | null {
  const rings = face.rings.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return null;
  const fill = paperFaceFill(style, face.side, face.shade);
  const seam = num(SEAM_STROKE_WIDTH_PT * unitsPerPt);
  const ink = `fill="${fill}" stroke="${fill}" stroke-width="${seam}"`;
  if (rings.length === 1) {
    const points = rings[0]!.map((point) => pointText(place(point))).join(' ');
    return `  <polygon points="${points}" ${ink}/>`;
  }
  // A region with holes is one path: the rings are wound against each other,
  // and even-odd makes the inner ones holes whichever way they turn.
  const d = rings
    .map((ring) => `M${ring.map((point) => pointText(place(point))).join('L')}Z`)
    .join('');
  return `  <path d="${d}" fill-rule="evenodd" ${ink}/>`;
}

function lineElement(
  line: PaperLineItem,
  style: PaperStyle,
  erodePx: number,
  place: (point: ScenePoint) => ScenePoint,
  unitsPerPt: number
): string | null {
  const pen = penForRole(style, line.role);
  if (!pen) return null;
  const eroded = erodeSegment(line.a, line.b, line.onBoundary, erodePx);
  if (!eroded) return null;
  const from = place(eroded[0]);
  const to = place(eroded[1]);
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(length > 0)) return null;
  const dash = penDashPt(pen)?.map((run) => run * unitsPerPt) ?? null;
  const dashAttr = dash
    ? ` stroke-dasharray="${dash.map(num).join(' ')}" ` +
      `stroke-dashoffset="${num(centredDashOffset(dash, length))}"`
    : '';
  return (
    `  <line x1="${num(from[0])}" y1="${num(from[1])}" ` +
    `x2="${num(to[0])}" y2="${num(to[1])}" ` +
    `stroke="${pen.color}" stroke-width="${num(pen.width * unitsPerPt)}" ` +
    `stroke-linecap="${pen.cap}"${dashAttr}/>`
  );
}

/** A pen's dash as pt runs: its multiples times its pt width. */
export function penDashPt(pen: Pen): number[] | null {
  return pen.dash ? pen.dash.map((run) => run * pen.width) : null;
}

/**
 * The `stroke-dashoffset` that centres a dash pattern on a segment of this
 * length, so both ends of a fold line look the same.
 *
 * A pattern of runs `r₀ r₁ … rₙ` repeats with period `P = Σr` (twice that when
 * the list is odd, since SVG doubles it to keep on and off alternating), and is
 * mirror-symmetric about the middle of its first run — position `r₀/2` — for
 * every pattern this app writes (`8 2 1 2`, `4 2`, `1 2`, Oriedita's). With an
 * offset `d` the pattern position at distance `s` along the segment is
 * `s + d`, so the midpoint `L/2` lands on `r₀/2` when
 *
 *     d ≡ r₀/2 − L/2  (mod P),
 *
 * reduced into `[0, P)` because a negative offset is legal but reads badly.
 */
export function centredDashOffset(runsPt: readonly number[], lengthPt: number): number {
  const sum = runsPt.reduce((total, run) => total + run, 0);
  if (!(sum > 0)) return 0;
  const period = runsPt.length % 2 === 1 ? sum * 2 : sum;
  const first = runsPt[0] ?? 0;
  const offset = (first / 2 - lengthPt / 2) % period;
  return offset < 0 ? offset + period : offset;
}

/**
 * Erode (D8): each endpoint flagged as lying on its face's boundary is pulled
 * toward the segment's midpoint by `distance`; an interior endpoint stays. A
 * pull that reaches the midpoint would invert the segment, so it collapses
 * instead and null says to drop it. Scene px throughout.
 */
export function erodeSegment(
  a: ScenePoint,
  b: ScenePoint,
  onBoundary: readonly [boolean, boolean],
  distance: number
): [ScenePoint, ScenePoint] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  if (!(distance > 0) || (!onBoundary[0] && !onBoundary[1])) return [a, b];
  if (distance >= length / 2) return null;
  const ux = (dx / length) * distance;
  const uy = (dy / length) * distance;
  return [
    onBoundary[0] ? [a[0] + ux, a[1] + uy] : a,
    onBoundary[1] ? [b[0] - ux, b[1] - uy] : b,
  ];
}

function unitRgbToHex(color: readonly [number, number, number]): Hex {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

function pointText([x, y]: ScenePoint): string {
  return `${num(x)},${num(y)}`;
}

/** Two decimals, like every writer in the app: a hundredth of a pt is below any output device. */
function num(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0';
}
