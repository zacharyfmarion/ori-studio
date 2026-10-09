import { describe, expect, it } from 'vitest';
import type { PaperFaceItem } from '../../lib/paper/paperScene';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import type { PicturePoint } from '../annotate/annotationModel';
import { overlapsWider } from '../annotate/faceOverlap';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep } from '../document/diagramDocument';
import { diagramScenePaintStyle } from '../pictures/diagramPaperStyle';
import { storedScene } from '../pictures/pictureFrame';
import { craneStep } from '../zoom/zoom.fixtures';
import { knotStep } from './xray.fixtures';
import { pickedAnchor } from '../zoom/zoomAnchor';
import {
  xrayAnchorDrawn,
  xrayAnchorPoint,
  xrayFacesOf,
  xrayInside,
  xrayInsideScene,
  xrayRemoval,
  xrayStackAt,
  xrayWindowMarkup,
  type XRayFaces,
} from './xrayScene';

/**
 * Zach's crane, step 22, as 16.0's spike captured it (`zoom.fixtures.ts`):
 * 44 faces, the same fold with no spread — its stored scene keeps the 8 faces
 * that show — and with the default affine spread, which keeps all 44.
 */
const none = craneStep('S.none');
const affine = craneStep('S.affine');

function faces(step: DiagramStep): XRayFaces {
  const read = xrayFacesOf(step);
  if (!read) throw new Error('no faces');
  return read;
}

/** The stored scene's whole face items, in its order. */
function storedFaces(step: DiagramStep): PaperFaceItem[] {
  if (step.picture?.kind !== 'scene') throw new Error('a scene');
  return storedScene(step.picture)!.items.filter((item): item is PaperFaceItem => item.kind === 'face' && item.group === undefined);
}

/** A point inside each face on the unspread picture, picture units: its corners' mean, a convex face's inside. */
function insidePoint(xray: XRayFaces, face: number): PicturePoint {
  const cover = xray.layers.covers.find((each) => each.face === face)!;
  const n = cover.ring.length;
  return [cover.ring.reduce((s, [x]) => s + x, 0) / n, cover.ring.reduce((s, [, y]) => s + y, 0) / n];
}

/**
 * Each of `dropped` painted after every face it lies over and before every face over it: a face of a lower level
 * sharing a part with it wider than the tolerance is over it.
 */
function expectPaintedByLevel(xray: XRayFaces, dropped: readonly number[]): void {
  const at = new Map(xray.paint.map((face, index) => [face, index]));
  const cover = new Map(xray.layers.covers.map((each) => [each.face, each]));
  const level = (face: number) => xray.faces.levels[face]!;
  for (const face of dropped) {
    for (const other of xray.paint) {
      if (other === face || level(other) === level(face) || !overlapsWider(cover.get(face)!, cover.get(other)!)) continue;
      if (level(other) < level(face)) expect(at.get(face)!, `${face} under ${other}`).toBeLessThan(at.get(other)!);
      else expect(at.get(face)!, `${face} over ${other}`).toBeGreaterThan(at.get(other)!);
    }
  }
}

/** The unspread point over the crane's deepest stack: inside the face with the most faces over and under it. */
function deepest(xray: XRayFaces): { at: PicturePoint; stack: number[] } {
  let best: { at: PicturePoint; stack: number[] } | null = null;
  for (const { face } of xray.layers.covers) {
    const at = insidePoint(xray, face);
    const stack = xrayStackAt(xray, at);
    if (!best || stack.length > best.stack.length) best = { at, stack };
  }
  return best!;
}

describe('an x-ray’s faces (Revision 3, 18e)', () => {
  it('reads nothing on a picture with no layers: a crease pattern, or a flat fold whose faces were never kept', () => {
    expect(xrayFacesOf(craneStep('S.none', { faces: false }))).toBeNull();
    const pattern: DiagramStep = { ...none, source: { ...(none.source as Extract<DiagramStep['source'], { kind: 'cp' }>), render: { mode: 'crease-pattern', rotationDeg: 0 } } };
    expect(xrayFacesOf(pattern)).toBeNull();
    expect(xrayFacesOf(none)).not.toBeNull();
  });

  it('draws a window that takes nothing away as the picture itself, with a spread: the stored scene’s own face items, in its order', () => {
    const xray = faces(affine);
    const inside = xrayInsideScene(xray, new Set());
    expect(inside.items).toEqual(storedFaces(affine));
    expect(inside.bounds).toEqual(storedScene(affine.picture as never)!.bounds);
  });

  it('with no spread, keeps the stored faces in their order and puts every face it dropped among them, in its side worked out from its ring', () => {
    const xray = faces(none);
    const stored = storedFaces(none);
    expect(stored).toHaveLength(8);
    expect(xray.paint).toHaveLength(44);
    expect(new Set(xray.paint).size).toBe(44);
    // The stored faces keep their order among the rest.
    const order = xray.paint.filter((face) => stored.some((item) => item.face === face));
    expect(order).toEqual(stored.map((item) => item.face));
    // A dropped face's side, from the turn of its ring (R3-16a A, amended): the spread capture of the same fold names
    // every face's side, and agrees on all 36.
    const sides = new Map(storedFaces(affine).map((item) => [item.face, item.side]));
    const dropped = xray.items.filter((item): item is PaperFaceItem => item !== null && !stored.some((each) => each.face === item.face));
    expect(dropped).toHaveLength(36);
    for (const item of dropped) {
      expect(item.side).toBe(sides.get(item.face));
      expect(item.outline).toBe('edge');
    }
    // A dropped face lies under every face over it that it shares a part with, and over every face under it: it is
    // painted after each face under it and before each over it (review of 18e: both ways).
    expectPaintedByLevel(xray, dropped.map((item) => item.face));
  });

  it('paints a dropped face between the faces it lies over and under, though the stored order puts two faces that never meet the other way round (review of 18e)', () => {
    const step = knotStep();
    const xray = faces(step);
    const [beside, back, apart, cover, buried] = [0, 1, 2, 3, 4];
    expect(storedFaces(step).map((item) => item.face)).toEqual([beside, back, apart, cover]);
    expect(new Set(xray.paint)).toEqual(new Set([beside, back, apart, cover, buried]));
    expectPaintedByLevel(xray, [buried]);
    // The faces that overlap keep the stored order among themselves.
    expect(xray.paint.indexOf(back)).toBeLessThan(xray.paint.indexOf(cover));
    // A window over the cover, one deep: the buried face shows, over the back, not under it.
    const { minX, minY, maxX, maxY } = xray.frame.bounds;
    const unit = Math.max(maxX - minX, maxY - minY);
    const at: PicturePoint = [(30 - minX) / unit, (20 - minY) / unit];
    const removal = xrayRemoval(xray, at, 1);
    expect(removal.stack).toEqual([cover, buried, back]);
    expect([...removal.removed]).toEqual([cover]);
    const inside = xrayInsideScene(xray, removal.removed).items.map((item) => (item as PaperFaceItem).face);
    expect(inside.indexOf(back)).toBeLessThan(inside.indexOf(buried));
  });

  it('takes away the top layers at its anchor, one to three deep, and every face over them; the bottom never', () => {
    const xray = faces(none);
    const { at, stack } = deepest(xray);
    expect(stack.length).toBeGreaterThanOrEqual(4);
    // The stack is by level, the top first.
    const levels = stack.map((face) => xray.faces.levels[face]!);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    const cover = new Map(xray.layers.covers.map((each) => [each.face, each]));
    let before = new Set<number>();
    for (const depth of [1, 2, 3]) {
      const { removed, deep } = xrayRemoval(xray, at, depth);
      expect(deep).toBe(depth);
      for (const face of stack.slice(0, depth)) expect(removed.has(face)).toBe(true);
      expect(removed.has(stack[depth]!)).toBe(false);
      // Every face over one taken away goes with it: a lower level, sharing a part wider than the tolerance.
      for (const face of removed) {
        for (const other of xray.layers.covers) {
          if (xray.faces.levels[other.face]! < xray.faces.levels[face]! && overlapsWider(cover.get(face)!, other)) {
            expect(removed.has(other.face)).toBe(true);
          }
        }
      }
      // Deeper takes away all the shallower one did.
      for (const face of before) expect(removed.has(face)).toBe(true);
      before = new Set(removed);
    }
  });

  it('draws a depth past the stack at the deepest, leaving its bottom face', () => {
    const xray = faces(none);
    const { at, stack } = deepest(xray);
    const past = xrayRemoval(xray, at, 99);
    const deepestOne = xrayRemoval(xray, at, stack.length - 1);
    expect(past.deep).toBe(stack.length - 1);
    expect([...past.removed].sort()).toEqual([...deepestOne.removed].sort());
    expect(past.removed.has(stack.at(-1)!)).toBe(false);
    // Off the paper, nothing is taken away.
    expect(xrayRemoval(xray, null, 2)).toEqual({ stack: [], deep: 0, removed: new Set() });
  });

  it('skips a face the kernel could not name, which has no ring', () => {
    if (none.picture?.kind !== 'scene') throw new Error('a scene');
    const paperFaces = JSON.parse(none.picture.paperFaces!) as { rings: number[][] };
    const dropped = faces(none).paint.find((face) => !storedFaces(none).some((item) => item.face === face))!;
    paperFaces.rings[dropped] = [];
    const step: DiagramStep = { ...none, picture: { ...none.picture, paperFaces: JSON.stringify(paperFaces) } };
    const xray = faces(step);
    expect(xray.items[dropped]).toBeNull();
    expect(xray.paint).not.toContain(dropped);
    expect(xray.layers.covers.map((each) => each.face)).not.toContain(dropped);
    expect(xrayInsideScene(xray, new Set()).items.map((item) => (item as PaperFaceItem).face)).not.toContain(dropped);
  });

  it('with a spread, reads its stack on the paper and draws what is left where the spread picture has it', () => {
    const flat = faces(none);
    const spread = faces(affine);
    const { at } = deepest(flat);
    // The same point of the paper on each, through the face on top there: the same layers taken away.
    const paperPoint = pickedAnchor(none, at)!;
    expect(paperPoint).not.toBeNull();
    const centre: PicturePoint = [0, 0];
    const a = xrayRemoval(flat, xrayAnchorPoint(flat, centre, paperPoint), 2);
    const b = xrayRemoval(spread, xrayAnchorPoint(spread, centre, paperPoint), 2);
    expect(b.stack).toEqual(a.stack);
    expect([...b.removed].sort()).toEqual([...a.removed].sort());
    // Its window's centre, unanchored, goes back to the paper through the face drawn on top there: picked there, the same.
    const drawnCentre: PicturePoint = [0.45, 0.6];
    const onPaper = pickedAnchor(affine, drawnCentre);
    if (onPaper) {
      expect(xrayStackAt(spread, xrayAnchorPoint(spread, drawnCentre)!)).toEqual(xrayStackAt(spread, xrayAnchorPoint(spread, [9, 9], onPaper)!));
    }
    // What is left, where the spread picture draws it: every kept face its stored item, spread rings and all.
    const inside = xrayInsideScene(spread, b.removed);
    const stored = new Map(storedFaces(affine).map((item) => [item.face, item]));
    for (const item of inside.items as PaperFaceItem[]) expect(item.rings).toEqual(stored.get(item.face)!.rings);
  });

  it('places a picked anchor where the picture draws it, through the face that holds it, spread and all (review of 18e)', () => {
    for (const step of [none, affine]) {
      const xray = faces(step);
      const drawn: PicturePoint = [0.45, 0.6];
      const paper = pickedAnchor(step, drawn)!;
      expect(paper).not.toBeNull();
      const at = xrayAnchorDrawn(xray, paper)!;
      expect(at[0]).toBeCloseTo(drawn[0], 6);
      expect(at[1]).toBeCloseTo(drawn[1], 6);
    }
    // A point on none of the step's faces is drawn nowhere.
    expect(xrayAnchorDrawn(faces(affine), [1e6, 1e6])).toBeNull();
  });

  it('paints one window for every surface: clipped to it, the page’s white over the paper it takes away, the faces left, then its rim', () => {
    const xray = faces(none);
    const { at } = deepest(xray);
    const inside = xrayInside(xray, { centre: at, radius: 0.1, depth: 1 });
    const markup = xrayWindowMarkup(
      inside,
      { window: { x: 10, y: 20, r: 5 }, rim: { width: 0.75 * PT_TO_CSS_PX, color: '#231f20' } },
      diagramScenePaintStyle(DEFAULT_DIAGRAM_STYLE, false),
      { project: ([x, y]) => [x, y], unitsPerPt: PT_TO_CSS_PX },
      'w-'
    );
    expect(markup).toMatch(/^<defs><clipPath id="w-clip"><circle cx="10" cy="20" r="5"\/><\/clipPath><\/defs>/);
    // The white lies on the faces taken away, as the picture draws them, their outlines in the edges' pen too — never
    // across the whole window, which would cover whatever lies under the picture off the paper (review of 18f).
    expect(markup).not.toContain('r="5" fill="#ffffff"');
    expect(markup).toContain('<g clip-path="url(#w-clip)"><g data-x-ray-ground="" fill="#ffffff" stroke="#ffffff" stroke-width="0.667" stroke-linejoin="round"><path d="M');
    const ground = markup.slice(markup.indexOf('data-x-ray-ground'), markup.indexOf('</g>'));
    expect(inside.ground.items.length).toBeGreaterThan(0);
    expect(ground.match(/<path /g)).toHaveLength(inside.ground.items.length);
    for (const item of inside.ground.items) expect(inside.removal.removed.has((item as PaperFaceItem).face)).toBe(true);
    expect(markup).toMatch(/<circle cx="10" cy="20" r="5" fill="none" stroke="#231f20" stroke-width="1"\/>$/);
    // Faces only: no crease is drawn in a window (R3-16b A).
    expect(inside.scene.items.every((item) => item.kind === 'face')).toBe(true);
    // A window that takes nothing away lays no white at all: the picture's own faces, through its clip.
    const nothing = xrayInside(xray, { centre: at, radius: 0.1, depth: 0 });
    expect(nothing.ground.items).toEqual([]);
    const plain = xrayWindowMarkup(
      nothing,
      { window: { x: 10, y: 20, r: 5 }, rim: { width: 1, color: '#000' } },
      diagramScenePaintStyle(DEFAULT_DIAGRAM_STYLE, false),
      { project: ([x, y]) => [x, y], unitsPerPt: 1 },
      'n-'
    );
    expect(plain).toContain('<g clip-path="url(#n-clip)"><g stroke-linejoin="round">');
    expect(plain).not.toContain('data-x-ray-ground');
    // Held to a bound as well, where one is given: an enlarged step's frame.
    const bounded = xrayWindowMarkup(
      inside,
      { window: { x: 10, y: 20, r: 5 }, rim: { width: 1, color: '#000' }, bound: [[0, 0], [30, 0], [30, 30]] },
      diagramScenePaintStyle(DEFAULT_DIAGRAM_STYLE, false),
      { project: ([x, y]) => [x, y], unitsPerPt: 1 },
      'b-'
    );
    expect(bounded).toContain('<clipPath id="b-bound"><polygon points="0,0 30,0 30,30"/></clipPath>');
    expect(bounded).toContain('<g clip-path="url(#b-bound)"><g clip-path="url(#b-clip)">');
  });
});
