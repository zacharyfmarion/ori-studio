/**
 * The Layer order dialog's figure as its two panes see it
 * (`implementation-plans/layer-order-dialog.md`, row U8; approach 3): where
 * each face lies on the crease pattern and on the folded paper, what is
 * stacked on each spot for the order on screen, how deep the stacks run, and
 * the frames each pane draws, hits and tints in.
 *
 * - **Faces** are the kernel's (`faceIndex.ts`). A face's ring on the crease
 *   pattern is its outline's points on the unfolded sheet
 *   (`scene.sheet_points`), the same from either side; its folded outline is
 *   the scene's, for the side that scene was drawn from.
 * - **Spots** are the scene's subfaces, numbered as it lists them, and the
 *   engine's stacks number them the same way, per side
 *   (`layerOrderEngine.ts`, `LayerStacks`). So a pane holds one scene per
 *   side and restacks it for whatever order is on screen, a preview's
 *   included, without asking the engine for a new one
 *   ({@link restackedScene}).
 * - **Frames.** The crease-pattern pane's frame is the crease pattern's own
 *   coordinates, drawn as Edit draws them (`cpModelToSvg`). The folded pane's
 *   is the kernel scene's, turned as the host turns its picture and then
 *   drawn at Edit's scale ({@link foldedPaneToUser}): one map for the paper,
 *   the tints, the rings, the letters and the hits, as `PaperPane` asks.
 * - **The turn** is the host's `look.turnDeg`, for the side its picture
 *   shows; seen from the other side, the paper turns the other way, as a
 *   Diagram step's does when it is turned over (`foldStepActions.ts`).
 *
 * Pure: no React, no store, no engine.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { turnClockwise, type Point } from '../../lib/geometry';
import { CP_PAPER_RECT, cpModelToSvg, ORIEDITA_PAPER_SIZE } from '../../lib/creasePatternViewport';
import type { LayerOrderRegion, LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import type { CpLineSegmentInput } from '../../cp-workspace/adapters/cpSnapshotToScene';
import { insideEvenOdd } from '../../cp-workspace/picking/polygonContains';
import type { UserBounds } from '../../cp-workspace/renderer/camera';
import type { LayerFace } from '../engine/faceIndex';
import type { LayerSide, LayerStacks } from '../engine/layerOrderEngine';

// ---------------------------------------------------------------------------
// Rings

/** Twice a ring's signed area. */
function twiceArea(ring: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice;
}

/** A ring's area, either winding. */
export function ringArea(ring: readonly Point[]): number {
  return Math.abs(twiceArea(ring)) / 2;
}

/** A ring's centroid; its points' mean when it has no area; null for no points. */
export function ringCentroid(ring: readonly Point[]): Point | null {
  if (ring.length === 0) return null;
  const twice = twiceArea(ring);
  if (Math.abs(twice) > 1e-12) {
    let x = 0;
    let y = 0;
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      const cross = p.x * q.y - q.x * p.y;
      x += (p.x + q.x) * cross;
      y += (p.y + q.y) * cross;
    });
    return { x: x / (3 * twice), y: y / (3 * twice) };
  }
  return {
    x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
    y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
  };
}

/** How many rows across a ring {@link ringInterior} tries, besides its centroid's. */
const INTERIOR_ROWS = 7;

/**
 * A point inside a ring, where a letter can sit on it: its centroid when that
 * is inside, as it always is for a convex ring; otherwise the middle of the
 * widest run across it along a row, the centroid's row first, then rows
 * spread over its height. A spot that bends round a window, or a frame, has
 * its centroid in the hole. Null for a ring with no inside.
 */
export function ringInterior(ring: readonly Point[]): Point | null {
  const centroid = ringCentroid(ring);
  if (!centroid || ring.length < 3) return centroid;
  if (insideEvenOdd(ring, centroid)) return centroid;
  const ys = ring.map(({ y }) => y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const rows = [centroid.y, ...Array.from({ length: INTERIOR_ROWS }, (_, k) => top + ((k + 1) / (INTERIOR_ROWS + 1)) * (bottom - top))];
  let best: { width: number; at: Point } | null = null;
  for (const y of rows) {
    const crossings: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > y !== b.y > y) crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    crossings.sort((l, r) => l - r);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const width = crossings[k + 1]! - crossings[k]!;
      if (!best || width > best.width) best = { width, at: { x: (crossings[k]! + crossings[k + 1]!) / 2, y } };
    }
    // The centroid's row, when it crosses the ring at all, is the one a reader expects.
    if (best && y === centroid.y) break;
  }
  return best?.at ?? centroid;
}

/** The box of every point of `rings` through `map`; null for none. */
export function ringsBounds(rings: Iterable<readonly Point[]>, map: (point: Point) => Point = (p) => p): UserBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      const { x, y } = map(point);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

// ---------------------------------------------------------------------------
// Faces on the crease pattern and on the paper

/** A figure's faces as the panes draw them, from one of its scenes. */
export interface LayerPaneFaces {
  /** Per face, its ring on the crease pattern; empty for a face the scene names no points of. */
  readonly pattern: readonly (readonly Point[])[];
  /** Per face, the centroid of its crease-pattern ring: what the label cap measures by. */
  readonly patternCentroids: readonly (Point | null)[];
}

const patternCache = new WeakMap<OristudioCpFoldedPaperScene, LayerPaneFaces>();

/** Each face's ring and centroid on the crease pattern, from either side's scene: the same for both. */
export function paneFacesOf(scene: OristudioCpFoldedPaperScene): LayerPaneFaces {
  const cached = patternCache.get(scene);
  if (cached) return cached;
  const pattern = scene.faces.map((face) =>
    face.points.flatMap((index) => {
      const point = scene.sheet_points[index];
      return point ? [{ x: point.x, y: point.y }] : [];
    })
  );
  const faces = { pattern, patternCentroids: pattern.map(ringCentroid) };
  patternCache.set(scene, faces);
  return faces;
}

/** Each face's folded outline, in the scene's coordinates, for the side it was drawn from. */
export function foldedOutlinesOf(scene: OristudioCpFoldedPaperScene): readonly (readonly Point[])[] {
  return scene.faces.map((face) => face.outline);
}

/** A straight piece of a line, in a pane's frame. */
export type LayerPaneSegment = readonly [Point, Point];

/**
 * The crease two faces meet at, as the sides they share: on the crease
 * pattern (`'pattern'`, the sheet's points) or on the folded paper
 * (`'folded'`, the scene's outlines, for its side). The two faces of a crease
 * name its ends alike (`OristudioCpFoldedPaperFace.points`), so a side is
 * shared when both faces' rings step between the same two points. Empty when
 * the faces share none, or the scene names no points.
 */
export function creaseSegments(
  scene: OristudioCpFoldedPaperScene,
  crease: readonly [LayerFace, LayerFace],
  frame: 'pattern' | 'folded'
): LayerPaneSegment[] {
  const [a, b] = crease;
  const first = scene.faces[a];
  const second = scene.faces[b];
  if (!first || !second || first.points.length < 2 || second.points.length < 2) return [];
  const sideKey = (p: number, q: number) => (p < q ? `${p},${q}` : `${q},${p}`);
  const theirs = new Set<string>();
  second.points.forEach((p, i) => theirs.add(sideKey(p, second.points[(i + 1) % second.points.length]!)));
  const segments: LayerPaneSegment[] = [];
  first.points.forEach((p, i) => {
    const j = (i + 1) % first.points.length;
    const q = first.points[j]!;
    if (p === q || !theirs.has(sideKey(p, q))) return;
    const from = frame === 'pattern' ? scene.sheet_points[p] : first.outline[i];
    const to = frame === 'pattern' ? scene.sheet_points[q] : first.outline[j];
    if (from && to) segments.push([{ x: from.x, y: from.y }, { x: to.x, y: to.y }]);
  });
  return segments;
}

// ---------------------------------------------------------------------------
// The order on screen

/** Spot `i`'s faces, top first. */
export function stackOf(stacks: LayerStacks, spot: number): number[] {
  return Array.from(stacks.faces.subarray(stacks.offsets[spot], stacks.offsets[spot + 1]));
}

const restackCache = new WeakMap<OristudioCpFoldedPaperScene, WeakMap<LayerStacks, OristudioCpFoldedPaperScene>>();

/**
 * `scene` with each spot's stack replaced by `stacks`' for it: the order on
 * screen, or a preview's, drawn on the scene the dialog opened with. Null
 * stacks, or stacks over other spots than the scene's, leave it as it is.
 */
export function restackedScene(
  scene: OristudioCpFoldedPaperScene,
  stacks: LayerStacks | null
): OristudioCpFoldedPaperScene {
  if (!stacks || stacks.offsets.length !== scene.subfaces.length + 1) return scene;
  let byStacks = restackCache.get(scene);
  if (!byStacks) {
    byStacks = new WeakMap();
    restackCache.set(scene, byStacks);
  }
  const cached = byStacks.get(stacks);
  if (cached) return cached;
  const restacked = {
    ...scene,
    subfaces: scene.subfaces.map((subface, spot) => ({ ...subface, faces_top_to_bottom: stackOf(stacks, spot) })),
  };
  byStacks.set(stacks, restacked);
  return restacked;
}

/** The most faces any spot holds: what X-ray's alpha is shared out over. 0 for none. */
export function stackDepth(scene: OristudioCpFoldedPaperScene): number {
  return scene.subfaces.reduce((deepest, subface) => Math.max(deepest, subface.faces_top_to_bottom.length), 0);
}

/** How much of the ground the deepest stack covers under X-ray. */
export const XRAY_COVER = 0.6;

/**
 * X-ray: every face's fill alpha, `1 − 0.4^(1/depth)`, so the deepest
 * stack's `depth` layers compose to {@link XRAY_COVER} and each layer of a
 * shallower one still shows through it. One layer draws at 0.6.
 */

export function xrayFaceAlpha(depth: number): number {
  return 1 - (1 - XRAY_COVER) ** (1 / Math.max(1, depth));
}

/** The face on top of each spot, per its stack: what the pane shows there and a click there takes. */
export function topFaces(scene: OristudioCpFoldedPaperScene): (LayerFace | null)[] {
  return scene.subfaces.map((subface) => subface.faces_top_to_bottom[0] ?? null);
}

/**
 * The lines the folded pane draws, in its frame: each edge of every face it
 * draws, and that face's aux lines. Without X-ray a face on top of no spot is
 * not drawn, nor are its lines (`foldedFlatPaperScene`'s `markHidden`); under
 * X-ray every face is. A face's whole outline counts, though a face drawn after
 * it may cover some of it. The paper draws its aux lines, and the flat edges
 * of an outline, in the aux pen (`foldedFlatScene`'s `roleOf`): with `aux`
 * false, the style leaves that pen out and draws neither.
 */
export function foldedPaneLines(scene: OristudioCpFoldedPaperScene, xray: boolean, aux: boolean): LayerPaneSegment[] {
  const drawn = xray ? null : new Set(topFaces(scene));
  const segments: LayerPaneSegment[] = [];
  scene.faces.forEach(({ outline, edges }, face) => {
    if (drawn && !drawn.has(face)) return;
    outline.forEach((from, i) => {
      if (!aux && edges[i]?.kind === 'flat') return;
      segments.push([from, outline[(i + 1) % outline.length]!]);
    });
  });
  if (!aux) return segments;
  for (const { from, to, face } of scene.aux_lines) if (!drawn || drawn.has(face)) segments.push([from, to]);
  return segments;
}

// ---------------------------------------------------------------------------
// Frames

/** Scene px per unit of a pane's frame: Edit's own, the crease pattern's paper rect over Oriedita's paper. */
export const PANE_USER_PER_UNIT = CP_PAPER_RECT.width / ORIEDITA_PAPER_SIZE;

/** The crease-pattern pane's frame → user space: Edit's own map, so a crease is where Edit draws it. */
export const patternPaneToUser = cpModelToSvg;

/**
 * The crease-pattern pane's lines, as Edit's document holds them, in
 * painter's order: the auxiliary lines under the creases, the paper's edge
 * over both, so a crease that ends on the edge never breaks the outline. The
 * aux lines are the region's when the host found one, its sheet's own; the
 * source's are the whole document's, every other pattern's included.
 */
export function patternPaneLines(source: LayerOrderSource, region: LayerOrderRegion | null = null): CpLineSegmentInput[] {
  const edge = source.segments.filter((segment) => segment.color === EDGE_COLOR);
  const creases = source.segments.filter((segment) => segment.color !== EDGE_COLOR);
  return [...(region?.auxSegments ?? source.auxSegments), ...creases, ...edge];
}

/** Edit's line colour of the paper's edge (Oriedita's `BLACK_0`). */
const EDGE_COLOR = 'Black0';

/**
 * What the crease-pattern pane fits, in user space: the paper of the region
 * the fold came from, that one pattern however many the document holds; with
 * none, the creases folded. Never the aux lines, whose document's may run
 * across every other pattern.
 */
export function patternPaneFrame(source: LayerOrderSource, region: LayerOrderRegion | null = null): UserBounds | null {
  const paper = region ? ringsBounds(region.paper, patternPaneToUser) : null;
  return paper ?? ringsBounds(source.segments.map(({ a, b }) => [a, b]), patternPaneToUser);
}

/**
 * What the folded pane fits, in user space: the folded figure itself, the
 * side's scene's outlines through the pane's map `toUser` (turned as the
 * host turns it), however small it folds from its sheet. X-ray draws the same
 * faces, buried ones under shown ones, so it frames the same.
 */
export function foldedPaneFrame(
  scene: OristudioCpFoldedPaperScene,
  toUser: (point: Point) => Point
): UserBounds | null {
  return ringsBounds(foldedOutlinesOf(scene), toUser);
}

/**
 * How far the folded pane turns the paper seen from `side`: the host's turn
 * for the side its picture shows, the other way round from the other side.
 */
export function paneTurnDeg(turnDeg: number, hostSide: LayerSide, side: LayerSide): number {
  const turn = ((turnDeg % 360) + 360) % 360;
  return side === hostSide ? turn : (360 - turn) % 360;
}

/**
 * The folded pane's frame → user space: turned clockwise by `turnDeg` about
 * `pivot` (the paper's middle), then placed at Edit's scale. Affine, as the
 * surface's camera requires.
 */
export function foldedPaneToUser(turnDeg: number, pivot: Point): (point: Point) => Point {
  const turn = turnClockwise(turnDeg);
  return (point) => {
    const turned = turn({ x: point.x - pivot.x, y: point.y - pivot.y });
    return cpModelToSvg({ x: turned.x + pivot.x, y: turned.y + pivot.y });
  };
}

/** The middle of a scene's folded paper: what the folded pane turns it about. */
export function foldedPivot(scene: OristudioCpFoldedPaperScene): Point {
  const bounds = ringsBounds(foldedOutlinesOf(scene));
  return bounds ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } : { x: 0, y: 0 };
}
