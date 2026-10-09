/**
 * An x-ray's inside (Revision 3, `implementation-plans/diagram-revision-3.md`,
 * "5. X-ray" and "18.0 results"): a flat fold's picture without the layers
 * its window peels away, as a scene a surface paints inside the window.
 *
 * What it takes away (R3-34 A, `implementation-plans/diagram-xray-peel.md`,
 * which replaced R3-13 A after Zach's report on #447): the window is peeled,
 * read inside it alone. Each step of its depth takes away one face on top in
 * the window — nothing left over it there, something left under it there —
 * the window's whole top layer before anything under it, and in each layer
 * the face nearest its Point first, its centre unless picked (R3-35 A). A
 * face whose part in the window is a sliver goes with the next step (R3-36
 * A). The bottom layer never goes, so a depth past the steps draws at the
 * deepest. Read as 18.0 found it must be:
 *
 * 1. **Stacked on the paper.** Which faces lie over which is read on the
 *    faces' unspread places (`paperFaces`) and their levels, never on the
 *    drawn ones, where a spread pushes flaps into one another. Where in the
 *    window one lies over another is read on the drawn picture, which the
 *    window clips.
 * 2. **"Over" with a tolerance** (`faceOverlap.ts`, `overlapsWider`): two
 *    faces meeting along a fold, their stored corners crossing by a hair, are
 *    not over one another.
 * 3. **The stored order.** What is left is drawn in the stored scene's own
 *    paint order — its whole face items, those with no `group` — and a face
 *    it dropped (a picture with no spread keeps only the faces that show) by
 *    its level among them.
 * 4. **The stored places.** With a spread every face is in the stored scene
 *    whole, and drawn from it; with none, a dropped face is drawn on its
 *    unspread ring, which is where the picture has it.
 *
 * Each face is filled in its side's colour and outlined in the edges' pen,
 * with no creases (R3-16b A). A face the stored scene draws keeps its own item
 * — side, shade and outline — so a window that takes nothing away is the
 * picture itself. A face it dropped is given its side by the turn of its ring:
 * a face's ring turns one way on the paper and the same way on the picture
 * when it shows the paper's front, the other way when it shows its back, as
 * the faces the stored scene names show (R3-16a A, amended after 18.0, which
 * found it agrees with the kernel on all 834 faces of Zach's four diagrams).
 *
 * The page's white inside a window, where every layer at a point lies over
 * the ones taken away, is what R3-13 A draws, not a gap.
 *
 * One function draws a window for every surface (`xrayWindowMarkup`): the
 * canvas, the cards, the pages and the files, each through `xrayPaint.ts`
 * with its own placement (18f).
 *
 * Pure but for one memo per picture's faces.
 */
import type { PaperFaceItem, PaperScene, PaperSide, ScenePoint } from '../../lib/paper/paperScene';
import { paperSceneSvgBody } from '../../lib/paper/paperSvg';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { PicturePoint } from '../annotate/annotationModel';
import { convexPieces, OVER_MIN_WIDTH, overlapsWider, piecesPart, piecesShared, piecesWithin } from '../annotate/faceOverlap';
import type { PictureCover, PictureLayers } from '../annotate/pictureGeometry';
import type { DiagramStep } from '../document/diagramDocument';
import { sceneCulledTo, type PictureBox } from '../pictures/paintDiagramStep';
import { storedScene } from '../pictures/pictureFrame';
import { faceAt, facePlacement, faceSpreadMove, paperFacesOf, ringArea, type StepFaces } from '../zoom/zoomImprint';

type Pt = PicturePoint;
type Box = readonly [number, number, number, number];

/** A face's cover, in picture units, its order its level reversed: on the unspread picture, or as drawn. */
export type XRayCover = PictureCover & { face: number };

/** A face as drawn (18g): its cover, and its ring as convex pieces, what a window is clipped against. */
export type XRayDrawn = XRayCover & { pieces: readonly (readonly Pt[])[] };

/**
 * Two faces stacked on the paper (18g): their unspread rings share a part
 * wider than "over"'s tolerance, at different levels. With the part their
 * drawn rings share, as convex pieces in picture units, and its box: where a
 * window sees the one over the other.
 */
export interface XRayStacked {
  /** The face on top: the lower level. */
  upper: number;
  lower: number;
  shared: readonly (readonly Pt[])[];
  box: Box;
}

/** A step's faces as an x-ray reads them: worked out once per picture. */
export interface XRayFaces {
  /** Anchoring's view of the faces: on the paper, unspread, as drawn (`zoomImprint.ts`). */
  faces: StepFaces;
  /** The stored scene's bounds and sheet: the inside's frame and erode. */
  frame: Pick<PaperScene, 'bounds' | 'sheet'>;
  /** Per face, the item its inside paints for it; null for a face the kernel could not name, which has no ring. */
  items: readonly (PaperFaceItem | null)[];
  /** Every face with a ring, back to front: the stored order, a face it dropped placed among them by level. */
  paint: readonly number[];
  /** The faces on the unspread picture, in picture units: where they are stacked. */
  layers: Omit<PictureLayers, 'covers'> & { covers: readonly XRayCover[] };
  /** Per face, its ring as its item paints it, in picture units — what a window clips; null for a face with no ring. */
  drawn: readonly (XRayDrawn | null)[];
}

const memo = new WeakMap<StepFaces, XRayFaces | null>();

/**
 * A step's faces as an x-ray reads them, or null for a picture with no
 * layers to x-ray: anything but a flat fold whose faces on the paper are kept
 * (`paperFacesOf`) — a crease pattern, 3D, simulated, an upload, a see-through
 * development, References, a flat capture made before faces were kept.
 */
export function xrayFacesOf(step: DiagramStep): XRayFaces | null {
  const faces = paperFacesOf(step);
  if (!faces || faces.kind !== 'flat' || step.picture?.kind !== 'scene') return null;
  if (memo.has(faces)) return memo.get(faces)!;
  const scene = storedScene(step.picture);
  const read = scene ? readXRayFaces(faces, scene) : null;
  memo.set(faces, read);
  return read;
}

/** {@link xrayFacesOf} from a step's faces and its stored scene. */
export function readXRayFaces(faces: StepFaces, scene: PaperScene): XRayFaces | null {
  const count = faces.unspread.length;
  if (count === 0) return null;
  const { minX, minY, maxX, maxY } = scene.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  if (!(unit > 0)) return null;
  const toPicture = ([x, y]: Pt): Pt => [(x - minX) / unit, (y - minY) / unit];
  // The stored scene's whole face items, by face, in its order.
  const stored = new Map<number, PaperFaceItem>();
  const order: number[] = [];
  for (const item of scene.items) {
    if (item.kind !== 'face' || item.group !== undefined || stored.has(item.face) || item.face >= count) continue;
    stored.set(item.face, item);
    order.push(item.face);
  }
  const coverIn = (face: number, ring: readonly Pt[]): XRayCover => {
    const points = ring.map(toPicture);
    return { face, ring: points, order: -faces.levels[face]!, box: boxOf(points) };
  };
  const covers: XRayCover[] = [];
  faces.unspread.forEach((ring, face) => {
    if (ring.length >= 3) covers.push(coverIn(face, ring));
  });
  const coverOf = new Map(covers.map((cover) => [cover.face, cover]));
  const sides = facesSides(faces, stored);
  const items = faces.unspread.map((ring, face): PaperFaceItem | null => {
    const own = stored.get(face);
    if (own) {
      const { group: _group, ...item } = own;
      return { ...item, hidden: false };
    }
    if (ring.length < 3) return null;
    const drawn = faces.drawn[face];
    const at = drawn && drawn.length === ring.length ? drawn : ring;
    return { kind: 'face', face, side: sides[face] ?? 'front', rings: [at.map(([x, y]): ScenePoint => [x, y])], outline: 'edge', shade: 1, hidden: false };
  });
  // Each face where its item paints it — spread, where the picture is — by its item's largest ring.
  const drawn = faces.unspread.map((ring, face): XRayDrawn | null => {
    const item = items[face];
    if (!item || ring.length < 3) return null;
    const own = item.rings.filter((each) => each.length >= 3) as Pt[][];
    const largest = own.reduce<Pt[] | null>((best, each) => (!best || Math.abs(ringArea(each)) > Math.abs(ringArea(best)) ? each : best), null);
    const cover = coverIn(face, largest ?? ring);
    return { ...cover, pieces: convexPieces(cover.ring) };
  });
  return {
    faces,
    frame: { bounds: scene.bounds, sheet: scene.sheet },
    items,
    paint: paintOrder(order, covers, coverOf, faces.levels),
    layers: { orders: [], covers },
    drawn,
  };
}

function boxOf(ring: readonly Pt[]): Box {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const boxesMeet = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

const stackedMemo = new WeakMap<XRayFaces, readonly XRayStacked[]>();

/**
 * Every two faces stacked on the paper, the upper first (18g): sharing a part
 * wider than "over"'s tolerance on the unspread picture, at different levels
 * — a woven pair, at one level, is neither's — with the part they share as
 * drawn. A pair whose drawn rings share nothing, a spread having drawn them
 * apart, never lies one over the other in a window, and is left out. Worked
 * out once per picture, when a window first peels it.
 */
export function xrayStacked(xray: XRayFaces): readonly XRayStacked[] {
  const known = stackedMemo.get(xray);
  if (known) return known;
  const { covers } = xray.layers;
  const levels = xray.faces.levels;
  const unspread = new Map(covers.map((cover) => [cover.face, convexPieces(cover.ring)]));
  const pairs: XRayStacked[] = [];
  for (let i = 0; i < covers.length; i += 1) {
    for (let j = i + 1; j < covers.length; j += 1) {
      const [a, b] = [covers[i]!, covers[j]!];
      if (levels[a.face] === levels[b.face] || !boxesMeet(a.box, b.box)) continue;
      // "Over"'s test (`overlapsWider`), on pieces cut once.
      if (piecesPart(piecesShared(unspread.get(a.face)!, unspread.get(b.face)!)).width <= OVER_MIN_WIDTH) continue;
      const [upper, lower] = levels[a.face]! < levels[b.face]! ? [a.face, b.face] : [b.face, a.face];
      const [over, under] = [xray.drawn[upper], xray.drawn[lower]];
      if (!over || !under || !boxesMeet(over.box, under.box)) continue;
      const shared = piecesShared(over.pieces, under.pieces);
      if (shared.length > 0) pairs.push({ upper, lower, shared, box: boxOf(shared.flat()) });
    }
  }
  stackedMemo.set(xray, pairs);
  return pairs;
}

/**
 * Each face's side: the stored scene's own word for every face it draws; for
 * one it dropped, by whether its ring turns the same way on the paper and on
 * the picture, calibrated on a face the scene names (R3-16a A, amended). Null
 * for a face with no ring.
 */
function facesSides(faces: StepFaces, stored: ReadonlyMap<number, PaperFaceItem>): (PaperSide | null)[] {
  const turn = (face: number): number => {
    const [paper, picture] = [faces.paper[face], faces.unspread[face]];
    if (!paper || !picture || paper.length < 3 || paper.length !== picture.length) return 0;
    return Math.sign(ringArea(paper) * ringArea(picture));
  };
  let reference: { turn: number; front: boolean } | null = null;
  for (const [face, item] of stored) {
    const sign = turn(face);
    if (sign !== 0) {
      reference = { turn: sign, front: item.side === 'front' };
      break;
    }
  }
  return faces.unspread.map((ring, face) => {
    const own = stored.get(face);
    if (own) return own.side;
    if (ring.length < 3) return null;
    const sign = turn(face);
    if (!reference || sign === 0) return 'front';
    return (sign === reference.turn) === reference.front ? 'front' : 'back';
  });
}

/**
 * Every face with a ring, back to front (18.0 results, 3): the stored
 * scene's order for the faces it draws, and each face it dropped painted
 * after every face it lies over and before every face over it — "over" a
 * lower level and a part shared wider than the tolerance, as a window reads
 * it. A stored face keeps the stored order against the stored faces it
 * overlaps, and only those: chained to faces it never meets, it could knot
 * with a dropped face between them (review of 18e). Ordered as a topological
 * sort that takes, whenever it can, a dropped face first (backmost first),
 * else the stored scene's earliest face free to come; a knot no order
 * satisfies (a woven patch) is cut at its backmost face.
 */
function paintOrder(
  stored: readonly number[],
  covers: readonly XRayCover[],
  coverOf: ReadonlyMap<number, XRayCover>,
  levels: readonly number[]
): number[] {
  const chain = stored.filter((face) => coverOf.has(face));
  const placed = new Set(chain);
  const dropped = covers.filter((cover) => !placed.has(cover.face)).map((cover) => cover.face);
  if (dropped.length === 0) return chain;
  // What must be painted before each face: the stored faces before it that it overlaps, and with a dropped face, the
  // faces under it.
  const before = new Map<number, Set<number>>(covers.map((cover) => [cover.face, new Set<number>()]));
  chain.forEach((face, index) => {
    const cover = coverOf.get(face)!;
    for (const earlier of chain.slice(0, index)) {
      if (overlapsWider(cover, coverOf.get(earlier)!)) before.get(face)!.add(earlier);
    }
  });
  for (const face of dropped) {
    const cover = coverOf.get(face)!;
    for (const other of covers) {
      if (other.face === face || levels[other.face] === levels[face] || !overlapsWider(cover, other)) continue;
      // The one with the greater level lies under the other, and is painted first.
      const [under, over] = levels[other.face]! > levels[face]! ? [other.face, face] : [face, other.face];
      before.get(over)!.add(under);
    }
  }
  const backmostFirst = (a: number, b: number) => levels[b]! - levels[a]! || a - b;
  const waiting = [...dropped].sort(backmostFirst);
  const pending = [...chain];
  const order: number[] = [];
  const done = new Set<number>();
  const ready = (face: number) => [...before.get(face)!].every((each) => done.has(each));
  const take = (from: number[], at: number) => {
    const [face] = from.splice(at, 1);
    order.push(face!);
    done.add(face!);
  };
  while (waiting.length > 0 || pending.length > 0) {
    const free = waiting.findIndex(ready);
    if (free >= 0) {
      take(waiting, free);
      continue;
    }
    const next = pending.findIndex(ready);
    if (next >= 0) {
      take(pending, next);
      continue;
    }
    // A knot: the backmost of the faces left goes first.
    const [cut] = [...waiting, ...pending].sort(backmostFirst);
    const at = waiting.indexOf(cut!);
    if (at >= 0) take(waiting, at);
    else take(pending, pending.indexOf(cut!));
  }
  return order;
}

/** A point in the stored scene's px, in picture units. */
function toPicture(xray: XRayFaces, [x, y]: Pt): Pt {
  const { minX, minY, maxX, maxY } = xray.frame.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  return [(x - minX) / unit, (y - minY) / unit];
}

/**
 * Where an x-ray's picked `anchor` (a point on the paper) is drawn, in picture
 * units: placed through the face that holds it, and moved as the picture's
 * spread moves that face — what the canvas marks while the x-ray is selected
 * (review of 18e). Null on none of the step's faces.
 */
export function xrayAnchorDrawn(xray: XRayFaces, anchor: readonly [number, number]): Pt | null {
  const { faces } = xray;
  const face = faceAt(faces, [anchor[0], anchor[1]]);
  const placement = face === null ? null : facePlacement(faces, face);
  if (face === null || !placement) return null;
  return toPicture(xray, faceSpreadMove(faces, face, placement.apply([anchor[0], anchor[1]])));
}

/**
 * Where a window's peel starts (R3-35 A), as drawn, in picture units: its
 * picked `anchor` where the picture draws it, or — unsaid, or on none of the
 * step's faces — its window's `centre`. In each layer the face nearest it
 * goes first.
 */
export function xrayPeelPoint(xray: XRayFaces, centre: Pt, anchor?: readonly [number, number]): Pt {
  return (anchor && xrayAnchorDrawn(xray, anchor)) || centre;
}

/** A window as it is peeled: its centre and radius, in picture units, as drawn. */
export interface XRayWindow {
  centre: Pt;
  radius: number;
}

/**
 * Below this share of its window's radius, a face's part in the window — its
 * mean width there — is a sliver (R3-36 A), which gets no step of its own: a
 * step that took it alone would change nothing to see.
 */
export const XRAY_SLIVER = 0.02;

/** The sides of the ring a window's circle is clipped by: within a tenth of a percent of its radius. */
const DISC_SIDES = 64;

/** One x-ray window's steps, kept for the last few windows of each picture: a drag asks for each frame's once. */
const peels = new WeakMap<XRayFaces, Map<string, readonly (readonly number[])[]>>();
const PEELS_KEPT = 32;

/**
 * A window's steps (R3-34 A), in the order its depth takes them, each the
 * faces one step takes away — read inside the window alone:
 *
 * - **In the window**, a face whose drawn ring the window reaches into by
 *   more than "over"'s tolerance.
 * - **Over, in the window**, two faces stacked on the paper
 *   ({@link XRayStacked}) whose drawn rings' shared part the window reaches
 *   into by more than the tolerance: two faces stacked only outside it do not
 *   hold each other up inside it.
 * - **Layer by layer.** A layer is every face left with nothing left over it
 *   in the window and something left under it there; the next is read once it
 *   is gone. A face with nothing under it in the window is the bottom there,
 *   and is never taken away.
 * - **A face a step**, in each layer the face nearest `point` first (its part
 *   in the window holding it, nearest of all), then the higher, then by its
 *   number. A sliver (R3-36 A) goes with the next step of its layer, or the
 *   one before where it is the layer's last.
 *
 * By level, "over" cannot go round in a ring, so a window always peels to
 * its bottom. A woven pair, at one level, is neither over the other, and both
 * can go in one layer — 15e's caveat.
 */
export function xrayPeel(xray: XRayFaces, window: XRayWindow, point: Pt): readonly (readonly number[])[] {
  const { centre, radius } = window;
  if (!(radius > 0)) return [];
  const key = `${centre[0]},${centre[1]},${radius},${point[0]},${point[1]}`;
  let kept = peels.get(xray);
  const known = kept?.get(key);
  if (known) return known;
  const steps = peelOf(xray, centre, radius, point);
  if (!kept) peels.set(xray, (kept = new Map()));
  if (kept.size >= PEELS_KEPT) kept.delete(kept.keys().next().value!);
  kept.set(key, steps);
  return steps;
}

function peelOf(xray: XRayFaces, centre: Pt, radius: number, point: Pt): number[][] {
  const disc = Array.from({ length: DISC_SIDES }, (_, i): Pt => {
    const angle = (2 * Math.PI * i) / DISC_SIDES;
    return [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)];
  });
  const reach: Box = [centre[0] - radius, centre[1] - radius, centre[0] + radius, centre[1] + radius];
  // Reaching into a part by more than the tolerance: its nearest point that far inside the circle.
  const reachesInto = (pieces: readonly (readonly Pt[])[]) => distanceTo(pieces, centre) < radius - OVER_MIN_WIDTH;
  const levels = xray.faces.levels;
  // Each face in the window, by its part there.
  const parts = new Map<number, { pieces: Pt[][]; width: number }>();
  for (const cover of xray.drawn) {
    if (!cover || !boxesMeet(cover.box, reach) || !reachesInto(cover.pieces)) continue;
    const pieces = piecesWithin(cover.pieces, disc);
    parts.set(cover.face, { pieces, width: piecesPart(pieces).width });
  }
  // Which lie over which inside it.
  const over = new Map<number, number[]>();
  const under = new Map<number, number[]>();
  for (const { upper, lower, shared, box } of xrayStacked(xray)) {
    if (!parts.has(upper) || !parts.has(lower) || !boxesMeet(box, reach) || !reachesInto(shared)) continue;
    over.set(lower, [...(over.get(lower) ?? []), upper]);
    under.set(upper, [...(under.get(upper) ?? []), lower]);
  }
  const taken = new Set<number>();
  const steps: number[][] = [];
  for (;;) {
    const layer = [...parts.keys()].filter(
      (face) =>
        !taken.has(face) &&
        (over.get(face) ?? []).every((each) => taken.has(each)) &&
        (under.get(face) ?? []).some((each) => !taken.has(each))
    );
    if (layer.length === 0) break;
    const nearness = new Map(layer.map((face) => [face, distanceTo(parts.get(face)!.pieces, point)]));
    layer.sort((a, b) => nearness.get(a)! - nearness.get(b)! || levels[a]! - levels[b]! || a - b);
    let carried: number[] = [];
    const first = steps.length;
    for (const face of layer) {
      carried.push(face);
      if (parts.get(face)!.width >= XRAY_SLIVER * radius) {
        steps.push(carried);
        carried = [];
      }
    }
    if (carried.length > 0) {
      if (steps.length > first) steps[steps.length - 1]!.push(...carried);
      else steps.push(carried);
    }
    for (const face of layer) taken.add(face);
  }
  return steps;
}

/** How far `point` is from convex pieces: none inside one, else the nearest of their sides. */
function distanceTo(pieces: readonly (readonly Pt[])[], [x, y]: Pt): number {
  let nearest = Infinity;
  for (const piece of pieces) {
    let sign = 0;
    let inside = true;
    for (let i = 0; i < piece.length; i += 1) {
      const [ax, ay] = piece[i]!;
      const [bx, by] = piece[(i + 1) % piece.length]!;
      const turn = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
      if (turn !== 0 && sign !== 0 && turn !== sign) inside = false;
      if (turn !== 0) sign = turn;
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
      nearest = Math.min(nearest, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
    }
    if (inside) return 0;
  }
  return nearest;
}

/** What a window takes away (R3-34 A). */
export interface XRayRemoval {
  /** How many steps its window has: the most its depth can take. */
  steps: number;
  /** How many of them it takes: its depth, or all of them where that is fewer. */
  deep: number;
  /** The faces those steps take away. */
  removed: ReadonlySet<number>;
}

/**
 * What an x-ray `depth` deep takes away of a window's `steps`
 * ({@link xrayPeel}): the first `depth` — all of them where it asks for more,
 * which draws at the deepest, the bottom layer left.
 */
export function xrayRemoval(steps: readonly (readonly number[])[], depth: number): XRayRemoval {
  const deep = Math.max(0, Math.min(Math.floor(depth), steps.length));
  return { steps: steps.length, deep, removed: new Set(steps.slice(0, deep).flat()) };
}

/**
 * The window's inside as a scene: every face not `removed`, back to front
 * ({@link XRayFaces.paint}), in the stored scene's frame — only those that
 * reach into `cull`, a box in picture units, when given: a window shows a
 * small part of the picture.
 */
export function xrayInsideScene(xray: XRayFaces, removed: ReadonlySet<number>, cull: PictureBox | null = null): PaperScene {
  return facesScene(xray, (face) => !removed.has(face), cull);
}

/**
 * The paper a window takes away, as a scene: the `removed` faces where the
 * picture draws them, which the window covers in the page's white before it
 * paints the faces left — so its white lies only where there was paper, and
 * off the paper the page shows through, as it does round the window (review
 * of 18f).
 */
export function xrayGroundScene(xray: XRayFaces, removed: ReadonlySet<number>, cull: PictureBox | null = null): PaperScene {
  return facesScene(xray, (face) => removed.has(face), cull);
}

/** The faces `kept` keeps, back to front, as a scene in the stored scene's frame, culled to `cull`. */
function facesScene(xray: XRayFaces, kept: (face: number) => boolean, cull: PictureBox | null): PaperScene {
  const items: PaperFaceItem[] = [];
  for (const face of xray.paint) {
    const item = xray.items[face];
    if (item && kept(face)) items.push(item);
  }
  return sceneCulledTo({ ...xray.frame, items }, cull);
}

/** An x-ray as a surface asks for its inside: its window and how deep it goes, in picture units. */
export interface XRayRequest {
  centre: Pt;
  radius: number;
  depth: number;
  anchor?: readonly [number, number];
}

/** An x-ray's inside, worked out round its window: what it takes away, and the scenes it is painted from. */
export interface XRayInside {
  removal: XRayRemoval;
  /** The faces left ({@link xrayInsideScene}). */
  scene: PaperScene;
  /** The faces taken away, where the picture draws them ({@link xrayGroundScene}): what the page's white covers. */
  ground: PaperScene;
}

/** The inside of `request`'s window on a step's faces: what it takes away, and the faces left round the window. */
export function xrayInside(xray: XRayFaces, request: XRayRequest): XRayInside {
  const { centre, radius } = request;
  const steps = xrayPeel(xray, { centre, radius }, xrayPeelPoint(xray, centre, request.anchor));
  const removal = xrayRemoval(steps, request.depth);
  const cull = { x: centre[0] - radius, y: centre[1] - radius, width: 2 * radius, height: 2 * radius };
  return {
    removal,
    scene: xrayInsideScene(xray, removal.removed, cull),
    ground: xrayGroundScene(xray, removal.removed, cull),
  };
}

/** Where a surface paints a window, in its own units. */
export interface XRayTarget {
  /** A point of the stored scene, in the surface's units. */
  project: (point: ScenePoint) => ScenePoint;
  /** The surface's units per pt: what the faces' pens are drawn at. */
  unitsPerPt: number;
}

/** A window as a surface paints it, in its units. */
export interface XRayWindowPaint {
  /** The window's centre and radius. */
  window: { x: number; y: number; r: number };
  /** The rim's pen and ink (R3-15b (ii)). */
  rim: { width: number; color: string };
  /** A polygon the inside is also held to, in the surface's units: an enlarged step's frame. */
  bound?: readonly ScenePoint[] | null;
  /** What the paper taken away is covered with: the page's white. */
  ground?: string;
}

const round = (value: number) => Number(value.toFixed(3));

/** A coordinate as the picture's faces are written (`paperSvg.ts`): two decimals, so the white lies on them exactly. */
const coordinate = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : '0');

/**
 * One x-ray window as SVG markup, in a surface's units — the one drawing every
 * surface paints (R3-12 A): clipped to the window (and to `bound`, where
 * given), the page's white over the paper it takes away (`inside.ground`),
 * the faces left (`inside.scene`) in `style`'s pens with no creases (R3-16b
 * A), then the rim, 1.5 × the edges' pen (R3-15b (ii)). Every id it declares
 * starts with `idPrefix`. The step's marks go over it.
 *
 * The white covers the faces taken away where the picture draws them, their
 * outlines too, and nothing else: off the paper a window paints nothing, so
 * what is under the picture — a page's band, a selected cell's tint, a
 * transparent step file — shows through it as it does round it (review of
 * 18f). Where a window takes every layer away at a point, the page's white is
 * what shows there (18.0 results, 5).
 */
export function xrayWindowMarkup(
  inside: Pick<XRayInside, 'scene' | 'ground'>,
  paint: XRayWindowPaint,
  style: PaperStyle,
  target: XRayTarget,
  idPrefix: string
): string {
  const { window, rim, bound = null, ground = '#ffffff' } = paint;
  const circle = `cx="${round(window.x)}" cy="${round(window.y)}" r="${round(window.r)}"`;
  const clip = `${idPrefix}clip`;
  const held = bound && bound.length >= 3 ? `${idPrefix}bound` : null;
  // The inside holds faces alone, each outlined in the edges' pen: a window shows the layers, not the creases on them.
  const body = paperSceneSvgBody(inside.scene, style, { project: target.project, unitsPerPt: target.unitsPerPt, keepHiddenFaces: false });
  const defs =
    `<clipPath id="${clip}"><circle ${circle}/></clipPath>` +
    (held ? `<clipPath id="${held}"><polygon points="${bound!.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}"/></clipPath>` : '');
  const filled = `${groundMarkup(inside.ground, ground, style.edges.width * target.unitsPerPt, target.project)}<g stroke-linejoin="round">${body}</g>`;
  const clipped = held ? `<g clip-path="url(#${held})"><g clip-path="url(#${clip})">${filled}</g></g>` : `<g clip-path="url(#${clip})">${filled}</g>`;
  return `<defs>${defs}</defs>${clipped}${xrayRimMarkup(window, rim)}`;
}

/**
 * The paper a window takes away, covered in `color`: each face of `ground`
 * filled, and stroked `width` wide so its outline in the picture goes with
 * it. One group, its paths plain, so nothing reads it as a face left. Empty
 * where the window takes nothing away.
 */
function groundMarkup(ground: PaperScene, color: string, width: number, project: XRayTarget['project']): string {
  const paths: string[] = [];
  for (const item of ground.items) {
    if (item.kind !== 'face') continue;
    const rings = item.rings.filter((ring) => ring.length >= 3);
    if (rings.length === 0) continue;
    const d = rings
      .map((ring) => `M${ring.map((point) => project(point).map(coordinate).join(',')).join('L')}Z`)
      .join('');
    // Several rings are one even-odd set, as the picture fills them.
    paths.push(`<path d="${d}"${rings.length > 1 ? ' fill-rule="evenodd"' : ''}/>`);
  }
  if (paths.length === 0) return '';
  return `<g data-x-ray-ground="" fill="${color}" stroke="${color}" stroke-width="${round(width)}" stroke-linejoin="round">${paths.join('')}</g>`;
}

/**
 * An x-ray's rim alone, in a surface's units: what {@link xrayWindowMarkup}
 * draws over the inside, and all Pose draws of a window (R3-19 A) — its
 * inside is the stored picture's, which a live pose is not.
 */
export function xrayRimMarkup(window: XRayWindowPaint['window'], rim: XRayWindowPaint['rim']): string {
  const circle = `cx="${round(window.x)}" cy="${round(window.y)}" r="${round(window.r)}"`;
  return `<circle ${circle} fill="none" stroke="${rim.color}" stroke-width="${round(rim.width)}"/>`;
}
