/**
 * An x-ray's inside (Revision 3, `implementation-plans/diagram-revision-3.md`,
 * "5. X-ray" and "18.0 results"): a flat fold's picture without its top
 * layers at one point, as a scene a surface paints inside the window.
 *
 * What it takes away (R3-13 A): the top `depth` faces at the window's anchor
 * — its picked point on the paper, or unsaid its centre — and every face over
 * those, across the whole window; a depth past the stack draws at the
 * deepest, leaving its bottom face. Read as 18.0 found it must be:
 *
 * 1. **On the paper.** The anchor is a point of the paper, and the stack and
 *    "every face over" are read on the faces' unspread places (`paperFaces`),
 *    never on the drawn ones, where a spread pushes flaps into one another.
 *    The window's centre goes back there through the face seen on top at it.
 * 2. **"Over" with a tolerance** (`faceOverlap.ts`, `facesOverWithin`): two
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
 * canvas now, and the card, the page and the files after it (18f).
 *
 * Pure but for one memo per picture's faces.
 */
import type { PaperFaceItem, PaperScene, PaperSide, ScenePoint } from '../../lib/paper/paperScene';
import { paperSceneSvgBody } from '../../lib/paper/paperSvg';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { PicturePoint } from '../annotate/annotationModel';
import { facesAt, facesOverWithin } from '../annotate/behindFlaps';
import { overlapsWider } from '../annotate/faceOverlap';
import type { PictureCover, PictureLayers } from '../annotate/pictureGeometry';
import type { DiagramStep } from '../document/diagramDocument';
import { sceneCulledTo, type PictureBox } from '../pictures/paintDiagramStep';
import { storedScene } from '../pictures/pictureFrame';
import {
  faceAt,
  facePlacement,
  faceSpreadMove,
  paperFacesOf,
  ringArea,
  topDrawn,
  unspreadOn,
  type StepFaces,
} from '../zoom/zoomImprint';

type Pt = PicturePoint;

/** A face's cover on the unspread picture, in picture units, its order its level reversed: what a stack is read from. */
export type XRayCover = PictureCover & { face: number };

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
  /** The faces as stacks are read: on the unspread picture, in picture units. */
  layers: Omit<PictureLayers, 'covers'> & { covers: readonly XRayCover[] };
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
  const covers: XRayCover[] = [];
  faces.unspread.forEach((ring, face) => {
    if (ring.length < 3) return;
    const points = ring.map(toPicture);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    covers.push({
      face,
      ring: points,
      order: -faces.levels[face]!,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
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
  return {
    faces,
    frame: { bounds: scene.bounds, sheet: scene.sheet },
    items,
    paint: paintOrder(order, covers, coverOf, faces.levels),
    layers: { orders: [], covers },
  };
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

/** A point of the picture, in picture units, in the stored scene's px. */
function toScene(xray: XRayFaces, [u, v]: Pt): Pt {
  const { minX, minY, maxX, maxY } = xray.frame.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  return [minX + u * unit, minY + v * unit];
}

/** A point in the stored scene's px, in picture units. */
function toPicture(xray: XRayFaces, [x, y]: Pt): Pt {
  const { minX, minY, maxX, maxY } = xray.frame.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  return [(x - minX) / unit, (y - minY) / unit];
}

/**
 * Where an x-ray's layers are counted, on the unspread picture, in picture
 * units (18.0 results, 1): its picked `anchor` — a point on the paper, placed
 * through the face that holds it — or, unsaid or on none of the step's faces,
 * its window's `centre` (picture units, as drawn) taken back through the face
 * drawn on top there. Null where the centre is on no face: nothing is there
 * to take away.
 */
export function xrayAnchorPoint(xray: XRayFaces, centre: Pt, anchor?: readonly [number, number]): Pt | null {
  const { faces } = xray;
  if (anchor) {
    const face = faceAt(faces, [anchor[0], anchor[1]]);
    const placement = face === null ? null : facePlacement(faces, face);
    if (placement) return toPicture(xray, placement.apply([anchor[0], anchor[1]]));
  }
  const drawn = toScene(xray, centre);
  const top = topDrawn(faces, drawn);
  return top === null ? null : toPicture(xray, unspreadOn(faces, top, drawn));
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

/** What a window takes away (R3-13 A). */
export interface XRayRemoval {
  /** The faces at the anchor, top first. */
  stack: readonly number[];
  /** How many of them it takes away: its depth, or one fewer than the stack where that is less. */
  deep: number;
  /** Those, and every face over them. */
  removed: ReadonlySet<number>;
}

/** The faces at a point of the unspread picture (picture units), top first: by level, as the kernel stacks them. */
export function xrayStackAt(xray: XRayFaces, at: Pt): number[] {
  return (facesAt(xray.layers, at) as XRayCover[]).map((cover) => cover.face);
}

/**
 * What an x-ray `depth` deep takes away at `at` (unspread, picture units):
 * the top `depth` faces there — never the bottom one, so a depth past the
 * stack draws at the deepest — and every face over them, read with "over"'s
 * tolerance (`facesOverWithin`). Nothing off the paper.
 */
export function xrayRemoval(xray: XRayFaces, at: Pt | null, depth: number): XRayRemoval {
  if (!at) return { stack: [], deep: 0, removed: new Set() };
  const covers = facesAt(xray.layers, at) as XRayCover[];
  const deep = Math.max(0, Math.min(Math.floor(depth), covers.length - 1));
  const top = covers.slice(0, deep);
  const removed = new Set((top.length > 0 ? (facesOverWithin(xray.layers, top) as XRayCover[]) : []).map((cover) => cover.face));
  return { stack: covers.map((cover) => cover.face), deep, removed };
}

/**
 * The window's inside as a scene: every face not `removed`, back to front
 * ({@link XRayFaces.paint}), in the stored scene's frame — only those that
 * reach into `cull`, a box in picture units, when given: a window shows a
 * small part of the picture.
 */
export function xrayInsideScene(xray: XRayFaces, removed: ReadonlySet<number>, cull: PictureBox | null = null): PaperScene {
  const items: PaperFaceItem[] = [];
  for (const face of xray.paint) {
    const item = xray.items[face];
    if (item && !removed.has(face)) items.push(item);
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

/** An x-ray's inside, worked out: what it takes away and the scene of what is left, round its window. */
export interface XRayInside {
  removal: XRayRemoval;
  scene: PaperScene;
}

/** The inside of `request`'s window on a step's faces: what it takes away, and the faces left round the window. */
export function xrayInside(xray: XRayFaces, request: XRayRequest): XRayInside {
  const at = xrayAnchorPoint(xray, request.centre, request.anchor);
  const removal = xrayRemoval(xray, at, request.depth);
  const { centre, radius } = request;
  const cull = { x: centre[0] - radius, y: centre[1] - radius, width: 2 * radius, height: 2 * radius };
  return { removal, scene: xrayInsideScene(xray, removal.removed, cull) };
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
  /** What the inside is filled with under the faces: the page's white. */
  ground?: string;
}

const round = (value: number) => Number(value.toFixed(3));

/**
 * One x-ray window as SVG markup, in a surface's units — the one drawing every
 * surface paints (R3-12 A): clipped to the window (and to `bound`, where
 * given), the page's white, the faces left (`inside`) in `style`'s pens with
 * no creases (R3-16b A), then the rim, 1.5 × the edges' pen (R3-15b (ii)).
 * Every id it declares starts with `idPrefix`. The step's marks go over it.
 */
export function xrayWindowMarkup(
  inside: PaperScene,
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
  const body = paperSceneSvgBody(inside, style, { project: target.project, unitsPerPt: target.unitsPerPt, keepHiddenFaces: false });
  const defs =
    `<clipPath id="${clip}"><circle ${circle}/></clipPath>` +
    (held ? `<clipPath id="${held}"><polygon points="${bound!.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}"/></clipPath>` : '');
  const filled = `<circle ${circle} fill="${ground}"/><g stroke-linejoin="round">${body}</g>`;
  const clipped = held ? `<g clip-path="url(#${held})"><g clip-path="url(#${clip})">${filled}</g></g>` : `<g clip-path="url(#${clip})">${filled}</g>`;
  return (
    `<defs>${defs}</defs>${clipped}` +
    `<circle ${circle} fill="none" stroke="${rim.color}" stroke-width="${round(rim.width)}"/>`
  );
}
