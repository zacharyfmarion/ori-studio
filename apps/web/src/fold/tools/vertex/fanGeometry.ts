/**
 * A fan fold's geometry on the folded form, from the clicks alone — the
 * rabbit ear's and the swivel's (`crates/oristudio-fold/src/compound/fan.rs`),
 * before the engine has described anything:
 *
 * - **The given rays** from where the creases meet, toward the points the
 *   clicks named (a rabbit ear's bisectors run to its corners).
 * - **The regions** between them. The click selects the hinge region;
 *   Kawasaki's theorem fixes its fourth ray. Region k runs counter-clockwise
 *   from ray k to ray k + 1.
 * - **The stayer** is an interior sheet witness in another region, on the
 *   farthest selected layer. The tool tries both possible anchor regions.
 * - **The given creases** each layer the fan cuts takes: from the center to
 *   where that layer ends along the ray, in the scene frame and on the sheet,
 *   with the letter each has from the sheet's front.
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../../lib/geometry';
import type { FoldDirection, FoldModelLine, SheetPoint } from '../../document/foldSequenceDocument';
import type { FoldLetter } from '../../engine/foldEngineWire';
import {
  alongLine,
  applyIsometry,
  chordOfConvex,
  clipConvex,
  insideConvex,
  invertIsometry,
  lineThrough,
  toPair,
  transformLine,
} from '../../canvas/foldCanvasGeometry';
import type { FoldPickIndex } from '../../canvas/foldPicking';

/** A fan as the clicks place it: where its creases meet, and its given rays, unit and counter-clockwise, in the scene frame. */
export interface FoldFanGiven {
  center: Point;
  rays: readonly Point[];
  /** Stop pending rabbit-ear rays at their picked triangle corners. */
  limits?: readonly number[];
}

/** How near two rays may point before they are one. */
const SAME_RAY = 1e-9;

const angleOf = ({ x, y }: Point): number => {
  const a = Math.atan2(y, x);
  return a < 0 ? a + 2 * Math.PI : a;
};

/** The counter-clockwise angle from `from` to `to`, in [0, 2π). */
const sector = (from: number, to: number): number => {
  const d = (to - from) % (2 * Math.PI);
  return d < 0 ? d + 2 * Math.PI : d;
};

/**
 * The fan from `center` toward each of `toward`, counter-clockwise; null when
 * a point is the center or two rays point the same way.
 */
export function fanToward(center: Point, toward: readonly Point[], stopAtPoints = false): FoldFanGiven | null {
  const rays: { angle: number; ray: Point; length: number }[] = [];
  for (const q of toward) {
    const dx = q.x - center.x;
    const dy = q.y - center.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-12)) return null;
    const ray = { x: dx / length, y: dy / length };
    rays.push({ angle: angleOf(ray), ray, length });
  }
  rays.sort((a, b) => a.angle - b.angle);
  const n = rays.length;
  if (n < 2) return null;
  for (let k = 0; k < n; k += 1) {
    if (sector(rays[k]!.angle, rays[(k + 1) % n]!.angle) <= SAME_RAY) return null;
  }
  return { center, rays: rays.map((each) => each.ray), ...(stopAtPoints ? { limits: rays.map(each => each.length) } : {}) };
}

/** The region a scene point lies in; null at the center itself. */
export function fanRegionAt(fan: FoldFanGiven, p: Point): number | null {
  const v = { x: p.x - fan.center.x, y: p.y - fan.center.y };
  if (!(Math.hypot(v.x, v.y) > 1e-12)) return null;
  const a = angleOf(v);
  const n = fan.rays.length;
  for (let k = 0; k < n; k += 1) {
    const from = angleOf(fan.rays[k]!);
    if (sector(from, a) < sector(from, angleOf(fan.rays[(k + 1) % n]!))) return k;
  }
  return 0;
}

/** The unique Kawasaki fourth ray inside region k; null if that region cannot close flat. */
export function fanHingeRay(fan: FoldFanGiven, k: number): Point | null {
  if (fan.rays.length !== 3) return null;
  const angles = fan.rays.map(angleOf);
  const lo = angles[k]!;
  const hi = k < 2 ? angles[k + 1]! : angles[0]! + 2 * Math.PI;
  const sign = (slot: number) => slot % 2 === 0 ? -1 : 1;
  const others = angles.reduce((sum, angle, i) => sum + sign(i <= k ? i : i + 1) * angle, 0);
  const angle = (Math.PI - others) / sign(k + 1);
  return angle > lo + SAME_RAY && angle < hi - SAME_RAY ? { x: Math.cos(angle), y: Math.sin(angle) } : null;
}

/** The direction halfway round region `k`, unit, in the scene frame. */
export function fanRegionMiddle(fan: FoldFanGiven, k: number): Point {
  const n = fan.rays.length;
  const from = angleOf(fan.rays[k % n]!);
  const half = sector(from, angleOf(fan.rays[(k + 1) % n]!)) / 2;
  return { x: Math.cos(from + half), y: Math.sin(from + half) };
}

/**
 * Region `k` as convex wedges, each the pair of half-planes it keeps (lines
 * whose positive side is kept, `clipConvex`): one wedge under a half turn,
 * two halves of one wider — a swivel's rays may leave a region wider.
 */
export function fanRegionWedges(fan: FoldFanGiven, k: number): FoldModelLine[][] {
  const n = fan.rays.length;
  const start = fan.rays[k % n]!;
  const end = fan.rays[(k + 1) % n]!;
  const { center } = fan;
  const wedge = (from: Point, to: Point): FoldModelLine[] => {
    const left = lineThrough(center, { x: center.x + from.x, y: center.y + from.y });
    const right = lineThrough(center, { x: center.x + to.x, y: center.y + to.y });
    // `lineThrough`'s normal points left of its direction: keep left of `from`, right of `to`.
    return left && right ? [left, { n: [-right.n[0], -right.n[1]], d: -right.d }] : [];
  };
  if (sector(angleOf(start), angleOf(end)) < Math.PI - 1e-9) return [wedge(start, end)];
  const middle = fanRegionMiddle(fan, k);
  return [wedge(start, middle), wedge(middle, end)];
}

/** The parts of a convex polygon inside a region's wedges (`fanRegionWedges`), the empty ones dropped. */
export function clipToWedges(polygon: readonly Point[], wedges: readonly (readonly FoldModelLine[])[]): Point[][] {
  const parts: Point[][] = [];
  for (const lines of wedges) {
    let piece: Point[] = [...polygon];
    for (const line of lines) {
      piece = clipConvex(piece, line, 1);
      if (piece.length < 3) break;
    }
    if (piece.length >= 3) parts.push(piece);
  }
  return parts;
}

/** The ray from the center along `direction`, as a line whose parameter grows that way, and the center's parameter on it. */
function rayLine(center: Point, direction: Point): { line: FoldModelLine; from: number } | null {
  const line = lineThrough(center, { x: center.x + direction.x, y: center.y + direction.y });
  return line ? { line, from: alongLine(line, center) } : null;
}

/** How far from the center a ray runs inside a convex polygon holding the center; 0 when it does not. */
function reachIn(polygon: readonly Point[], ray: { line: FoldModelLine; from: number }): number {
  const chord = chordOfConvex(polygon, ray.line);
  if (!chord || chord[0] > ray.from + 1e-9 || chord[1] < ray.from - 1e-9) return 0;
  return Math.max(0, chord[1] - ray.from);
}

/**
 * The cell of the folded form around the center on the side of `direction`:
 * where a point just off the center that way lies. Null off the paper.
 */
function cellToward(index: FoldPickIndex, center: Point, direction: Point) {
  const probe = { x: center.x + direction.x * 1e-7, y: center.y + direction.y * 1e-7 };
  return index.subfaces.find((cell) => insideConvex(cell.polygon, probe, 1e-12)) ?? null;
}

/**
 * The layers a fan cuts, at the center on the side of `direction`, top
 * first in the stack: every layer, or the first `layers` from the side the
 * direction names. Empty off the paper.
 */
function cutLayers(stack: readonly number[], direction: FoldDirection, layers: number | null): number[] {
  const count = layers === null ? stack.length : Math.min(stack.length, Math.max(1, layers));
  return direction === 'valley' ? stack.slice(0, count) : stack.slice(stack.length - count);
}

/**
 * The sheet point that names region `k` as the paper that stays (see the
 * module docs): halfway from the center to the edge of the cell around it,
 * along the region's middle, on the farthest layer the fan cuts from the
 * direction's side. Null off the paper.
 */
export function fanStayer(
  index: FoldPickIndex,
  fan: FoldFanGiven,
  k: number,
  direction: FoldDirection,
  layers: number | null
): SheetPoint | null {
  const middle = fanRegionMiddle(fan, k);
  // A bisector may itself be a precrease. Keep the witness strictly inside
  // a subface while retaining the chosen angular region and paper layer.
  for (const offset of [0, 0.07, -0.07, 0.17, -0.17]) {
    const a = angleOf(middle) + offset;
    const toward = { x: Math.cos(a), y: Math.sin(a) };
    if (fanRegionAt(fan, { x: fan.center.x + toward.x, y: fan.center.y + toward.y }) !== k) continue;
    const cell = cellToward(index, fan.center, toward);
    const ray = rayLine(fan.center, toward);
    if (!cell || !ray) continue;
    const reach = reachIn(cell.polygon, ray);
    if (!(reach > 0)) continue;
    const at = { x: fan.center.x + toward.x * reach / 2, y: fan.center.y + toward.y * reach / 2 };
    if (!strictlyInside(cell.polygon, at)) continue;
    const cut = cutLayers(cell.stack, direction, layers);
    const far = direction === 'valley' ? cut[cut.length - 1] : cut[0];
    const transform = far === undefined ? undefined : index.scene.face_transforms[far];
    if (transform) return toPair(applyIsometry(invertIsometry(transform), at));
  }
  return null;
}

/** An interior point may name material; a point on a subdivision cannot. */
function strictlyInside(polygon: readonly Point[], p: Point): boolean {
  return insideConvex(polygon, p) && polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) > 1e-9 * Math.hypot(b.x - a.x, b.y - a.y);
  });
}

/** Read the stack beside a precrease junction using an interior witness. */
export function fanLayerProbe(index: FoldPickIndex, center: Point): Point {
  const points = [center, ...Array.from({ length: 24 }, (_, k) => ({ x: center.x + 8e-6 * Math.cos(0.137 + k * 2.399963229728653), y: center.y + 8e-6 * Math.sin(0.137 + k * 2.399963229728653) }))];
  return points.find(p => index.subfaces.some(cell => strictlyInside(cell.polygon, p))) ?? center;
}

/** One given crease on one layer: where it runs on the folded pane and on the sheet, and its letter from the front. */
export interface FoldFanCreasePiece {
  /** Which given ray, by index into the fan's. */
  ray: number;
  scene: readonly [Point, Point];
  sheet: readonly [Point, Point];
  letter: FoldLetter;
}

/** The other letter. */
const otherLetter = (letter: FoldLetter): FoldLetter => (letter === 'valley' ? 'mountain' : 'valley');

/**
 * The given creases the fan makes: on every layer it cuts at the center, each
 * ray from the center to where that layer ends along it — the bisectors a
 * rabbit ear's corners are clicked for, before the engine is asked. Each
 * folds the way the direction says as the viewer sees it, so from the sheet's
 * front a layer seen from its back has the other letter.
 */
export function fanGivenCreases(
  index: FoldPickIndex,
  fan: FoldFanGiven,
  direction: FoldDirection,
  layers: number | null
): FoldFanCreasePiece[] {
  const { scene } = index;
  const pieces: FoldFanCreasePiece[] = [];
  for (const [k, toward] of fan.rays.entries()) {
    const ray = rayLine(fan.center, toward);
    const cell = cellToward(index, fan.center, toward);
    if (!ray || !cell) continue;
    for (const face of cutLayers(cell.stack, direction, layers)) {
      const image = scene.faces[face]?.outline;
      const transform = scene.face_transforms[face];
      if (!image || !transform) continue;
      let reach = reachIn(image, ray);
      if (fan.limits) {
        // Flat precreases subdivide one layer into several faces. Walk their
        // contiguous ray intervals with the same sheet-to-scene transform.
        const intervals = scene.faces.flatMap((piece, f) => {
          if (!scene.face_transforms[f]?.every((value, i) => Math.abs(value - transform[i]!) < 1e-9)) return [];
          const chord = chordOfConvex(piece.outline, ray.line);
          return chord ? [[chord[0] - ray.from, chord[1] - ray.from] as const] : [];
        }).sort((a, b) => a[0] - b[0]);
        for (const [lo, hi] of intervals) {
          if (lo <= reach + 1e-9 && hi > reach) reach = hi;
        }
        reach = Math.min(reach, fan.limits[k]!);
      }
      if (!(reach > 1e-9)) continue;
      const end = { x: fan.center.x + toward.x * reach, y: fan.center.y + toward.y * reach };
      const back = invertIsometry(transform);
      const [a, b, , d, e] = transform;
      const seenFront = a * e - b * d > 0;
      pieces.push({
        ray: k,
        scene: [fan.center, end],
        sheet: [applyIsometry(back, fan.center), applyIsometry(back, end)],
        letter: seenFront ? direction : otherLetter(direction),
      });
    }
  }
  return pieces;
}

/**
 * The given creases as the folded pane shows them: per ray, from the center
 * as far as any layer it cuts reaches — the layers lie over one another there.
 */
export function fanGivenOnFolded(pieces: readonly FoldFanCreasePiece[]): (readonly [Point, Point])[] {
  const longest = new Map<number, readonly [Point, Point]>();
  const length = ([a, b]: readonly [Point, Point]) => Math.hypot(b.x - a.x, b.y - a.y);
  for (const piece of pieces) {
    const kept = longest.get(piece.ray);
    if (!kept || length(piece.scene) > length(kept)) longest.set(piece.ray, piece.scene);
  }
  return [...longest.values()];
}

/** Region `k` on the sheet: each face's part of it, through the face's transform. */
export function fanRegionOnSheet(index: FoldPickIndex, fan: FoldFanGiven, k: number): Point[][] {
  const { scene } = index;
  const wedges = fanRegionWedges(fan, k);
  const parts: Point[][] = [];
  scene.faces.forEach((face, f) => {
    const transform = scene.face_transforms[f];
    const outline = face.points.map((vertex) => scene.sheet_points[vertex]);
    if (!transform || outline.some((corner) => corner === undefined)) return;
    const back = invertIsometry(transform);
    const local = wedges.map((lines) => lines.map((line) => transformLine(back, line)));
    parts.push(...clipToWedges(outline as Point[], local));
  });
  return parts;
}

/** Region `k` on the folded pane: each cell of the folded form's part of it. */
export function fanRegionOnFolded(index: FoldPickIndex, fan: FoldFanGiven, k: number): Point[][] {
  const wedges = fanRegionWedges(fan, k);
  return index.subfaces.flatMap((cell) => clipToWedges(cell.polygon, wedges));
}
