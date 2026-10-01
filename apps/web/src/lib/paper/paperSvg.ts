/**
 * The painter: a {@link PaperScene} and a {@link PaperStyle} to an SVG page.
 *
 * The one place a scene's CSS px become points. A producer hands over the
 * picture at the camera its surface showed — or, for a References step, at the
 * page's own scale ({@link mmToCssPx}), so that its marks keep their on-screen
 * size on a sheet of any size; this module places it on a page
 * in pt (`width`/`height` with a matching viewBox, so an editor reads a 0.75 pt
 * pen as 0.75 pt), inks each face with the paper colour its side and shade
 * call for, and draws each line with the pen its role names. No React, no
 * store, no CP-workspace imports: the simulator worker can call it, and a test
 * can read the page off a hand-built scene.
 */
import { shadeColor } from '@treemaker/origami-simulator';
import type { PaperPage, PaperSizeMeasure } from './paperPage';
import type {
  PaperFaceItem,
  PaperLineItem,
  PaperLineRole,
  PaperMarkupItem,
  PaperScene,
  ScenePoint,
} from './paperScene';
import { hexToUnitRgb, unitRgbToHex } from './paperStyleResolve';
import { PT_TO_CSS_PX, type Hex, type PaperStyle, type Pen } from './paperStyle';
import { escapeXml } from '../xmlEscape';

/** Points per CSS px: the screen, at 96 px per inch. */
export const PT_PER_CSS_PX = 0.75;

export const PT_PER_MM = 72 / 25.4;

/**
 * A length on the page in the scene px that measure it at the screen's own
 * ratio ({@link PT_PER_CSS_PX}): how long a scene must draw something for it
 * to span `mm` on the page. A scene built at this size for its sheet is
 * painted at the screen's ratio whatever sheet size the page asks for, so
 * whatever it sizes in CSS px — a References step's marks — keeps that size.
 */
export function mmToCssPx(mm: number): number {
  return (mm * PT_PER_MM) / PT_PER_CSS_PX;
}

/**
 * Hairline stroke on each face, in its own fill colour.
 *
 * SVG renderers antialias adjacent polygon edges independently, which leaves a
 * visible seam grid across a dense mesh where the two coverages do not sum to
 * one. Stroking each face in its own colour closes the seam without changing
 * the colour. Every face the painter draws is opaque, so every face gets one,
 * unless it strokes its own outline: that pen lies where the seam would.
 */
export const SEAM_STROKE_WIDTH_PT = 0.4;

export interface PaperSvgResult {
  svg: string;
  widthPt: number;
  heightPt: number;
}

/**
 * Points per scene px for a page: whatever makes what the size measures span
 * the size asked for — the unfolded sheet, or the figure's longer side (its
 * bounds). A scene with nothing to measure (an empty one) has nothing to scale
 * by and takes the screen's ratio.
 */
export function pagePtPerPx(
  scene: PaperScene,
  page: PaperPage,
  measure: PaperSizeMeasure = 'sheet'
): number {
  const span = measure === 'figure' ? sceneFigureSpan(scene) : scene.sheet;
  if (!(span > 0)) return PT_PER_CSS_PX;
  return (page.sheet.mm * PT_PER_MM) / span;
}

/** A scene's drawing across its longer side, in scene px. */
function sceneFigureSpan({ bounds }: PaperScene): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

/** Every role a line can have, so a question over all of them misses none. */
const LINE_ROLES = [
  'edge',
  'mountain',
  'valley',
  'diagram-mountain',
  'diagram-valley',
  'aux',
] as const satisfies readonly PaperLineRole[];

/**
 * The widest pen the style draws a line with, in pt: the edge, fold and
 * diagram-crease pens, and the aux pen when aux creases show.
 */
export function widestPenPt(style: PaperStyle): number {
  let widest = 0;
  for (const role of LINE_ROLES) {
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
 * with the margin ({@link pageMarginPt}) around it, at the scale that gives
 * what `measure` names the page's size. The pens keep their pt widths
 * whatever the scale, as a drawing editor's do.
 */
export function paperSceneToSvg(
  scene: PaperScene,
  style: PaperStyle,
  page: PaperPage,
  measure: PaperSizeMeasure = 'sheet'
): PaperSvgResult {
  const ptPerPx = pagePtPerPx(scene, page, measure);
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
    // Round joins so neither the seam hairline nor a face's outline can spike
    // at a sliver's corner; each line carries its own cap.
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
 * round joins as the page does, or the seam hairline and a face's outline can
 * spike at a corner.
 *
 * A markup item's coordinates are scene px, and the painter carries it onto
 * the page by a transform rather than by projecting its points, so a body
 * caller whose projection is not a uniform scale and a shift cannot carry one:
 * that throws ({@link markupTransform}) rather than placing the symbols
 * somewhere the lines are not.
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
  let group: string | undefined;
  for (const item of scene.items) {
    if (item.hidden && !keepHiddenFaces) continue;
    const element =
      item.kind === 'face'
        ? faceElement(item, style, erodePx, project, unitsPerPt)
        : item.kind === 'line'
          ? lineElement(item, style, erodePx, project, unitsPerPt)
          : markupElement(item, project);
    if (!element) continue;
    const next = item.kind === 'markup' ? undefined : item.group;
    if (next !== group) {
      if (group !== undefined) elements.push('  </g>');
      if (next !== undefined) elements.push(`  <g id="${escapeXml(next)}">`);
      group = next;
    }
    elements.push(element);
  }
  if (group !== undefined) elements.push('  </g>');
  return elements;
}

/**
 * A markup item placed on the page: its scene-px markup in a group whose
 * transform is the projection — the scale every line's coordinates took, and
 * the shift. Its pens are in scene px too, so a stroke drawn at the arrow
 * pen's CSS px comes out at the pen's pt when a scene px is a CSS px on the
 * page. Markup is placed, not repainted: a size scales it whole, strokes
 * included, where a line keeps its pen's pt. A producer whose marks should
 * keep their size as the lines keep their widths builds its scene at the
 * page's own scale ({@link mmToCssPx}), so the scale here is the screen's at
 * any size. A References step is built so, and its arrows, rings and letters
 * are the size they are on screen on every page.
 */
function markupElement(
  markup: PaperMarkupItem,
  project: (point: ScenePoint) => ScenePoint
): string | null {
  if (markup.svg.trim() === '') return null;
  return `  <g transform="${markupTransform(project)}">${markup.svg}</g>`;
}

/**
 * The `transform` that carries scene px onto the page under `project`, read
 * off three probes of it. Throws when the projection is not a uniform scale
 * and a shift — a rotation, a mirror, an anisotropic scale — since markup is
 * placed by this transform and could not follow the lines through one.
 */
export function markupTransform(project: (point: ScenePoint) => ScenePoint): string {
  const origin = project([0, 0]);
  const ex = project([1, 0]);
  const ey = project([0, 1]);
  const scaleX = ex[0] - origin[0];
  const scaleY = ey[1] - origin[1];
  const skew = Math.abs(ex[1] - origin[1]) + Math.abs(ey[0] - origin[0]);
  const tolerance = 1e-9 * Math.max(1, Math.abs(scaleX));
  if (!(scaleX > 0) || Math.abs(scaleX - scaleY) > tolerance || skew > tolerance) {
    throw new Error(
      'paper markup can only be placed by a uniform scale and a shift; ' +
        `the projection maps (1,0) to (${scaleX}, ${ex[1] - origin[1]}) ` +
        `and (0,1) to (${ey[0] - origin[0]}, ${scaleY})`
    );
  }
  // The shift is a place on the page, so two decimals; the scale is a
  // multiplier, and its rounding grows with the distance from the scene's
  // origin — at two decimals a symbol at the far side of a sheet-size page
  // lands a couple of points off the crease it points at, which is the one
  // thing this transform exists to prevent.
  return `translate(${num(origin[0])} ${num(origin[1])}) scale(${multiplier(scaleX)})`;
}

/** The colour a face is filled with: its side's paper, under its shade. */
export function paperFaceFill(style: PaperStyle, side: PaperFaceItem['side'], shade: number): Hex {
  const paper = side === 'front' ? style.paper.front : style.paper.back;
  return unitRgbToHex(shadeColor(hexToUnitRgb(paper), shade));
}

/**
 * The pen a line's role draws with, or null when the style leaves that role
 * out: aux creases are in the scene whenever the mesh carries them, and it is
 * the style that says whether they show. A pattern's mountain and valley take
 * the fold pens and a step's instruction the diagram-crease pens; which one a
 * line is, the scene's producer says.
 */
export function penForRole(style: PaperStyle, role: PaperLineRole): Pen | null {
  switch (role) {
    case 'edge':
      return style.edges;
    case 'mountain':
      return style.mountainFolds;
    case 'valley':
      return style.valleyFolds;
    case 'diagram-mountain':
      return style.mountainDiagramCreases;
    case 'diagram-valley':
      return style.valleyDiagramCreases;
    case 'aux':
      return style.auxCreases.visible ? style.auxCreases.pen : null;
  }
}

/**
 * A face as one `<path>` — never a polygon, since a drawing editor's node tool
 * reshapes only paths — stroked with its outline's pen when it draws one, so
 * the fill and the outline move together. A dashed pen draws a line per edge
 * after the fill instead, each dash centred on its edge as an outline drawn in
 * lines is.
 */
function faceElement(
  face: PaperFaceItem,
  style: PaperStyle,
  erodePx: number,
  place: (point: ScenePoint) => ScenePoint,
  unitsPerPt: number
): string | null {
  const rings = face.rings.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return null;
  const fill = paperFaceFill(style, face.side, face.shade);
  // Several rings are one even-odd set: the inner ones are holes whichever
  // way they turn.
  const d = rings
    .map((ring) => `M${ring.map((point) => pointText(place(point))).join('L')}Z`)
    .join('');
  const shape = `d="${d}"${rings.length > 1 ? ' fill-rule="evenodd"' : ''} fill="${fill}"`;
  const pen = face.outline ? penForRole(style, face.outline) : null;
  if (pen && !pen.dash) {
    return `  <path ${shape} stroke="${pen.color}" stroke-width="${num(pen.width * unitsPerPt)}"/>`;
  }
  const seam = num(SEAM_STROKE_WIDTH_PT * unitsPerPt);
  const element = `  <path ${shape} stroke="${fill}" stroke-width="${seam}"/>`;
  if (!pen) return element;
  const lines = faceOutlineLines(face).map((line) =>
    lineElement(line, style, erodePx, place, unitsPerPt)
  );
  return [element, ...lines.filter((line) => line !== null)].join('\n');
}

/**
 * The lines a face's outline stands for: one per edge of every ring it fills,
 * in the outline's role, on the face and hidden with it. Empty when the face
 * draws no outline. For a drawer that draws an outline as lines — the canvas,
 * and the painter's dashed pen — so each draws the lines the producer would
 * otherwise have emitted after the face.
 */
export function faceOutlineLines(face: PaperFaceItem): PaperLineItem[] {
  const role = face.outline;
  if (!role) return [];
  return face.rings
    .filter((ring) => ring.length >= 3)
    .flatMap((ring) =>
      ring.map(
        (a, i): PaperLineItem => ({
          kind: 'line',
          role,
          a,
          b: ring[(i + 1) % ring.length]!,
          onBoundary: [false, false],
          face: face.face,
          hidden: face.hidden,
        })
      )
    );
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
  const eroded = erodeLine(line, erodePx);
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
  const width = pen.width * unitsPerPt;
  const [joinsA, joinsB] = joints(line, eroded, pen, dash !== null);
  // Joined at both ends, the line is all joint; at one, the pen's cap stays on
  // the other end, and the joint is a dot the width of the line. A piece
  // shorter than its own width, drawn round, is a blob — where a crease peeks
  // out from under a face by a sliver — and the pieces either side each reach
  // half a width into the span it covers, so it draws nothing they do not.
  if (joinsA && joinsB && length < width) return null;
  const cap = joinsA && joinsB ? 'round' : pen.cap;
  const dot = joinsA !== joinsB ? (joinsA ? from : to) : null;
  const element =
    `  <line x1="${num(from[0])}" y1="${num(from[1])}" ` +
    `x2="${num(to[0])}" y2="${num(to[1])}" ` +
    `stroke="${pen.color}" stroke-width="${num(width)}" ` +
    `stroke-linecap="${cap}"${dashAttr}/>`;
  return dot
    ? `${element}\n  <circle cx="${num(dot[0])}" cy="${num(dot[1])}" r="${num(width / 2)}" fill="${pen.color}"/>`
    : element;
}

/**
 * Which ends of a line are joints the pen's own cap would open a gap at: an
 * end another line carries on from (`PaperLineItem.joined`), drawn round so
 * the two meet whole — the pieces a mesh draws one crease in bend at every
 * link, and a butt end at each left a wedge out of the outside of the bend.
 *
 * Only for a solid pen with butt caps: a round cap already joins, and a dash
 * is gaps on purpose. And never an end erode pulled back, which was meant to
 * stop short of what it met.
 */
function joints(
  line: PaperLineItem,
  eroded: readonly [ScenePoint, ScenePoint],
  pen: Pen,
  dashed: boolean
): [boolean, boolean] {
  if (!line.joined || pen.cap !== 'butt' || dashed) return [false, false];
  const stays = (end: ScenePoint, at: ScenePoint) => end[0] === at[0] && end[1] === at[1];
  return [
    line.joined[0] && stays(eroded[0], line.a),
    line.joined[1] && stays(eroded[1], line.b),
  ];
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
 * A line's ink under erode: the segment to draw, or null for none.
 *
 * A whole crease erodes as {@link erodeSegment} says. A piece the tree cut
 * from a longer crease (`line.whole`) is the span of that crease between its
 * cuts, and the crease is what retreats — as the edge shader and the canvas-2D
 * fallback measure it, on the whole edge — so the piece is what is left of
 * its span once the crease's flagged ends have pulled in: a piece cut 10 px
 * from a flagged end with an 8 px erode keeps its last 2 px rather than
 * collapsing on its own length, and a piece that does not own that end still
 * gives up what the pull takes. Nothing when the crease collapses or the span
 * lies wholly in a pulled-off end.
 */
export function erodeLine(
  line: Pick<PaperLineItem, 'a' | 'b' | 'onBoundary' | 'whole'>,
  erodePx: number
): [ScenePoint, ScenePoint] | null {
  const whole = line.whole;
  if (!whole || !(erodePx > 0)) return erodeSegment(line.a, line.b, line.onBoundary, erodePx);
  const eroded = erodeSegment(whole.a, whole.b, whole.onBoundary, erodePx);
  if (!eroded) return null;
  const dx = whole.b[0] - whole.a[0];
  const dy = whole.b[1] - whole.a[1];
  const span = dx * dx + dy * dy;
  if (!(span > 0)) return null;
  const along = (point: ScenePoint) =>
    ((point[0] - whole.a[0]) * dx + (point[1] - whole.a[1]) * dy) / span;
  const low = along(eroded[0]);
  const high = along(eroded[1]);
  // An end inside what is left keeps its own coordinates; one past a pulled
  // end lands exactly on it.
  const clamp = (point: ScenePoint): ScenePoint => {
    const t = along(point);
    return t < low ? eroded[0] : t > high ? eroded[1] : point;
  };
  const from = clamp(line.a);
  const to = clamp(line.b);
  if (from[0] === to[0] && from[1] === to[1]) return null;
  return [from, to];
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

function pointText([x, y]: ScenePoint): string {
  return `${num(x)},${num(y)}`;
}

/** Two decimals, like every writer in the app: a hundredth of a pt is below any output device. */
function num(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0';
}

/**
 * A multiplier, at the precision a double carries: rounded like a coordinate
 * it would displace whatever it scales by that rounding times the distance
 * from the origin, which is a visible error a page's width away.
 */
function multiplier(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '1';
}
