/**
 * The letters on the Layer order dialog's panes: which faces carry one, how
 * it reads, and where it sits (`implementation-plans/layer-order-dialog.md`,
 * row U8; D7 and its addition; Round3:1301-1380, `Round4-States`' label cap).
 *
 * **Which faces.** The subject, the objects picked, a pressed or hovered
 * row's faces and a clash's faces always do. While objects are being chosen,
 * so do the faces a pick can take, up to the cap (D7): with more of them
 * than {@link LAYER_ORDER_LABEL_CAP}, the nearest that many to the subject
 * keep their letters, measured on the crease pattern; pointing at a face the
 * cap left out gathers them round that face instead ({@link
 * withPointerLetters}), while pointing at a lettered one moves none, so the
 * letters hold still under a moving pointer. Every one of them stays
 * tinted, so a face past the cap is still findable; the hint counts them
 * (U10). Nothing else is ever lettered: choosing a subject, the faces with
 * choices are only tinted.
 *
 * **How it reads.** A chip in theme tokens, opaque, so it reads the same
 * over any paper: outlined in `--face-pick` for a pick (the subject, an
 * object, a row's face), in danger with a dot before the letter for a clash
 * (the list's own clash mark, so a clash reads without hue), plain for a face
 * a pick can take. A face entirely hidden on the folded paper gets a smaller,
 * quieter chip ({@link LayerPlacedLabel.under}), never a dashed one.
 *
 * **Where.** Each face offers spots, best first, each a point and the region
 * around it a chip must sit inside: on the crease pattern, points inside the
 * face (its centroid when that is inside, then the roomiest points along it,
 * `ringSpots`); on the folded paper, the middles of its largest spots
 * on top, or for a face nothing shows of, its middle and its largest spots
 * under others. Letters are placed in pixels, at a size that holds on screen,
 * so {@link placeLabels} runs per frame of the camera; what it reads per face
 * is worked out once per order and face ({@link foldedLabelIndex},
 * {@link patternLabelIndex}).
 *
 * **Only legible letters, only where they fit** (D7's addition, U8's review):
 * - a chip sits inside its region with room for the ring along the face's
 *   edge, so it never hides a face narrower than itself, nor its ring;
 * - a plain letter (a face a pick can take) takes the first of its spots
 *   where it fits clear of the letters placed before it, and is left out
 *   when none is: its face stays tinted, and zooming in makes room. On
 *   iguana-c0 at fit the fifty nearest faces lie within a few millimetres of
 *   each other, and their chips piled into one grey block;
 * - a letter that must show ({@link LayerPaneLabel.keep}: a pick's, a
 *   clash's, the face pointed at) takes a clear spot inside its face if one
 *   has room, else sits just off the face, beside it, so it never covers the
 *   tint and ring that mark it; and clear of every line the pane draws
 *   ({@link labelLineIndex}), so it never covers another crease either
 *   (D20), when such a spot lies close by ({@link BESIDE_CLEAR_REACH_CHIPS}).
 *   Further out it would lose its tie to the face, so it sits against the
 *   face over the crease instead.
 *
 * Pure: no React, no store, no engine.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import { insideEvenOdd } from '../../cp-workspace/picking/polygonContains';
import type { LayerFace } from '../engine/faceIndex';
import { LAYER_ORDER_LABEL_CAP } from '../layerOrderBudgets';
import { ringArea, ringCentroid, ringInterior, type LayerPaneSegment } from './layerPaneFigure';
import type { LayerFaceMarks } from './layerPaneMarks';

/** How a face's letter reads. */
export type LayerLabelTone = 'pick' | 'danger' | 'plain';

export interface LayerPaneLabel {
  readonly face: LayerFace;
  readonly tone: LayerLabelTone;
  /** It shows whatever room it finds: a pick's, a clash's, the face pointed at. Any other needs a clear spot it fits. */
  readonly keep: boolean;
}

export interface LayerPaneLetters {
  /** The faces lettered, in the order they are placed: picks and the clash first, then the rest. */
  readonly labels: readonly LayerPaneLabel[];
  /** The faces a pick can take whose letters the cap leaves out: tinted, unlettered. */
  readonly pastCap: readonly LayerFace[];
}

/**
 * The faces a pick can take that keep their letters: all of them up to
 * `cap`; past it, the face pointed at when it is one of them, and the `cap`
 * nearest to it (to `anchor` when nothing is pointed at), by their centroids
 * on the crease pattern, nearest first, the face's number breaking a tie.
 */
export function cappedFaces(
  faces: readonly LayerFace[],
  pointed: LayerFace | null,
  anchor: LayerFace | null,
  centroids: readonly (Point | null)[],
  cap: number = LAYER_ORDER_LABEL_CAP
): LayerFace[] {
  if (faces.length <= cap) return [...faces];
  const offered = pointed !== null && faces.includes(pointed) ? pointed : null;
  const from = offered ?? anchor;
  const at = from !== null ? centroids[from] : null;
  const distance = (face: LayerFace) => {
    const c = centroids[face];
    return c && at ? Math.hypot(c.x - at.x, c.y - at.y) : Infinity;
  };
  const nearest = faces
    .filter((face) => face !== offered)
    .sort((a, b) => distance(a) - distance(b) || a - b)
    .slice(0, cap);
  return offered !== null ? [offered, ...nearest] : nearest;
}

/** The faces that carry letters on both panes, and how each reads (see the module docs). */
export function paneLetters(
  marks: LayerFaceMarks,
  centroids: readonly (Point | null)[],
  cap: number = LAYER_ORDER_LABEL_CAP
): LayerPaneLetters {
  const tones = new Map<LayerFace, LayerLabelTone>();
  const clash = new Set(marks.clash);
  const pick = (face: LayerFace) => {
    if (!clash.has(face)) tones.set(face, 'pick');
  };
  for (const face of marks.clash) tones.set(face, 'danger');
  if (marks.subject !== null) pick(marks.subject);
  marks.objects.forEach(pick);
  marks.row.forEach(pick);
  const offered = marks.picking === 'object' ? marks.pickable : [];
  const kept = cappedFaces(offered, marks.pointed, marks.subject, centroids, cap);
  const keptSet = new Set(kept);
  for (const face of kept) if (!tones.has(face)) tones.set(face, 'plain');
  const labels: LayerPaneLabel[] = [];
  for (const [face, tone] of tones) if (tone !== 'plain') labels.push({ face, tone, keep: true });
  for (const [face, tone] of tones) if (tone === 'plain') labels.push({ face, tone, keep: face === marks.pointed });
  const pastCap = offered.filter((face) => !keptSet.has(face) && !tones.has(face));
  return { labels, pastCap };
}

/**
 * The letters of `marks` from `base`, the same marks' letters with nothing
 * following the pointer (`baseMarks`): a row's faces join as picks and the
 * face pointed at must show. Only past the cap, with the pointer on a face
 * the cap left out, does the cap gather round it again (D7); otherwise this
 * reads no more than the pointer's faces.
 */
export function withPointerLetters(
  base: LayerPaneLetters,
  marks: LayerFaceMarks,
  centroids: readonly (Point | null)[],
  cap: number = LAYER_ORDER_LABEL_CAP
): LayerPaneLetters {
  if (marks.pointed === null && marks.row.length === 0) return base;
  const offered = marks.picking === 'object' ? marks.pickable : [];
  const pointedOffered = marks.pointed !== null && offered.includes(marks.pointed);
  if (pointedOffered && offered.length > cap && base.pastCap.includes(marks.pointed!)) {
    return paneLetters(marks, centroids, cap);
  }
  const clash = new Set(marks.clash);
  const rowPicks = new Set(marks.row.filter((face) => !clash.has(face)));
  const labels: LayerPaneLabel[] = [];
  const seen = new Set<LayerFace>();
  for (const label of base.labels) {
    if (label.tone === 'plain') continue;
    labels.push(label);
    seen.add(label.face);
  }
  for (const face of rowPicks) {
    if (seen.has(face)) continue;
    labels.push({ face, tone: 'pick', keep: true });
    seen.add(face);
  }
  for (const label of base.labels) {
    if (label.tone !== 'plain' || seen.has(label.face)) continue;
    labels.push(label.face === marks.pointed ? { ...label, keep: true } : label);
  }
  return { labels, pastCap: base.pastCap.filter((face) => !rowPicks.has(face)) };
}

// ---------------------------------------------------------------------------
// Size

/** A chip's letter size, CSS px: a face's, and a hidden face's (Round3's `tagSize`). */
export const LABEL_FONT_PX = 10.5;
export const LABEL_UNDER_FONT_PX = 9.5;

/** A chip's box, CSS px: what the chip is drawn at and what placing it keeps clear. */
export function labelSize(text: string, under: boolean, dot: boolean): { width: number; height: number } {
  const font = under ? LABEL_UNDER_FONT_PX : LABEL_FONT_PX;
  return { width: (text.length * 0.66 + 1) * font + (dot ? 8 : 0), height: 1.55 * font };
}

// ---------------------------------------------------------------------------
// Where

/** A place a face's letter may sit: a point, and the region round it the chip must stay inside, in the pane's frame. */
export interface LayerLabelSpot {
  readonly at: Point;
  readonly region: readonly Point[];
}

/** Where a face's letter may sit, best first, and the face itself, to sit beside when it must. */
export interface LayerLabelSpots {
  /** Some part of the face shows: the spots are its parts on top. */
  readonly visible: boolean;
  readonly spots: readonly LayerLabelSpot[];
  /** The face's whole outline in the pane's frame: what a letter that must show sits beside. */
  readonly outline: readonly Point[];
}

/** How many lines each way across a region {@link ringSpots} reads. */
const SPOT_LINES = 9;

/** The sorted crossings of `ring` with the line `y = at` (`horizontal`) or `x = at`, along the line. */
function lineCrossings(ring: readonly Point[], horizontal: boolean, at: number): number[] {
  const out: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const [au, av, bu, bv] = horizontal ? [a.y, a.x, b.y, b.x] : [a.x, a.y, b.x, b.y];
    if (au > at !== bu > at) out.push(av + ((at - au) * (bv - av)) / (bu - au));
  }
  return out.sort((l, r) => l - r);
}

/** How long the run inside `ring` through `p` is, across (`horizontal`) or down; 0 outside. */
function runThrough(ring: readonly Point[], horizontal: boolean, p: Point): number {
  const along = horizontal ? p.x : p.y;
  const crossings = lineCrossings(ring, horizontal, horizontal ? p.y : p.x);
  for (let c = 0; c + 1 < crossings.length; c += 2) {
    if (crossings[c]! <= along && along <= crossings[c + 1]!) return crossings[c + 1]! - crossings[c]!;
  }
  return 0;
}

/**
 * Up to `count` points inside `ring`, best first: its centroid when that is
 * inside, then the roomiest middles of its runs across and down (a point's
 * room is the shorter of the two runs through it), each kept from the ones
 * before by the ring's longer side over `count + 1`. So a long face offers
 * points along its length, whichever way it lies.
 */
export function ringSpots(ring: readonly Point[], count: number): Point[] {
  if (ring.length < 3 || count <= 0) return [];
  const xs = ring.map(({ x }) => x);
  const ys = ring.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  const candidates: { at: Point; room: number }[] = [];
  const consider = (at: Point) => {
    const room = Math.min(runThrough(ring, true, at), runThrough(ring, false, at));
    if (room > 0) candidates.push({ at, room });
  };
  for (let k = 1; k <= SPOT_LINES; k += 1) {
    const y = top + (k * height) / (SPOT_LINES + 1);
    const across = lineCrossings(ring, true, y);
    for (let c = 0; c + 1 < across.length; c += 2) consider({ x: (across[c]! + across[c + 1]!) / 2, y });
    const x = left + (k * width) / (SPOT_LINES + 1);
    const down = lineCrossings(ring, false, x);
    for (let c = 0; c + 1 < down.length; c += 2) consider({ x, y: (down[c]! + down[c + 1]!) / 2 });
  }
  candidates.sort((a, b) => b.room - a.room);
  const out: Point[] = [];
  const centroid = ringCentroid(ring);
  if (centroid && insideEvenOdd(ring, centroid)) out.push(centroid);
  const apart = Math.max(width, height) / (count + 1);
  for (const { at } of candidates) {
    if (out.length >= count) break;
    if (out.every((p) => Math.hypot(p.x - at.x, p.y - at.y) >= apart)) out.push(at);
  }
  if (out.length === 0) {
    const inside = ringInterior(ring);
    if (inside) out.push(inside);
  }
  return out;
}

/**
 * How many points a face's letter tries on the crease pattern; on the folded
 * paper, how many of a shown face's spots, of a hidden one's, and points in
 * each.
 */
const PATTERN_TRIES = 6;
const VISIBLE_TRIES = 8;
const HIDDEN_TRIES = 6;
const SPOTS_PER_REGION = 3;

/**
 * Where each face's letter may sit on the crease pattern: points inside its
 * ring, the ring the region. Worked out for a face the first time it is asked
 * for, and kept.
 */
export function patternLabelIndex(rings: readonly (readonly Point[])[]): (face: LayerFace) => LayerLabelSpots | null {
  const cache = new Map<LayerFace, LayerLabelSpots | null>();
  return (face) => {
    let spots = cache.get(face);
    if (spots === undefined) {
      const ring = rings[face];
      spots =
        ring && ring.length >= 3
          ? { visible: true, spots: ringSpots(ring, PATTERN_TRIES).map((at) => ({ at, region: ring })), outline: ring }
          : null;
      cache.set(face, spots);
    }
    return spots;
  };
}

/**
 * Where each face's letter may sit on the folded paper of `scene` (the side
 * shown, stacked in the order on screen): points in its spots on top
 * (`ringSpots`), largest spot first, each spot their region; for a face
 * nothing shows of, points in its outline, then in its largest spots under
 * others. The spots each face is in
 * are gathered once per scene; a face's letter spots, the first time asked.
 */
export function foldedLabelIndex(scene: OristudioCpFoldedPaperScene): (face: LayerFace) => LayerLabelSpots | null {
  const onTop = new Map<LayerFace, number[]>();
  const under = new Map<LayerFace, number[]>();
  scene.subfaces.forEach((subface, spot) => {
    subface.faces_top_to_bottom.forEach((face, depth) => {
      const into = depth === 0 ? onTop : under;
      const list = into.get(face);
      if (list) list.push(spot);
      else into.set(face, [spot]);
    });
  });
  const areas = new Map<number, number>();
  const areaOf = (spot: number) => {
    let area = areas.get(spot);
    if (area === undefined) {
      area = ringArea(scene.subfaces[spot]!.polygon);
      areas.set(spot, area);
    }
    return area;
  };
  const within = (region: readonly Point[]): LayerLabelSpot[] =>
    ringSpots(region, SPOTS_PER_REGION).map((at) => ({ at, region }));
  const largest = (spots: readonly number[] | undefined, count: number): LayerLabelSpot[] =>
    (spots ?? [])
      .slice()
      .sort((a, b) => areaOf(b) - areaOf(a))
      .slice(0, count)
      .flatMap((spot) => within(scene.subfaces[spot]!.polygon));
  const cache = new Map<LayerFace, LayerLabelSpots | null>();
  return (face) => {
    let spots = cache.get(face);
    if (spots !== undefined) return spots;
    const outline = scene.faces[face]?.outline ?? [];
    const shown = onTop.get(face);
    if (shown && shown.length > 0) {
      spots = { visible: true, spots: largest(shown, VISIBLE_TRIES), outline };
    } else if (outline.length >= 3 || under.has(face)) {
      spots = { visible: false, spots: [...within(outline), ...largest(under.get(face), HIDDEN_TRIES)], outline };
    } else {
      spots = null;
    }
    cache.set(face, spots);
    return spots;
  };
}

/**
 * The lines a pane draws, in its frame, bucketed once on a grid
 * ({@link labelLineIndex}): a letter set beside its face asks only about the
 * lines through the cells its chip covers, so a pattern of thousands of
 * creases costs it a handful.
 */
export interface LayerLabelLines {
  /** Each segment's ends, `ax, ay, bx, by`, one segment after another: each line once, however often it was given. */
  readonly ends: Float64Array;
  /** The bounds of every end, in the frame. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** Per cell, row by row, the segments that pass through it. */
  readonly cells: readonly (readonly number[])[];
  /**
   * Which look last met each segment, so a look that covers several cells a
   * segment passes through tests it once: the look's stamp, kept here so a
   * look allocates nothing.
   */
  readonly seen: Uint32Array;
  readonly looks: { stamp: number };
}

/** The most cells a side of {@link LayerLabelLines}' grid has. */
const LINE_GRID_MAX = 128;
/** How near, as a share of the lines' extent, two ends are to count as one point. */
const SAME_END = 1e-9;

const cellOf = (at: number, from: number, size: number, count: number) =>
  Math.min(count - 1, Math.max(0, Math.floor((at - from) / size)));

/**
 * `segments`, a pane's lines in its frame, each once, on a grid of about one
 * cell per segment, each segment in the cells it passes through rather than in
 * those its bounding box covers: a long diagonal crease is in a row of cells,
 * not in all of them. A segment given again, either way round, is the same
 * line: two faces of a crease both name it, and under X-ray the folded paper
 * draws a stack's outlines one over another, hundreds of copies of a few
 * dozen lines on iguana-c0. A segment with no length draws no line. Null for
 * none. Built once per crease pattern, or per order the folded pane shows.
 */
export function labelLineIndex(segments: readonly LayerPaneSegment[]): LayerLabelLines | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [a, b] of segments) {
    minX = Math.min(minX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y);
    maxX = Math.max(maxX, a.x, b.x);
    maxY = Math.max(maxY, a.y, b.y);
  }
  if (!Number.isFinite(minX + minY + maxX + maxY)) return null;
  // Each line once: its ends rounded to a hair of the extent, the lesser end first.
  const hair = Math.max(maxX - minX, maxY - minY) * SAME_END || SAME_END;
  const keyOf = ({ x, y }: Point) => `${Math.round(x / hair)},${Math.round(y / hair)}`;
  const kept = new Map<string, LayerPaneSegment>();
  for (const segment of segments) {
    const [ka, kb] = segment.map(keyOf) as [string, string];
    if (ka === kb) continue;
    const key = ka < kb ? `${ka} ${kb}` : `${kb} ${ka}`;
    if (!kept.has(key)) kept.set(key, segment);
  }
  if (kept.size === 0) return null;
  const lines = [...kept.values()];
  const ends = new Float64Array(lines.length * 4);
  lines.forEach(([a, b], k) => ends.set([a.x, a.y, b.x, b.y], k * 4));
  const side = Math.min(LINE_GRID_MAX, Math.max(1, Math.round(Math.sqrt(lines.length))));
  const columns = maxX > minX ? side : 1;
  const rows = maxY > minY ? side : 1;
  const cellWidth = (maxX - minX) / columns || 1;
  const cellHeight = (maxY - minY) / rows || 1;
  const cells: number[][] = Array.from({ length: columns * rows }, () => []);
  const column = (x: number) => cellOf(x, minX, cellWidth, columns);
  const row = (y: number) => cellOf(y, minY, cellHeight, rows);
  lines.forEach(([a, b], k) => {
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    // Where the segment is across the band `from`–`to`: all of it, when it runs along the band.
    const across = (from: number, to: number): [number, number] => {
      if (a.y === b.y) return [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      const xAt = (y: number) => a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
      const [x0, x1] = [xAt(Math.max(top, from)), xAt(Math.min(bottom, to))];
      return [Math.min(x0, x1), Math.max(x0, x1)];
    };
    for (let r = row(top); r <= row(bottom); r += 1) {
      const [left, right] = across(minY + r * cellHeight, minY + (r + 1) * cellHeight);
      for (let c = column(left); c <= column(right); c += 1) cells[r * columns + c]!.push(k);
    }
  });
  const seen = new Uint32Array(lines.length);
  return { ends, minX, minY, maxX, maxY, columns, rows, cellWidth, cellHeight, cells, seen, looks: { stamp: 0 } };
}

/**
 * How much further, CSS px, the box `minX`–`maxX` by `minY`–`maxY` must move
 * along `(dx, dy)`, a unit step, to leave every line that crosses it now: 0
 * when none does, Infinity when one runs along that way for good. Past
 * `limit`, the room the way has left, the answer is only that it is more: the
 * look stops at the first line it meets that needs more. Each cell it covers
 * and each line it reads is taken off `budget.left`.
 */
type LineClearance = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  dx: number,
  dy: number,
  limit: number,
  budget: { left: number }
) => number;

/** How far a point at `centre` on an axis, moving at `rate`, goes before it leaves `low`–`high`, which it is in. */
function axisExit(centre: number, low: number, high: number, rate: number): number {
  if (rate > 0) return (high - centre) / rate;
  if (rate < 0) return (low - centre) / rate;
  return Infinity;
}

/**
 * How far a box centred at `(cx, cy)`, `hw` and `hh` each way, moves along
 * `(dx, dy)` before it leaves the segment `(ax, ay)`–`(bx, by)` it crosses:
 * where the first of their separating axes (across, down, and the segment's
 * normal) stops overlapping. In plain numbers: it runs for every line a chip
 * crosses.
 */
function segmentExit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  dx: number,
  dy: number
): number {
  // Along the normal the segment is one point, `at`, and the box reaches `extent` either side of its centre.
  const [nx, ny] = [ay - by, bx - ax];
  const extent = hw * Math.abs(nx) + hh * Math.abs(ny);
  const at = nx * ax + ny * ay;
  return Math.min(
    axisExit(cx, Math.min(ax, bx) - hw, Math.max(ax, bx) + hw, dx),
    axisExit(cy, Math.min(ay, by) - hh, Math.max(ay, by) + hh, dy),
    axisExit(nx * cx + ny * cy, at - extent, at + extent, nx * dx + ny * dy)
  );
}

/**
 * How far a box on screen must move to clear `lines` ({@link LineClearance}),
 * the lines read through `project`: the camera's, affine, so its inverse
 * takes the box back to the frame to find the cells it covers. Null when
 * `project` folds the plane flat.
 */
function lineClearance(lines: LayerLabelLines, project: (point: Point) => Point): LineClearance | null {
  const o = project({ x: 0, y: 0 });
  const ex = project({ x: 1, y: 0 });
  const ey = project({ x: 0, y: 1 });
  // On screen, o + (a b; c d) · p; back in the frame, each coordinate p·x + q·y + r of the screen's.
  const [a, b, c, d] = [ex.x - o.x, ey.x - o.x, ex.y - o.y, ey.y - o.y];
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const [px, qx, py, qy] = [d / det, -b / det, -c / det, a / det];
  const [rx, ry] = [-(px * o.x + qx * o.y), -(py * o.x + qy * o.y)];
  const { ends, cells, columns, rows, cellWidth, cellHeight, seen, looks } = lines;
  const [ox, oy] = [o.x, o.y];
  return (minX, minY, maxX, maxY, dx, dy, limit, budget) => {
    // The box's bounds in the frame: a linear map's least and most over a box are at its corners.
    const fMinX = px * (px > 0 ? minX : maxX) + qx * (qx > 0 ? minY : maxY) + rx;
    const fMaxX = px * (px > 0 ? maxX : minX) + qx * (qx > 0 ? maxY : minY) + rx;
    const fMinY = py * (py > 0 ? minX : maxX) + qy * (qy > 0 ? minY : maxY) + ry;
    const fMaxY = py * (py > 0 ? maxX : minX) + qy * (qy > 0 ? maxY : minY) + ry;
    if (fMaxX < lines.minX || fMinX > lines.maxX || fMaxY < lines.minY || fMinY > lines.maxY) return 0;
    const [cx, cy, hw, hh] = [(minX + maxX) / 2, (minY + maxY) / 2, (maxX - minX) / 2, (maxY - minY) / 2];
    // A new stamp for this look; when the count wraps, every segment is unseen again.
    looks.stamp = (looks.stamp + 1) >>> 0;
    if (looks.stamp === 0) {
      seen.fill(0);
      looks.stamp = 1;
    }
    const stamp = looks.stamp;
    let past = 0;
    const firstRow = cellOf(fMinY, lines.minY, cellHeight, rows);
    const lastRow = cellOf(fMaxY, lines.minY, cellHeight, rows);
    const firstColumn = cellOf(fMinX, lines.minX, cellWidth, columns);
    const lastColumn = cellOf(fMaxX, lines.minX, cellWidth, columns);
    // Out of budget, the look ends as if the way were blocked for good.
    const covered = (lastRow - firstRow + 1) * (lastColumn - firstColumn + 1);
    if (covered > budget.left) {
      budget.left = 0;
      return Infinity;
    }
    budget.left -= covered;
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const cell = cells[row * columns + column]!;
        for (let i = 0; i < cell.length; i += 1) {
          const k = cell[i]!;
          if (seen[k] === stamp) continue;
          seen[k] = stamp;
          budget.left -= 1;
          if (budget.left < 0) return Infinity;
          const fax = ends[k * 4]!;
          const fay = ends[k * 4 + 1]!;
          const fbx = ends[k * 4 + 2]!;
          const fby = ends[k * 4 + 3]!;
          // Its ends on screen; past the box's sides at once, else through it, or not.
          const sax = ox + a * fax + b * fay;
          const say = oy + c * fax + d * fay;
          const sbx = ox + a * fbx + b * fby;
          const sby = oy + c * fbx + d * fby;
          if ((sax <= minX && sbx <= minX) || (sax >= maxX && sbx >= maxX)) continue;
          if ((say <= minY && sby <= minY) || (say >= maxY && sby >= maxY)) continue;
          if (!segmentCrossesBoxAt(sax, say, sbx, sby, minX, minY, maxX, maxY)) continue;
          past = Math.max(past, segmentExit(sax, say, sbx, sby, cx, cy, hw, hh, dx, dy));
          if (past > limit) return past;
        }
      }
    }
    return past;
  };
}

/** How {@link placeLabels} fits letters to the pane: its box, and the lines it draws. */
export interface LayerLabelPlacing {
  /** The pane's box, CSS px; null before it is measured. */
  readonly frame?: { readonly width: number; readonly height: number } | null;
  /** How wide the line along a face's edge is drawn, CSS px: every line the pane draws. */
  readonly linePx?: number;
  /**
   * Every line the pane draws, in its frame: a letter set beside its face
   * keeps clear of each as of its own face. Read through `project`, which
   * must then be affine, as a camera is.
   */
  readonly lines?: LayerLabelLines | null;
  /** How wide the widest of `lines` is drawn, CSS px: an aux pen may be wider than a face's edge. `linePx` when not given. */
  readonly linesPx?: number;
}

/** A letter placed on a pane, CSS px of the canvas box: its centre and its box. */
export interface LayerPlacedLabel {
  readonly face: LayerFace;
  readonly text: string;
  readonly tone: LayerLabelTone;
  /** Nothing of the face shows: the quieter chip. */
  readonly under: boolean;
  /** It sits beside its face, which had no room for it. */
  readonly off: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The space kept between two letters, CSS px. */
const LABEL_GAP_PX = 2;
/**
 * The room a chip keeps from its region's edge, CSS px: the widest ring
 * (2 px, set in half its stroke plus a pixel) and a pixel more, so a chip
 * never covers the ring along its face.
 */
export const LABEL_EDGE_ROOM_PX = 4;
/** How far a letter that sits beside its face keeps from it, CSS px. */
const LABEL_OFF_GAP_PX = 3;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether a chip of `size` centred at `at` lies inside `region` (CSS px), `room` in from its edge. */
export function chipFits(at: Point, size: { width: number; height: number }, region: readonly Point[], room: number): boolean {
  const halfW = size.width / 2 + room;
  const halfH = size.height / 2 + room;
  const corners: Point[] = [
    { x: at.x - halfW, y: at.y - halfH },
    { x: at.x + halfW, y: at.y - halfH },
    { x: at.x + halfW, y: at.y + halfH },
    { x: at.x - halfW, y: at.y + halfH },
  ];
  if (!corners.every((corner) => insideEvenOdd(region, corner))) return false;
  // A notch can bite into a box whose corners are all inside: no edge of the region may cross it.
  return region.every((a, i) => {
    const b = region[(i + 1) % region.length]!;
    return !segmentCrossesBox(a, b, at.x - halfW, at.y - halfH, at.x + halfW, at.y + halfH);
  });
}

/** Whether the segment `a`–`b` passes through the open box. */
function segmentCrossesBox(a: Point, b: Point, minX: number, minY: number, maxX: number, maxY: number): boolean {
  return segmentCrossesBoxAt(a.x, a.y, b.x, b.y, minX, minY, maxX, maxY);
}

/** {@link segmentCrossesBox}, the segment from `(ax, ay)` to `(bx, by)`. */
function segmentCrossesBoxAt(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): boolean {
  // Liang–Barsky clipping against the box, strictly inside; side by side, so a pane's thousands of lines allocate nothing.
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (let side = 0; side < 4; side += 1) {
    const p = side === 0 ? -dx : side === 1 ? dx : side === 2 ? -dy : dy;
    const q = side === 0 ? ax - minX : side === 1 ? maxX - ax : side === 2 ? ay - minY : maxY - ay;
    if (p === 0) {
      if (q <= 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 >= t1) return false;
    }
  }
  return true;
}

/** Whether a chip of `size` centred at `at` lies inside `frame`, the pane's box, CSS px. */
function chipInFrame(at: Point, size: { width: number; height: number }, frame: { width: number; height: number }): boolean {
  return (
    at.x - size.width / 2 >= 0 &&
    at.y - size.height / 2 >= 0 &&
    at.x + size.width / 2 <= frame.width &&
    at.y + size.height / 2 <= frame.height
  );
}

/** Whether a box, grown by `gap` each way, touches `ring`: lies over its inside or across its edge. */
function boxTouchesRing(box: Box, ring: readonly Point[], gap: number): boolean {
  const minX = box.x - box.width / 2 - gap;
  const maxX = box.x + box.width / 2 + gap;
  const minY = box.y - box.height / 2 - gap;
  const maxY = box.y + box.height / 2 + gap;
  if (insideEvenOdd(ring, { x: box.x, y: box.y })) return true;
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    if (a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) return true;
    return segmentCrossesBox(a, b, minX, minY, maxX, maxY);
  });
}

/** The ways out of a face a letter beside it tries: up, down, right, left, then the corners. */
const BESIDE_WAYS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
];
/** How far out, CSS px, and in what steps, a letter beside its face looks for room. */
const BESIDE_REACH_PX = 160;
const BESIDE_STEP_PX = 2;
/**
 * How far past its face a letter beside it goes for a spot clear of every
 * line, in heights of its own chip: further out, the letter loses its tie to
 * the face, and sits against the face over a crease instead. On kabuto at
 * Fit, a letter beside its face finds a clear spot right against it, or, the
 * furthest, 1.97 heights out (E, past the strip beside it, when C's letter
 * fills its corner); on iguana-c0 the subject's would go 7 heights, off the
 * paper. In chip heights, it holds at every zoom: a chip keeps its size on
 * screen.
 */
export const BESIDE_CLEAR_REACH_CHIPS = 2.5;
/**
 * How much a letter's search for a spot clear of the lines may read, in cells
 * of the lines' grid and lines met: placing runs per frame of the camera, with
 * a letter per pick. At Fit a letter reads a few hundred on iguana-c0's crease
 * pattern and up to 1,340 on cpoogle's densest (12k sides); zoomed out to a
 * quarter of Fit, the chip covers so much of the pattern that one reads 4,000
 * to 14,000 and finds nothing. Past the budget the letter takes the fallbacks,
 * as with no clear spot; about 40 µs a letter at most.
 */
export const BESIDE_CLEAR_BUDGET = 1500;

/**
 * Points beside a face, nearest first, ties in {@link BESIDE_WAYS}' order:
 * the first clear of every line the pane draws that is `wanted`, else null;
 * those clear of the lines it passed over on the way, all of them when none
 * was wanted; and those clear of the face alone.
 */
interface BesideSpots {
  readonly wanted: Point | null;
  readonly clear: readonly Point[];
  readonly any: readonly Point[];
}

const NO_BESIDE: BesideSpots = { wanted: null, clear: [], any: [] };

/**
 * Points just beside a face on screen, nearest first: from `from`, a point of
 * the face, out each way to where a chip of `size` first clears the face's
 * `outline` by {@link LABEL_OFF_GAP_PX} past the line along it (`half.face`,
 * half its drawn width). So the letter sits against the face it names,
 * whatever the face's shape, never across another part of it (`any`).
 *
 * `clear` goes on out each way, in the same steps, to where the chip clears
 * every line the pane draws (`clearance`) by as much past half the widest of
 * them (`half.lines`), so it covers no crease either, but no more than
 * {@link BESIDE_CLEAR_REACH_CHIPS} of its heights past where it cleared the
 * face. Each look skips the steps where a line it crosses still would, and
 * the ways are taken nearest first, so the search stops at the first spot
 * that is `wanted` without walking the others out. It reads no more than
 * {@link BESIDE_CLEAR_BUDGET}, and ends where that runs out. With no lines,
 * `clear` is `any`.
 */
function besideSpots(
  outline: readonly Point[],
  from: Point,
  size: { width: number; height: number },
  half: { readonly face: number; readonly lines: number },
  clearance: LineClearance | null,
  wanted: (at: Point) => boolean
): BesideSpots {
  if (outline.length < 3) return NO_BESIDE;
  const gap = half.face + LABEL_OFF_GAP_PX;
  const linesGap = half.lines + LABEL_OFF_GAP_PX;
  const [halfW, halfH] = [size.width / 2 + linesGap, size.height / 2 + linesGap];
  const at = ([dx, dy]: readonly [number, number], reach: number) => ({ x: from.x + dx * reach, y: from.y + dy * reach });
  const touches = (way: readonly [number, number], reach: number) =>
    boxTouchesRing({ ...at(way, reach), ...size }, outline, gap);
  // Out of the face each way, in steps.
  const ways: { way: readonly [number, number]; out: number; reach: number }[] = [];
  for (const way of BESIDE_WAYS) {
    let reach = BESIDE_STEP_PX;
    while (reach <= BESIDE_REACH_PX && touches(way, reach)) reach += BESIDE_STEP_PX;
    if (reach <= BESIDE_REACH_PX) ways.push({ way, out: reach, reach });
  }
  const any = [...ways].sort((a, b) => a.reach - b.reach).map(({ way, reach }) => at(way, reach));
  // On out past the lines, the nearest way first: a way's reach only grows, so the first clear is the nearest.
  const furthest = (way: { out: number }) => Math.min(BESIDE_REACH_PX, way.out + BESIDE_CLEAR_REACH_CHIPS * size.height);
  const clear: Point[] = [];
  const budget = { left: BESIDE_CLEAR_BUDGET };
  while (ways.length > 0 && budget.left > 0) {
    const next = ways.reduce((best, way) => (way.reach < best.reach ? way : best));
    const p = at(next.way, next.reach);
    const room = furthest(next) - next.reach;
    const crossed = clearance
      ? clearance(p.x - halfW, p.y - halfH, p.x + halfW, p.y + halfH, next.way[0], next.way[1], room, budget)
      : 0;
    // A convex face, left behind, stays behind; the check is only for a face that isn't.
    if (crossed === 0 && (next.reach === next.out || !touches(next.way, next.reach))) {
      clear.push(p);
      if (wanted(p)) return { wanted: p, clear, any };
      ways.splice(ways.indexOf(next), 1);
      continue;
    }
    // The next step past every line crossed here: every step before it still crosses one of them.
    const beyond = Math.ceil((next.reach + crossed) / BESIDE_STEP_PX - 1e-9) * BESIDE_STEP_PX;
    next.reach = Math.max(next.reach + BESIDE_STEP_PX, beyond);
    if (next.reach > furthest(next)) ways.splice(ways.indexOf(next), 1);
  }
  return { wanted: null, clear, any };
}

/**
 * `labels` placed in the pane's pixels (see the module docs): each at the
 * first of its spots (through `project`) where it fits inside its region
 * clear of the letters placed before it; a letter that must show, beside its
 * face when none is, clear of them if it can be; any other left out.
 *
 * In their order, but the letters that must show before the rest, and of
 * each, a face that shows before a hidden one, whose letter sits over
 * another face's paper: so a hidden face never takes the one spot of the
 * face on top there. The earliest come out on top, so they go last in the
 * answer, which is the order to draw them in.
 *
 * `frame`, the pane's box, keeps a letter set beside its face on screen: a
 * face along the pane's edge takes its letter on the side away from it.
 * `linePx` is how wide the line along a face's edge is drawn on screen (a
 * crease at its line width and zoom): a chip keeps clear of half of it as
 * well as of the ring ({@link LABEL_EDGE_ROOM_PX}). `lines`, every line the
 * pane draws, keeps a letter set beside its face off every crease, not only
 * its own face's, by half of `linesPx`, the widest of them: the first place
 * tried is clear of the lines and the other letters, within
 * {@link BESIDE_CLEAR_REACH_CHIPS} of the face. Only then come the fallbacks,
 * in their order from before there were lines: beside the face clear of the
 * other letters, over a line; inside the face over another letter; beside it
 * whatever it covers, a letter before a line.
 */
export function placeLabels(
  labels: readonly LayerPaneLabel[],
  spotsOf: (face: LayerFace) => LayerLabelSpots | null,
  textOf: (face: LayerFace) => string,
  project: (point: Point) => Point,
  { frame = null, linePx = 0, lines = null, linesPx = linePx }: LayerLabelPlacing = {}
): LayerPlacedLabel[] {
  const room = linePx / 2 + LABEL_EDGE_ROOM_PX;
  const clearance = lines ? lineClearance(lines, project) : null;
  const rank = ({ face, keep }: LayerPaneLabel) => (keep ? 0 : 2) + (spotsOf(face)?.visible === false ? 1 : 0);
  const ordered = labels
    .map((label, order) => ({ label, order, rank: rank(label) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ label }) => label);
  const placed: LayerPlacedLabel[] = [];
  const clear = (box: Box) =>
    placed.every(
      (other) =>
        Math.abs(other.x - box.x) > (other.width + box.width) / 2 + LABEL_GAP_PX ||
        Math.abs(other.y - box.y) > (other.height + box.height) / 2 + LABEL_GAP_PX
    );
  for (const { face, tone, keep } of ordered) {
    const spots = spotsOf(face);
    const text = textOf(face);
    if (!spots || text === '') continue;
    const under = !spots.visible;
    const size = labelSize(text, under, tone === 'danger');
    const box = (at: Point): Box => ({ x: at.x, y: at.y, ...size });
    const inside = spots.spots
      .map(({ at, region }) => ({ at: project(at), region: region.map(project) }))
      .filter(({ at, region }) => chipFits(at, size, region, room))
      .map(({ at }) => at);
    let at = inside.find((p) => clear(box(p))) ?? null;
    let off = false;
    if (!at && keep) {
      // Beside the face on screen, clear of the lines and the rest; else beside it clear of the rest, over a
      // line; else inside it over another letter; else beside it whatever it covers, a letter before a line.
      const outline = spots.outline.map(project);
      const from = spots.spots[0] ? project(spots.spots[0].at) : ringCentroid(outline);
      const shown = (p: Point) => !frame || chipInFrame(p, size, frame);
      const gaps = { face: linePx / 2, lines: linesPx / 2 };
      const around = from
        ? besideSpots(outline, from, size, gaps, clearance, (p) => shown(p) && clear(box(p)))
        : NO_BESIDE;
      const onScreen = (points: readonly Point[]) => points.filter(shown);
      const beside = around.wanted ?? onScreen(around.any).find((p) => clear(box(p)));
      at = beside ?? inside[0] ?? onScreen(around.clear)[0] ?? onScreen(around.any)[0] ?? around.any[0] ?? null;
      off = at !== null && (beside !== undefined || inside.length === 0);
    }
    if (!at) continue;
    placed.push({ face, text, tone, under, off, x: at.x, y: at.y, ...size });
  }
  return placed.reverse();
}
