import { describe, expect, it } from 'vitest';
import type { PaperFaceItem } from '../../lib/paper/paperScene';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import type { PicturePoint } from '../annotate/annotationModel';
import { facesAt } from '../annotate/behindFlaps';
import { overlapsWider, piecesPart, piecesWithin } from '../annotate/faceOverlap';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep } from '../document/diagramDocument';
import { diagramScenePaintStyle } from '../pictures/diagramPaperStyle';
import { storedScene } from '../pictures/pictureFrame';
import { craneStep } from '../zoom/zoom.fixtures';
import { FLAPS, flapsStep, handFold, knotStep, rect } from './xray.fixtures';
import { pickedAnchor } from '../zoom/zoomAnchor';
import {
  XRAY_SLIVER,
  xrayAnchorDrawn,
  xrayFacesOf,
  xrayInside,
  xrayInsideScene,
  xrayPeel,
  xrayPeelPoint,
  xrayRemoval,
  xrayStacked,
  xrayWindowMarkup,
  type XRayCover,
  type XRayFaces,
  type XRayWindow,
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
    const stack = (facesAt(xray.layers, at) as XRayCover[]).map((cover) => cover.face);
    if (!best || stack.length > best.stack.length) best = { at, stack };
  }
  return best!;
}

/** A point of a hand-built fold's sheet (px), in picture units. */
function inPicture(xray: XRayFaces, [x, y]: PicturePoint): PicturePoint {
  const { minX, minY, maxX, maxY } = xray.frame.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  return [(x - minX) / unit, (y - minY) / unit];
}

/** A window's steps, its peel starting at `point`, its centre unless given. */
function peel(xray: XRayFaces, window: XRayWindow, point: PicturePoint = window.centre): readonly (readonly number[])[] {
  return xrayPeel(xray, window, point);
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
    const at = inPicture(xray, [30, 20]);
    const steps = peel(xray, { centre: at, radius: inPicture(xray, [3, 0])[0] - inPicture(xray, [0, 0])[0] });
    expect(steps).toEqual([[cover], [buried]]);
    const removal = xrayRemoval(steps, 1);
    expect([...removal.removed]).toEqual([cover]);
    const inside = xrayInsideScene(xray, removal.removed).items.map((item) => (item as PaperFaceItem).face);
    expect(inside.indexOf(back)).toBeLessThan(inside.indexOf(buried));
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

describe('a window peeled (18g)', () => {
  /** A disc's ring, `scale` of its radius: what the checks below read a window's inside by, apart from the module. */
  const discOf = ({ centre: [x, y], radius }: XRayWindow, scale: number): PicturePoint[] =>
    Array.from({ length: 96 }, (_, i): PicturePoint => [x + scale * radius * Math.cos((2 * Math.PI * i) / 96), y + scale * radius * Math.sin((2 * Math.PI * i) / 96)]);

  it('peels two flaps side by side a flap a step, the one at its Point first, the whole top layer before the one under it (Zach’s report on #447)', () => {
    const xray = faces(flapsStep());
    const { base, L1, R1, L2, R2 } = FLAPS;
    // Across the flaps' edge, its centre on the right flap.
    const window = { centre: inPicture(xray, [53, 50]), radius: 0.12 };
    expect(peel(xray, window)).toEqual([[R1], [L1], [R2], [L2]]);
    const inside = (depth: number) => xrayInside(xray, { ...window, depth });
    const shown = (depth: number) => inside(depth).scene.items.map((item) => (item as PaperFaceItem).face);
    // One deep, the right flap goes and the left stays on top; two deep, both; then the layer under each.
    expect([...inside(1).removal.removed]).toEqual([R1]);
    expect(shown(1)).toEqual(expect.arrayContaining([L1, R2]));
    expect(shown(2)).not.toContain(L1);
    expect(shown(2)).toEqual(expect.arrayContaining([L2, R2]));
    expect([...inside(4).removal.removed].sort()).toEqual([L1, R1, L2, R2].sort());
    expect(inside(4).removal).toMatchObject({ steps: 4, deep: 4 });
    // The base, the bottom layer, never goes: a depth past the steps draws at the deepest.
    expect(inside(9).removal).toEqual(inside(4).removal);
    expect(shown(9)).toEqual([base]);
  });

  it('starts at its Point: picked on the left flap, the left flap goes first, and the layer under it before the right’s', () => {
    const step = flapsStep();
    const xray = faces(step);
    const { L1, R1, L2, R2 } = FLAPS;
    const centre = inPicture(xray, [53, 50]);
    const anchor = pickedAnchor(step, inPicture(xray, [40, 50]))!;
    expect(anchor).not.toBeNull();
    const point = xrayPeelPoint(xray, centre, anchor);
    expect(point[0]).toBeCloseTo(0.4, 6);
    expect(peel(xray, { centre, radius: 0.12 }, point)).toEqual([[L1], [R1], [L2], [R2]]);
    expect([...xrayInside(xray, { centre, radius: 0.12, depth: 1, anchor }).removal.removed]).toEqual([L1]);
    // A Point on none of the step's faces starts at the centre.
    expect(xrayPeelPoint(xray, centre, [1e6, 1e6])).toEqual(centre);
  });

  it('peels the faces either side of an edge, then what lies under both, and keeps the back', () => {
    const xray = faces(knotStep());
    const [beside, , , cover, buried] = [0, 1, 2, 3, 4];
    // Across the edge between the cover and the face beside it, a hair onto the cover.
    const window = { centre: inPicture(xray, [41, 20]), radius: 0.1 };
    expect(peel(xray, window)).toEqual([[cover], [beside], [buried]]);
  });

  it('does not hold up two faces stacked only outside the window: each peels as it shows inside it', () => {
    // An L on top whose arm lies over a block beside it, the arm clear of the window; both over a base.
    const xray = faces(
      handFold('outside', [
        { ring: rect(0, 0, 100, 100), level: 2 },
        {
          ring: [
            [10, 45],
            [48, 45],
            [48, 80],
            [90, 80],
            [90, 90],
            [10, 90],
          ],
          level: 0,
        },
        { ring: rect(52, 45, 90, 90), level: 1 },
      ])
    );
    const [l, block] = [1, 2];
    expect(xrayStacked(xray).some((pair) => pair.upper === l && pair.lower === block)).toBe(true);
    // Its centre nearer the block: the block goes first, though the L lies over it outside the window.
    expect(peel(xray, { centre: inPicture(xray, [51, 60]), radius: 0.12 })).toEqual([[block], [l]]);
  });

  it('waits for the face over a face tucked under it, though the tucked face shows on top elsewhere in the window', () => {
    const xray = faces(
      handFold('tucked', [
        { ring: rect(0, 0, 100, 100), level: 2 },
        { ring: rect(20, 40, 80, 60), level: 1 },
        { ring: rect(20, 30, 50, 70), level: 0 },
      ])
    );
    const [strip, cover] = [1, 2];
    // Its Point on the strip, where nothing is over it: the face over its other end still goes first.
    expect(peel(xray, { centre: inPicture(xray, [55, 50]), radius: 0.15 })).toEqual([[cover], [strip]]);
  });

  it('puts a face that is a sliver in the window with the next step of its layer, or the one before when it is the last (R3-36 A)', () => {
    // A square on top, and a strip on top beside it that the window only grazes; both over a base.
    const xray = faces(
      handFold('sliver', [
        { ring: rect(0, 0, 100, 100), level: 1 },
        { ring: rect(30, 30, 60, 70), level: 0 },
        { ring: rect(64.8, 48, 90, 52), level: 0 },
      ])
    );
    const [square, strip] = [1, 2];
    const window = { centre: inPicture(xray, [50, 50]), radius: 0.15 };
    const part = piecesPart(piecesWithin([xray.drawn[strip]!.ring], discOf(window, 1)));
    expect(part.width).toBeGreaterThan(0);
    expect(part.width).toBeLessThan(XRAY_SLIVER * window.radius);
    // The square first, the strip last in its layer: with the square.
    expect(peel(xray, window)).toEqual([[square, strip]]);
    // The strip first, its Point beside it: with the step after it.
    expect(peel(xray, window, inPicture(xray, [64, 50]))).toEqual([[strip, square]]);
  });

  it('peels the crane whole faces at a time: deeper takes all the shallower did, never a face with one left over it in the window, never the last', () => {
    for (const step of [none, affine]) {
      const xray = faces(step);
      const stacked = xrayStacked(xray);
      for (const window of [
        { centre: [0.45, 0.6], radius: 0.08 },
        { centre: [0.35, 0.3], radius: 0.06 },
        { centre: [0.5, 0.5], radius: 0.2 },
      ] satisfies XRayWindow[]) {
        const steps = peel(xray, window);
        expect(steps.length).toBeGreaterThan(2);
        // Each face is taken once.
        expect(new Set(steps.flat()).size).toBe(steps.flat().length);
        // Read apart from the module, a little inside the window: a pair one over the other there.
        const within = discOf(window, 0.95);
        const overInside = stacked.filter((pair) => piecesPart(piecesWithin(pair.shared, within)).width > 1e-3);
        // And a little outside it: a face taken has something under it there.
        const around = discOf(window, 1.05);
        let before = new Set<number>();
        for (let depth = 1; depth <= steps.length; depth += 1) {
          const { removed } = xrayRemoval(steps, depth);
          for (const face of before) expect(removed.has(face)).toBe(true);
          for (const { upper, lower } of overInside) {
            if (removed.has(lower)) expect(removed.has(upper), `${upper} over ${lower}, taken first`).toBe(true);
          }
          before = new Set(removed);
        }
        for (const face of steps.flat()) {
          const under = stacked.filter((pair) => pair.upper === face && piecesPart(piecesWithin(pair.shared, around)).width > 0);
          expect(under.length, `${face} has a face under it`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('with a spread, peels by the paper’s stacking, and draws what is left where the spread picture has it', () => {
    // The same pairs stacked, spread or not: read on the paper.
    const key = (pair: { upper: number; lower: number }) => `${pair.upper}>${pair.lower}`;
    expect(new Set(xrayStacked(faces(affine)).map(key))).toEqual(new Set(xrayStacked(faces(none)).map(key)));
    // What is left, where the spread picture draws it: every kept face its stored item, spread rings and all.
    const spread = faces(affine);
    const inside = xrayInside(spread, { centre: [0.45, 0.6], radius: 0.08, depth: 2 });
    expect(inside.removal.removed.size).toBeGreaterThan(0);
    const stored = new Map(storedFaces(affine).map((item) => [item.face, item]));
    for (const item of inside.scene.items as PaperFaceItem[]) expect(item.rings).toEqual(stored.get(item.face)!.rings);
  });

  it('takes nothing away where its window has nothing to peel, and past its steps draws at the deepest', () => {
    const xray = faces(none);
    expect(peel(xray, { centre: [3, 3], radius: 0.1 })).toEqual([]);
    expect(xrayRemoval([], 2)).toEqual({ steps: 0, deep: 0, removed: new Set() });
    expect(peel(xray, { centre: [0.45, 0.6], radius: 0 })).toEqual([]);
    const steps = peel(xray, { centre: [0.45, 0.6], radius: 0.08 });
    expect(xrayRemoval(steps, 99)).toEqual(xrayRemoval(steps, steps.length));
    // A depth changed alone peels nothing again: the same steps.
    expect(peel(xray, { centre: [0.45, 0.6], radius: 0.08 })).toBe(steps);
  });
});
