/**
 * An enlarged step's boundary (Revision 2, "Rendering on every surface"):
 * the edge of its frame, drawn as part of its picture — in the paper style's
 * edges pen, in the paper's ink — not as a mark.
 *
 * - **Whole** (look 2) draws the frame's whole outline.
 * - **Cut** (look 1) draws it only where it crosses paper: the outline is
 *   walked over the step's paper ({@link paperSilhouette}), each stretch over
 *   paper runs on past where it leaves it by the overshoot — 0.2 of the
 *   frame's printed radius, held to 2–6 mm, so it reads as Zach's arc does
 *   and not as a stub — and gaps under 2 mm as it prints are drawn through.
 *   A frame whose stretches over paper cover 97% of it or more lies over
 *   paper, and is drawn whole; one that crosses no paper draws nothing.
 *
 * A picture with no paper outline — an upload, a fixed picture — has nothing
 * to cut along, and draws whole whatever its Edge says.
 *
 * Pure: no DOM, no store. Shares of an outline are measured along it from its
 * first point (`zoomOutlinePoints`): a circle's rightmost point, going
 * clockwise on the page; a rounded rectangle's top side's right end.
 */
import { createOverlayProjector, ringPieces, sheetCorners } from '../../cp-workspace/references/stepDiagramGeometry';
import type { ScenePoint } from '../../lib/paper/paperScene';
import type { PicturePoint } from '../annotate/annotationModel';
import { piecesUnder } from '../annotate/behindFlaps';
import type { PictureCover } from '../annotate/pictureGeometry';
import type {
  DiagramAsset,
  DiagramScenePicture,
  DiagramStep,
  DiagramStepDiagramPicture,
  DiagramZoomEdge,
  DiagramZoomOutline,
} from '../document/diagramDocument';
import { stepPictureSource } from '../pictures/paintDiagramStep';
import { stepDiagramToPicture } from '../pictures/paintStepDiagram';
import { storedScene } from '../pictures/pictureFrame';
import {
  ZOOM_CLOSED_SHARE,
  ZOOM_GAP_MM,
  ZOOM_OVERSHOOT,
  zoomCornerRadius,
  zoomOutlinePoints,
  zoomShapeOf,
} from './zoomModel';

/** The sides a circle is walked at to find where it crosses paper: a ring's, as a mark behind a flap is worked out. */
export const ZOOM_EDGE_SIDES = 96;

/** The points a rounded rectangle's corner is walked at, its sides exactly. */
export const ZOOM_EDGE_PER_CORNER = 32;

/** A stretch of an outline: from and to, as shares of its length; `to` past 1 runs on through its first point. */
export type ZoomStretch = readonly [number, number];

/** What an enlarged step's boundary draws: its whole outline, stretches of it, or nothing. */
export type ZoomEdgeDrawn = { kind: 'whole' } | { kind: 'stretches'; stretches: readonly ZoomStretch[] } | { kind: 'none' };

const WHOLE: ZoomEdgeDrawn = { kind: 'whole' };
const NONE: ZoomEdgeDrawn = { kind: 'none' };

/**
 * A step's paper as the faces that make it, in picture units: what a Cut
 * frame is drawn over. A captured scene's faces as drawn — a flat fold's
 * layers, a crease pattern's sheet, a 3D or simulated picture's faces as the
 * painter's tree cut them, which only approximate its paper's outline; a
 * References step's sheet and the flaps its card draws. Null for a picture
 * with no paper outline: an upload, a fixed picture, a step with no picture.
 * Read once per picture object.
 */
export function paperSilhouette(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): readonly PictureCover[] | null {
  const source = stepPictureSource(step, assets);
  switch (source?.kind) {
    case 'scene':
      return memo(source.picture, () => sceneSilhouette(source.picture));
    case 'step-diagram':
      return memo(source.picture, () => sheetSilhouette(source.picture));
    case 'asset':
    case 'fixed':
    case undefined:
      return null;
  }
}

const silhouettes = new WeakMap<object, readonly PictureCover[] | null>();

function memo(picture: object, read: () => readonly PictureCover[] | null): readonly PictureCover[] | null {
  if (!silhouettes.has(picture)) silhouettes.set(picture, read());
  return silhouettes.get(picture)!;
}

function sceneSilhouette(picture: DiagramScenePicture): readonly PictureCover[] | null {
  const scene = storedScene(picture);
  if (!scene) return null;
  const { minX, minY, maxX, maxY } = scene.bounds;
  const longer = Math.max(maxX - minX, maxY - minY);
  if (!(longer > 0)) return null;
  // Scene px to picture units: the frame is the scene's bounds (`stepPictureFrame`).
  const toPicture = ([x, y]: ScenePoint): PicturePoint => [(x - minX) / longer, (y - minY) / longer];
  const covers: PictureCover[] = [];
  scene.items.forEach((item, order) => {
    if (item.kind !== 'face' || item.hidden) return;
    for (const ring of item.rings) {
      const cover = coverOf(ring.map(toPicture), order);
      if (cover) covers.push(cover);
    }
  });
  return covers;
}

function sheetSilhouette({ model, mirrored }: DiagramStepDiagramPicture): readonly PictureCover[] {
  const toPicture = stepDiagramToPicture(model, mirrored);
  const covers: PictureCover[] = [];
  const sheet = coverOf(sheetCorners(model.sheet).map(toPicture), 0);
  if (sheet) covers.push(sheet);
  model.primitives.forEach((primitive, order) => {
    if (primitive.kind !== 'region') return;
    const flap = coverOf(primitive.corners.map(toPicture), order + 1);
    if (flap) covers.push(flap);
  });
  return covers;
}

function coverOf(ring: readonly PicturePoint[], order: number): PictureCover | null {
  if (ring.length < 3) return null;
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return { ring, order, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/**
 * How far a cut frame's stretches run on past where they leave the paper, in
 * mm as it prints: {@link ZOOM_OVERSHOOT}'s share of its printed radius — a
 * rounded rectangle's shorter half-side — held to its range.
 */
export function zoomOvershootMm(outline: DiagramZoomOutline, mmPerUnit: number): number {
  const half = zoomShapeOf(outline) === 'circle' ? outline.radius! : Math.min(outline.size![0], outline.size![1]) / 2;
  const mm = ZOOM_OVERSHOOT.share * half * mmPerUnit;
  return Math.min(ZOOM_OVERSHOOT.maxMm, Math.max(ZOOM_OVERSHOOT.minMm, Number.isFinite(mm) ? mm : 0));
}

/** The outline walked as {@link ZOOM_EDGE_SIDES} or its corners' points: what it is cut along. */
export function zoomEdgeRing(outline: DiagramZoomOutline): PicturePoint[] {
  return zoomOutlinePoints(outline, ZOOM_EDGE_SIDES, ZOOM_EDGE_PER_CORNER);
}

/** The last few boundaries worked out over each silhouette: a card, the canvas and a page ask for the same ones. */
const drawnCache = new WeakMap<readonly PictureCover[], Map<string, ZoomEdgeDrawn>>();
const DRAWN_KEPT = 16;

/**
 * What a frame's boundary draws, `outline` in picture units over a picture
 * whose `silhouette` is its paper (null: none), printed at `mmPerUnit` mm per
 * picture unit: whole, by its Edge — unsaid, its shape's own — or where a Cut
 * frame crosses paper.
 */
export function zoomEdgeDrawn(
  outline: DiagramZoomOutline,
  edge: DiagramZoomEdge,
  silhouette: readonly PictureCover[] | null,
  mmPerUnit: number
): ZoomEdgeDrawn {
  if (edge === 'whole' || !silhouette) return WHOLE;
  let known = drawnCache.get(silhouette);
  if (!known) {
    known = new Map();
    drawnCache.set(silhouette, known);
  }
  const key = JSON.stringify([outline, mmPerUnit]);
  const hit = known.get(key);
  if (hit) return hit;
  const drawn = cutEdge(outline, silhouette, mmPerUnit);
  known.set(key, drawn);
  if (known.size > DRAWN_KEPT) known.delete(known.keys().next().value!);
  return drawn;
}

function cutEdge(outline: DiagramZoomOutline, silhouette: readonly PictureCover[], mmPerUnit: number): ZoomEdgeDrawn {
  const ring = zoomEdgeRing(outline);
  // Only the faces near it can meet it: the rest are not walked.
  const near = nearOutline(silhouette, ring);
  if (near.length === 0) return NONE;
  const { pieces, length } = piecesUnder(ring, near, true);
  if (!(length > 0) || !(mmPerUnit > 0)) return NONE;
  const over = pieces.filter((piece) => piece.under).map((piece): [number, number] => [piece.start / length, piece.end / length]);
  if (over.length === 0) return NONE;
  const covered = over.reduce((sum, [from, to]) => sum + (to - from), 0);
  if (covered >= ZOOM_CLOSED_SHARE) return WHOLE;
  const grow = zoomOvershootMm(outline, mmPerUnit) / mmPerUnit / length;
  const gap = ZOOM_GAP_MM / mmPerUnit / length;
  const stretches = mergedRound(over.map(([from, to]) => [from - grow, to + grow]), gap);
  if (stretches.length === 1 && stretches[0]![1] - stretches[0]![0] >= 1) return WHOLE;
  return { kind: 'stretches', stretches };
}

/** The covers whose boxes meet the ring's, grown by a hair. */
function nearOutline(silhouette: readonly PictureCover[], ring: readonly PicturePoint[]): PictureCover[] {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const hair = 1e-6;
  const [minX, minY, maxX, maxY] = [Math.min(...xs) - hair, Math.min(...ys) - hair, Math.max(...xs) + hair, Math.max(...ys) + hair];
  return silhouette.filter(({ box }) => box[0] <= maxX && box[2] >= minX && box[1] <= maxY && box[3] >= minY);
}

/**
 * Stretches round a closed outline (shares, any of them past 0 or 1) merged
 * where they overlap or where the gap between them is under `gap`, each
 * starting in [0, 1); one that comes round to meet itself covers it all.
 */
function mergedRound(stretches: readonly (readonly [number, number])[], gap: number): ZoomStretch[] {
  const wrapped = stretches
    .map(([from, to]): [number, number] => {
      const start = from - Math.floor(from);
      return [start, start + (to - from)];
    })
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of wrapped) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + gap) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  // Round the outline: the last runs on into the first.
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] + 1 > last[1] + gap) break;
    last[1] = Math.max(last[1], first[1] + 1);
    out.shift();
  }
  if (out.length === 1 && out[0]![1] - out[0]![0] >= 1 - gap) return [[0, 1]];
  return out;
}

/**
 * The boundary as SVG path data, `outline` in the target's units — the
 * picture-unit outline the boundary was worked out on, placed by a uniform
 * scale and a shift, which keeps every share. Empty when it draws nothing.
 * A circle's stretches are its own arcs (`ringPieces`); a rounded
 * rectangle's run along its sides and round its corners.
 */
export function zoomEdgePaths(outline: DiagramZoomOutline, drawn: ZoomEdgeDrawn): string[] {
  if (drawn.kind === 'none') return [];
  if (zoomShapeOf(outline) === 'circle') return circlePaths(outline, drawn);
  if (drawn.kind === 'whole') return [roundedPath(outline)];
  const ring = zoomEdgeRing(outline);
  return drawn.stretches.map((stretch) => polylinePath(alongRing(ring, stretch)));
}

function circlePaths(outline: DiagramZoomOutline, drawn: Exclude<ZoomEdgeDrawn, { kind: 'none' }>): string[] {
  const [cx, cy] = outline.centre;
  // The page's y down, as a y-up sheet seen through a flip: what `ringPieces` draws on.
  const project = createOverlayProjector({ origin: [0, 0], ex: [1, 0], ey: [0, -1] }, 1);
  const hidden = drawn.kind === 'whole' ? undefined : gapsBetween(drawn.stretches);
  return ringPieces([cx, -cy], outline.radius!, hidden, project)
    .filter((piece) => !piece.hidden)
    .map((piece) => piece.d);
}

/** The shares of [0, 1] no stretch covers, for `ringPieces` to leave out. */
function gapsBetween(stretches: readonly ZoomStretch[]): [number, number][] {
  const pieces: [number, number][] = [];
  for (const [from, to] of stretches) {
    if (to > 1) {
      pieces.push([from, 1], [0, to - 1]);
    } else pieces.push([from, to]);
  }
  pieces.sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let at = 0;
  for (const [from, to] of pieces) {
    if (from > at) gaps.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < 1) gaps.push([at, 1]);
  return gaps;
}

/** A rounded rectangle whole: its sides, and each corner a quarter circle, turned with it. */
function roundedPath(outline: DiagramZoomOutline): string {
  const radius = zoomCornerRadius(outline);
  const ring = zoomOutlinePoints(outline, ZOOM_EDGE_SIDES, 1);
  // Two points per corner: where its arc starts and ends, clockwise on the page.
  const parts: string[] = [];
  for (let corner = 0; corner < 4; corner += 1) {
    const [from, to] = [ring[corner * 2]!, ring[corner * 2 + 1]!];
    parts.push(`${corner === 0 ? 'M' : 'L'} ${fmt(from[0])} ${fmt(from[1])}`);
    parts.push(`A ${fmt(radius)} ${fmt(radius)} 0 0 1 ${fmt(to[0])} ${fmt(to[1])}`);
  }
  return `${parts.join(' ')} Z`;
}

/** The points of a closed ring from one share of its length to another, the ends where they fall. */
function alongRing(ring: readonly PicturePoint[], [from, to]: ZoomStretch): PicturePoint[] {
  // Where each point is along the ring, as a share of its length from the first.
  const at: number[] = [0];
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [a, b] = [ring[index]!, ring[(index + 1) % ring.length]!];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    at.push(total);
  }
  if (!(total > 0)) return [];
  const shares = at.map((length) => length / total);
  const pointAt = (share: number): PicturePoint => {
    const wrapped = share - Math.floor(share);
    const side = Math.min(ring.length - 1, Math.max(0, shares.findIndex((end) => end >= wrapped) - 1));
    const run = shares[side + 1]! - shares[side]!;
    const t = run > 0 ? (wrapped - shares[side]!) / run : 0;
    const [a, b] = [ring[side]!, ring[(side + 1) % ring.length]!];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // The ring's own points strictly between the ends, once round and then on past its first point.
  const between = ring
    .flatMap((point, index) => [shares[index]!, shares[index]! + 1].map((share) => ({ share, point })))
    .filter(({ share }) => share > from && share < to)
    .sort((a, b) => a.share - b.share)
    .map(({ point }) => point);
  return [pointAt(from), ...between, pointAt(to)];
}

function polylinePath(points: readonly PicturePoint[]): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`).join(' ');
}

function fmt(value: number): string {
  return String(Number(value.toFixed(3)));
}
