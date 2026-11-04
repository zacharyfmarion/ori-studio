import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import { LAYER_ORDER_LABEL_CAP } from '../layerOrderBudgets';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { foldedPaneLines, restackedScene, type LayerPaneSegment } from './layerPaneFigure';
import {
  BESIDE_CLEAR_REACH_CHIPS,
  cappedFaces,
  chipFits,
  foldedLabelIndex,
  labelLineIndex,
  labelSize,
  LABEL_EDGE_ROOM_PX,
  paneLetters,
  patternLabelIndex,
  placeLabels,
  ringSpots,
  withPointerLetters,
  type LayerLabelSpots,
  type LayerPaneLabel,
} from './layerPaneLabels';
import { baseMarks, NO_FACE_MARKS, type LayerFaceMarks } from './layerPaneMarks';
import { zScene } from './layerPanes.fixtures';

const marks = (over: Partial<LayerFaceMarks>): LayerFaceMarks => ({ ...NO_FACE_MARKS, ...over });

/** Faces along a line on the crease pattern: face k at x = k. */
const LINE: Point[] = Array.from({ length: 200 }, (_, k) => ({ x: k, y: 0 }));

const square = (x: number, y: number, side: number): Point[] => [
  { x, y },
  { x: x + side, y },
  { x: x + side, y: y + side },
  { x, y: y + side },
];

const insideRect = ({ x, y }: Point, ring: readonly Point[]) => {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys);
};

/** A face given whole as its own one spot, the identity its projection. */
const roomy = (x: number, y: number, side = 60): LayerLabelSpots => {
  const ring = square(x - side / 2, y - side / 2, side);
  return { visible: true, spots: [{ at: { x, y }, region: ring }], outline: ring };
};

describe('which faces carry letters', () => {
  it('the cap is phase gate 2’s', () => {
    expect(LAYER_ORDER_LABEL_CAP).toBe(50);
  });

  it('letters every face a pick can take up to the cap', () => {
    expect(cappedFaces([3, 1, 2], null, 0, LINE, 5)).toEqual([3, 1, 2]);
  });

  // The subject's open faces: every face but the subject, 10.
  const OPEN = Array.from({ length: 21 }, (_, k) => k).filter((face) => face !== 10);

  it('past the cap, the nearest to the subject keep theirs', () => {
    // The subject at x = 10: 9 and 11, then 8 and 12, …
    expect(cappedFaces(OPEN, null, 10, LINE, 4).sort((a, b) => a - b)).toEqual([8, 9, 11, 12]);
  });

  it('past the cap, the face pointed at and the nearest to it keep theirs', () => {
    expect(cappedFaces(OPEN, 20, 10, LINE, 3)).toEqual([20, 19, 18, 17]);
    // Pointing at a face no pick can take moves nothing.
    expect(cappedFaces(OPEN, 150, 10, LINE, 2).sort((a, b) => a - b)).toEqual([9, 11]);
  });

  it('nothing is lettered while a subject is chosen', () => {
    expect(paneLetters(marks({ picking: 'subject', pickable: [1, 2, 3], pointed: 2 }), LINE).labels).toEqual([]);
  });

  it('the subject, every object picked, a row’s faces and the clash always; the picks first', () => {
    const letters = paneLetters(
      marks({ picking: 'object', pickable: [4, 5], subject: 0, objects: [1, 2], row: [7, 8], clash: [2, 9] }),
      LINE
    );
    const tones = Object.fromEntries(letters.labels.map(({ face, tone }) => [face, tone]));
    expect(tones).toEqual({ 0: 'pick', 1: 'pick', 2: 'danger', 7: 'pick', 8: 'pick', 9: 'danger', 4: 'plain', 5: 'plain' });
    expect(letters.labels.slice(-2).map(({ tone }) => tone)).toEqual(['plain', 'plain']);
    expect(letters.pastCap).toEqual([]);
  });

  it('a picked object keeps its letter past the cap; the faces past it are tinted, unlettered', () => {
    const pickable = Array.from({ length: 120 }, (_, k) => k + 1);
    const letters = paneLetters(marks({ picking: 'object', pickable, subject: 0, objects: [110, 115] }), LINE);
    const lettered = new Set(letters.labels.map(({ face }) => face));
    expect(lettered.has(110)).toBe(true);
    expect(lettered.has(115)).toBe(true);
    // The subject, the two objects, and the 50 nearest the subject.
    expect(letters.labels.filter(({ tone }) => tone === 'plain')).toHaveLength(50);
    expect(lettered.size).toBe(53);
    expect(letters.pastCap).toHaveLength(120 - 52);
    expect(letters.pastCap.every((face) => !lettered.has(face))).toBe(true);
  });

  it('marks which letters must show: picks, the clash, the face pointed at', () => {
    const pickable = Array.from({ length: 60 }, (_, k) => k + 1);
    const { labels } = paneLetters(marks({ picking: 'object', pickable, subject: 0, objects: [3], clash: [9], pointed: 30 }), LINE);
    const keep = labels.filter((label) => label.keep).map(({ face }) => face).sort((a, b) => a - b);
    expect(keep).toEqual([0, 3, 9, 30]);
  });

  const byFace = (letters: { labels: readonly LayerPaneLabel[] }) => [...letters.labels].sort((a, b) => a.face - b.face);
  const PAST_CAP = Array.from({ length: 120 }, (_, k) => k + 1);

  it('takes the pointer on last, the same letters as reading the marks whole', () => {
    const cases: Partial<LayerFaceMarks>[] = [
      { picking: 'object', pickable: [4, 5, 6], subject: 0, objects: [4], pointed: 5, row: [7, 8] },
      { picking: 'object', pickable: PAST_CAP, subject: 0, pointed: 100 },
      { picking: 'subject', pickable: [1, 2], pointed: 2, row: [1, 9], clash: [9] },
    ];
    for (const over of cases) {
      const full = marks(over);
      const taken = withPointerLetters(paneLetters(baseMarks(full), LINE), full, LINE);
      expect(byFace(taken)).toEqual(byFace(paneLetters(full, LINE)));
    }
  });

  it('past the cap, pointing at a lettered face moves no letter: only one the cap left out gathers them', () => {
    const resting = marks({ picking: 'object', pickable: PAST_CAP, subject: 0 });
    const base = paneLetters(resting, LINE);
    const lettered = (letters: { labels: readonly LayerPaneLabel[] }) => letters.labels.map(({ face }) => face).sort((a, b) => a - b);
    const onLettered = withPointerLetters(base, { ...resting, pointed: 3 }, LINE);
    expect(lettered(onLettered)).toEqual(lettered(base));
    expect(onLettered.labels.find(({ face }) => face === 3)?.keep).toBe(true);
    const onLeftOut = withPointerLetters(base, { ...resting, pointed: 100 }, LINE);
    expect(lettered(onLeftOut)).toContain(100);
    expect(lettered(onLeftOut)).not.toContain(1);
  });
});

describe('where a letter may sit', () => {
  it('on the crease pattern: inside the face, its centroid first, then spread along it whichever way it lies', () => {
    const long = square(0, 0, 10).map(({ x, y }) => ({ x: x * 10, y }));
    const tall = long.map(({ x, y }) => ({ x: y, y: x }));
    for (const [ring, along] of [
      [long, 'x'],
      [tall, 'y'],
    ] as const) {
      const spots = ringSpots(ring, 4);
      expect(spots).toHaveLength(4);
      expect(spots[0]).toEqual(along === 'x' ? { x: 50, y: 5 } : { x: 5, y: 50 });
      expect(spots.every((p) => insideRect(p, ring))).toBe(true);
      const reach = spots.map((p) => p[along]);
      expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(50);
    }
    // A face whose centroid is outside it: only points inside.
    const l = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 40 },
      { x: 0, y: 40 },
    ];
    const spots = ringSpots(l, 6);
    expect(spots.length).toBeGreaterThan(1);
    expect(spots.every(({ x, y }) => (x < 10 && y < 40) || (y < 10 && x < 40))).toBe(true);
  });

  it('on the crease pattern, the face’s ring is each spot’s region, worked out once', () => {
    const index = patternLabelIndex([square(0, 0, 30), []]);
    const spots = index(0)!;
    expect(spots.visible).toBe(true);
    expect(spots.spots.length).toBeGreaterThan(1);
    expect(spots.spots.every(({ region }) => region === spots.outline)).toBe(true);
    expect(index(0)).toBe(spots);
    expect(index(1)).toBeNull();
    expect(index(5)).toBeNull();
  });

  it('on the folded paper: points in its spots on top; a hidden face’s in its outline, then in its spots', () => {
    const scene = zScene();
    const index = foldedLabelIndex(scene);
    const [left, right] = scene.subfaces.map(({ polygon }) => polygon);
    // Face 0 is on top of spot 0 only; face 2 of spot 1; face 1 of none.
    const zero = index(0)!;
    expect(zero.visible).toBe(true);
    expect(zero.spots[0]!.at).toEqual({ x: 5, y: 5 });
    expect(zero.spots.length).toBeGreaterThan(1);
    expect(zero.spots.every(({ at, region }) => region === left && insideRect(at, left!))).toBe(true);
    const two = index(2)!;
    expect(two.spots[0]!.at).toEqual({ x: 15, y: 5 });
    expect(two.spots.every(({ region }) => region === right)).toBe(true);
    const one = index(1)!;
    expect(one.visible).toBe(false);
    expect(one.outline).toBe(scene.faces[1]!.outline);
    expect(one.spots[0]).toEqual({ at: { x: 15, y: 5 }, region: one.outline });
    expect(one.spots.at(-1)!.region).toBe(right);
    expect(index(1)).toBe(one);
  });

  it('follows the order on screen', () => {
    const turned = restackedScene(zScene(), {
      offsets: new Uint32Array([0, 1, 4]),
      faces: new Uint32Array([0, 1, 2, 0]),
    });
    expect(foldedLabelIndex(turned)(1)?.visible).toBe(true);
    expect(foldedLabelIndex(turned)(2)?.visible).toBe(false);
  });

  it('sizes a chip by its letters, smaller when hidden, wider with a clash’s dot', () => {
    const plain = labelSize('C', false, false);
    expect(plain.height).toBeCloseTo(16.275);
    expect(labelSize('AB', false, false).width).toBeGreaterThan(plain.width);
    expect(labelSize('C', true, false).height).toBeLessThan(plain.height);
    expect(labelSize('C', false, true).width).toBe(plain.width + 8);
  });

  it('fits a chip inside its region with room for the ring, and not across a notch', () => {
    const size = labelSize('C', false, false);
    expect(chipFits({ x: 30, y: 30 }, size, square(0, 0, 60), LABEL_EDGE_ROOM_PX)).toBe(true);
    // A face narrower than the chip, or as wide with no room for its ring.
    expect(chipFits({ x: 5, y: 5 }, size, square(0, 0, 10), LABEL_EDGE_ROOM_PX)).toBe(false);
    expect(chipFits({ x: 9, y: 9 }, size, square(0, 0, 18), LABEL_EDGE_ROOM_PX)).toBe(false);
    // An L whose reflex corner bites into the chip's box though every corner of the box is inside.
    const l = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 30 },
      { x: 31, y: 30 },
      { x: 31, y: 32 },
      { x: 60, y: 32 },
      { x: 60, y: 60 },
      { x: 0, y: 60 },
    ];
    expect(chipFits({ x: 40, y: 31 }, { width: 10, height: 30 }, l, 0)).toBe(false);
  });
});

describe('placing the letters', () => {
  const at = (placed: ReturnType<typeof placeLabels>) =>
    placed.map(({ face, x, y, under, off }) => [face, Math.round(x), Math.round(y), under, off]);

  it('places each at the first spot it fits clear of the ones before; the first on top', () => {
    const labels: LayerPaneLabel[] = [
      { face: 0, tone: 'pick', keep: true },
      { face: 1, tone: 'plain', keep: false },
    ];
    const spots = new Map<number, LayerLabelSpots>([
      [0, roomy(30, 30)],
      [
        1,
        {
          visible: true,
          spots: [
            { at: { x: 32, y: 30 }, region: square(0, 0, 60) },
            { at: { x: 130, y: 30 }, region: square(100, 0, 60) },
          ],
          outline: square(0, 0, 160),
        },
      ],
    ]);
    const placed = placeLabels(labels, (face) => spots.get(face) ?? null, (face) => 'AB'[face]!, (p) => p);
    expect(at(placed)).toEqual([
      [1, 130, 30, false, false],
      [0, 30, 30, false, false],
    ]);
  });

  it('leaves out a plain letter with no clear spot it fits in: only legible letters', () => {
    const labels: LayerPaneLabel[] = Array.from({ length: 50 }, (_, face) => ({ face, tone: 'plain', keep: face === 7 }));
    // Fifty faces a pixel apart, as iguana-c0's are at fit, each roomy enough on its own.
    const placed = placeLabels(labels, (face) => roomy(face, 0), () => 'HN', (p) => p);
    const faces = placed.map(({ face }) => face).sort((a, b) => a - b);
    expect(faces).toContain(7);
    expect(faces.length).toBeLessThan(10);
    for (const a of placed) {
      for (const b of placed) {
        if (a === b || a.face === 7 || b.face === 7) continue;
        expect(Math.abs(a.x - b.x)).toBeGreaterThan((a.width + b.width) / 2);
      }
    }
  });

  it('letters the faces that show before the hidden ones, so a buried face never takes the spot of the face on top', () => {
    const one = roomy(30, 30);
    const labels: LayerPaneLabel[] = [
      { face: 1, tone: 'pick', keep: true },
      { face: 2, tone: 'pick', keep: true },
    ];
    const spotsOf = (face: number): LayerLabelSpots => (face === 1 ? { ...one, visible: false } : one);
    const placed = placeLabels(labels, spotsOf, (face) => 'AB'[face - 1]!, (p) => p);
    const two = placed.find(({ face }) => face === 2)!;
    expect([two.x, two.y, two.off]).toEqual([30, 30, false]);
    expect(placed.find(({ face }) => face === 1)?.off).toBe(true);
  });

  it('never letters a plain face narrower than its chip', () => {
    const thin = square(0, 0, 8);
    const placed = placeLabels(
      [{ face: 0, tone: 'plain', keep: false }],
      () => ({ visible: true, spots: [{ at: { x: 4, y: 4 }, region: thin }], outline: thin }),
      () => 'A',
      (p) => p
    );
    expect(placed).toEqual([]);
  });

  it('sets a letter that must show beside its face when the face has no room, so it never hides the face’s tint or ring', () => {
    const thin = square(100, 100, 8);
    const placed = placeLabels(
      [{ face: 0, tone: 'pick', keep: true }],
      () => ({ visible: true, spots: [{ at: { x: 104, y: 104 }, region: thin }], outline: thin }),
      () => 'A',
      (p) => p
    );
    expect(placed).toHaveLength(1);
    const chip = placed[0]!;
    expect(chip.off).toBe(true);
    // Above the face, clear of it.
    expect(chip.y + chip.height / 2).toBeLessThan(100);
    expect(chip.x).toBe(104);
  });

  it('sets a letter beside a long slanted face against the face, not off its bounding box', () => {
    // A sliver along the diagonal from (0, 0) to (200, 200), 6 px across.
    const sliver = [
      { x: 0, y: 0 },
      { x: 4, y: -2 },
      { x: 204, y: 198 },
      { x: 200, y: 200 },
    ];
    const placed = placeLabels(
      [{ face: 0, tone: 'pick', keep: true }],
      () => ({ visible: true, spots: [{ at: { x: 102, y: 99 }, region: sliver }], outline: sliver }),
      () => 'C',
      (p) => p
    )[0]!;
    expect(placed.off).toBe(true);
    // Against the sliver, near the spot it names: off the bounding box's top it would be 80 px from the diagonal.
    expect(Math.abs(placed.x - placed.y) / Math.SQRT2).toBeLessThan(25);
    expect(Math.hypot(placed.x - 102, placed.y - 99)).toBeLessThan(30);
  });

  it('keeps a letter set beside its face on screen: a face along the pane’s top takes its letter below', () => {
    const thin = square(100, 0, 8);
    const spotsOf = () => ({ visible: true, spots: [{ at: { x: 104, y: 4 }, region: thin }], outline: thin });
    const label: LayerPaneLabel[] = [{ face: 0, tone: 'pick', keep: true }];
    // With no frame, above it, off the top.
    const anywhere = placeLabels(label, spotsOf, () => 'A', (p) => p)[0]!;
    expect(anywhere.y - anywhere.height / 2).toBeLessThan(0);
    const onScreen = placeLabels(label, spotsOf, () => 'A', (p) => p, { frame: { width: 400, height: 400 } })[0]!;
    expect(onScreen.off).toBe(true);
    expect(onScreen.y - onScreen.height / 2).toBeGreaterThan(8);
    expect(onScreen.x).toBe(104);
  });

  it('keeps a chip clear of the crease along its face as wide as the crease is drawn', () => {
    const face = square(0, 0, 30);
    const spotsOf = () => ({ visible: true, spots: [{ at: { x: 15, y: 15 }, region: face }], outline: face });
    const label: LayerPaneLabel[] = [{ face: 0, tone: 'pick', keep: true }];
    // A 30 px face holds a chip with the ring's room at line width 1, …
    expect(placeLabels(label, spotsOf, () => 'C', (p) => p, { linePx: 1.5 })[0]!.off).toBe(false);
    // … but not with a crease drawn 9 px wide along it: the letter goes beside, clear of that crease.
    const wide = placeLabels(label, spotsOf, () => 'C', (p) => p, { linePx: 9 })[0]!;
    expect(wide.off).toBe(true);
    // How far the chip sits outside the face, on the side it sits beyond.
    const clearance = Math.max(
      wide.x - wide.width / 2 - 30,
      0 - (wide.x + wide.width / 2),
      wide.y - wide.height / 2 - 30,
      0 - (wide.y + wide.height / 2)
    );
    expect(clearance).toBeGreaterThanOrEqual(4.5);
  });

  describe('clear of every line the pane draws (D20)', () => {
    /** A face too small for its chip, at (100, 100), 8 across: its letter must sit beside it. */
    const thin = square(100, 100, 8);
    const spotsOf = () => ({ visible: true, spots: [{ at: { x: 104, y: 104 }, region: thin }], outline: thin });
    const label: LayerPaneLabel[] = [{ face: 0, tone: 'pick', keep: true }];
    const sides = (ring: readonly Point[]): LayerPaneSegment[] => ring.map((p, i) => [p, ring[(i + 1) % ring.length]!]);
    const across = (y: number, from = -400, to = 600): LayerPaneSegment => [
      { x: from, y },
      { x: to, y },
    ];
    const down = (x: number, from = -400, to = 600): LayerPaneSegment => [
      { x, y: from },
      { x, y: to },
    ];
    /** Whether `segment`, level or upright, passes within `gap` of the chip's box. */
    const covers = (chip: { x: number; y: number; width: number; height: number }, [a, b]: LayerPaneSegment, gap: number) => {
      const [minX, maxX] = [chip.x - chip.width / 2 - gap, chip.x + chip.width / 2 + gap];
      const [minY, maxY] = [chip.y - chip.height / 2 - gap, chip.y + chip.height / 2 + gap];
      if (a.y === b.y) return a.y > minY && a.y < maxY && Math.max(a.x, b.x) > minX && Math.min(a.x, b.x) < maxX;
      return a.x > minX && a.x < maxX && Math.max(a.y, b.y) > minY && Math.min(a.y, b.y) < maxY;
    };
    /** A crease every 6 px each way over the whole pane: no chip fits between them anywhere. */
    const mesh = Array.from({ length: 150 }, (_, k) => [across(-400 + k * 6), down(-400 + k * 6)]).flat();

    it('moves a letter set beside its face off a crease it would land on, to the nearest clear spot', () => {
      // Two creases, 12 px over the face and 12 under it: where the letter sits beside it with no lines.
      const creases = [across(88), across(120)];
      const plain = placeLabels(label, spotsOf, () => 'A', (p) => p)[0]!;
      expect(plain.off).toBe(true);
      expect(covers(plain, creases[0]!, 0)).toBe(true);
      const lines = labelLineIndex([...sides(thin), ...creases]);
      const moved = placeLabels(label, spotsOf, () => 'A', (p) => p, { lines })[0]!;
      expect(moved.off).toBe(true);
      // Clear of both creases and of the face's own, by the gap a letter keeps from its face.
      for (const segment of [...creases, ...sides(thin)]) expect(covers(moved, segment, 3)).toBe(false);
      // Still against the face: to its right, as near as up or down was.
      expect([moved.x, moved.y]).toEqual([120, 104]);
    });

    it('keeps clear of a crease as wide as it is drawn', () => {
      const crease = down(124);
      const lines = labelLineIndex([...sides(thin), crease, across(88), across(120)]);
      const moved = placeLabels(label, spotsOf, () => 'A', (p) => p, { lines, linePx: 6 })[0]!;
      expect(moved.off).toBe(true);
      expect(covers(moved, crease, 3 + 3)).toBe(false);
    });

    it('reads the lines through the camera, turned and scaled', () => {
      // A quarter turn and twice the size: the face is 16 px on screen, from (284, 200); creases down the
      // frame at x = 94 and 114 run across the screen 12 px over it and 12 under it.
      const project = ({ x, y }: Point): Point => ({ x: 500 - 2 * y, y: 2 * x });
      const creases = [down(94), down(114)];
      const onScreen = ([a, b]: LayerPaneSegment): LayerPaneSegment => [project(a), project(b)];
      const plain = placeLabels(label, spotsOf, () => 'A', project)[0]!;
      expect(covers(plain, onScreen(creases[0]!), 0)).toBe(true);
      const lines = labelLineIndex([...sides(thin), ...creases]);
      const moved = placeLabels(label, spotsOf, () => 'A', project, { lines })[0]!;
      expect(moved.off).toBe(true);
      for (const segment of [...creases, ...sides(thin)]) expect(covers(moved, onScreen(segment), 3)).toBe(false);
      expect([moved.x, moved.y]).toEqual([312, 208]);
    });

    it('finds the spot a look at every step would: the nearest clear one, whichever way, or else the nearest beside', () => {
      // The reference: out each way 2 px at a time to where it clears the face, then on to the first spot
      // clear of every crease too, no more than the reach past the face; with none, the nearest beside.
      const crosses = ([a, b]: LayerPaneSegment, minX: number, minY: number, maxX: number, maxY: number) => {
        let [t0, t1] = [0, 1];
        const [dx, dy] = [b.x - a.x, b.y - a.y];
        for (const [p, q] of [
          [-dx, a.x - minX],
          [dx, maxX - a.x],
          [-dy, a.y - minY],
          [dy, maxY - a.y],
        ] as const) {
          if (p === 0) {
            if (q <= 0) return false;
          } else if (p < 0) t0 = Math.max(t0, q / p);
          else t1 = Math.min(t1, q / p);
          if (t0 >= t1) return false;
        }
        return true;
      };
      const ways = [
        [0, -1],
        [0, 1],
        [1, 0],
        [-1, 0],
        [Math.SQRT1_2, -Math.SQRT1_2],
        [-Math.SQRT1_2, -Math.SQRT1_2],
        [Math.SQRT1_2, Math.SQRT1_2],
        [-Math.SQRT1_2, Math.SQRT1_2],
      ] as const;
      const size = labelSize('A', false, false);
      const [halfW, halfH] = [size.width / 2 + 3, size.height / 2 + 3];
      let seed = 7;
      const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      let cleared = 0;
      for (let trial = 0; trial < 40; trial += 1) {
        // Denser trial by trial, so the later ones often leave no clear spot close by.
        const creases: LayerPaneSegment[] = Array.from({ length: 8 + 3 * trial }, () => [
          { x: random() * 260 - 30, y: random() * 260 - 30 },
          { x: random() * 260 - 30, y: random() * 260 - 30 },
        ]);
        const all = [...sides(thin), ...creases];
        let expected: { x: number; y: number; reach: number } | null = null;
        let besideOnly: { x: number; y: number; reach: number } | null = null;
        for (const [dx, dy] of ways) {
          const spot = (reach: number) => ({ x: 104 + dx * reach, y: 104 + dy * reach, reach });
          const overFace = ({ x, y }: { x: number; y: number }) => x + halfW > 100 && x - halfW < 108 && y + halfH > 100 && y - halfH < 108;
          let out = 2;
          while (out <= 160 && overFace(spot(out))) out += 2;
          if (out > 160) continue;
          if (!besideOnly || out < besideOnly.reach) besideOnly = spot(out);
          for (let reach = out; reach <= Math.min(160, out + BESIDE_CLEAR_REACH_CHIPS * size.height); reach += 2) {
            const { x, y } = spot(reach);
            if (all.some((s) => crosses(s, x - halfW, y - halfH, x + halfW, y + halfH))) continue;
            if (!expected || reach < expected.reach) expected = spot(reach);
            break;
          }
        }
        const placed = placeLabels(label, spotsOf, () => 'A', (p) => p, { lines: labelLineIndex(all) })[0]!;
        const want = expected ?? besideOnly!;
        if (expected) cleared += 1;
        expect([placed.x, placed.y]).toEqual([want.x, want.y]);
      }
      // Both ends are tried: trials with a clear spot close by, and trials with none.
      expect(cleared).toBeGreaterThanOrEqual(5);
      expect(40 - cleared).toBeGreaterThanOrEqual(5);
    });

    it('takes no crease-free spot further past its face than the reach: it sits beside the face over a crease', () => {
      const reach = BESIDE_CLEAR_REACH_CHIPS * labelSize('A', false, false).height;
      // A crease every 6 px each way over a square round the face: clear past its edge, and nowhere inside it.
      const meshOver = (half: number) =>
        Array.from({ length: Math.floor((2 * half) / 6) + 1 }, (_, k) => [
          across(104 - half + k * 6, 104 - half, 104 + half),
          down(104 - half + k * 6, 104 - half, 104 + half),
        ]).flat();
      // 30 px round the face: the clear spot over it is 30 px past the face, inside the reach, so it is taken.
      const near = meshOver(34);
      const taken = placeLabels(label, spotsOf, () => 'A', (p) => p, { lines: labelLineIndex([...sides(thin), ...near]) })[0]!;
      expect(taken.off).toBe(true);
      for (const segment of near) expect(covers(taken, segment, 3)).toBe(false);
      expect(100 - (taken.y + taken.height / 2)).toBeLessThan(reach + 3);
      // 60 px round it: the nearest clear spot is 60 px past the face, beyond the reach, so the letter
      // sits where it would with no lines at all, beside its face, over the creases.
      const far = meshOver(64);
      expect(60).toBeGreaterThan(reach);
      const plain = placeLabels(label, spotsOf, () => 'A', (p) => p);
      const kept = placeLabels(label, spotsOf, () => 'A', (p) => p, { lines: labelLineIndex([...sides(thin), ...far]) });
      expect(at(kept)).toEqual(at(plain));
      expect(far.some((segment) => covers(kept[0]!, segment, 0))).toBe(true);
    });

    /** Whether two placed chips overlap, the gap between letters included. */
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 2;

    it('with no clear spot, keeps two letters apart beside one small face, each over a crease', () => {
      // The subject and an object on one 8 px face, under a crease every 6 px.
      const labels: LayerPaneLabel[] = [
        { face: 0, tone: 'pick', keep: true },
        { face: 1, tone: 'pick', keep: true },
      ];
      const placed = placeLabels(labels, spotsOf, (f) => 'AB'[f]!, (p) => p, { lines: labelLineIndex([...sides(thin), ...mesh]) });
      expect(placed).toHaveLength(2);
      expect(placed.every((chip) => chip.off)).toBe(true);
      expect(overlap(placed[0]!, placed[1]!)).toBe(false);
      // As with no lines, where nothing is clear of a crease either.
      expect(at(placed)).toEqual(at(placeLabels(labels, spotsOf, (f) => 'AB'[f]!, (p) => p)));
    });

    it('with no clear spot, keeps the letters of two small faces 10 px apart from each other', () => {
      const other = square(110, 100, 8);
      const labels: LayerPaneLabel[] = [
        { face: 0, tone: 'pick', keep: true },
        { face: 1, tone: 'pick', keep: true },
      ];
      const twoOf = (face: number): LayerLabelSpots =>
        face === 0 ? spotsOf() : { visible: true, spots: [{ at: { x: 114, y: 104 }, region: other }], outline: other };
      const lines = labelLineIndex([...sides(thin), ...sides(other), ...mesh]);
      const placed = placeLabels(labels, twoOf, (f) => 'AB'[f]!, (p) => p, { lines });
      expect(placed).toHaveLength(2);
      expect(placed.every((chip) => chip.off)).toBe(true);
      expect(overlap(placed[0]!, placed[1]!)).toBe(false);
    });

    it('takes a spot beside the face over a crease before the one crease-free spot another letter holds', () => {
      // Clear of creases only straight over the face, where the first letter goes; the second must not land on it.
      const above = mesh.filter(([a, b]) => !(Math.max(a.y, b.y) < 92 && Math.min(a.y, b.y) < 92 && a.y === b.y) && !(a.x === b.x && a.x > 80 && a.x < 128));
      const lines = labelLineIndex([...sides(thin), ...above.map(([a, b]): LayerPaneSegment => (a.x === b.x ? [a, { x: b.x, y: Math.min(b.y, 600) }] : [a, b]))]);
      const labels: LayerPaneLabel[] = [
        { face: 0, tone: 'pick', keep: true },
        { face: 1, tone: 'pick', keep: true },
      ];
      const placed = placeLabels(labels, spotsOf, (f) => 'AB'[f]!, (p) => p, { lines });
      expect(placed).toHaveLength(2);
      expect(overlap(placed[0]!, placed[1]!)).toBe(false);
      expect(placed.every((chip) => chip.off)).toBe(true);
    });

    it('keeps clear of the widest line the pane draws, an aux pen wider than the line along a face', () => {
      // A crease 25 px right of the face: 4.3 px clear of the chip set beside it, by the face's 0 px line.
      const crease = down(133);
      const lines = labelLineIndex([...sides(thin), across(88), across(120), crease]);
      const narrow = placeLabels(label, spotsOf, () => 'A', (p) => p, { lines })[0]!;
      expect([narrow.x, narrow.y]).toEqual([120, 104]);
      expect(covers(narrow, crease, 3)).toBe(false);
      expect(covers(narrow, crease, 3 + 4)).toBe(true);
      // Drawn 8 px wide, it needs 4 + 3 px: the letter goes the other way; the room inside a face is unchanged.
      const wide = placeLabels(label, spotsOf, () => 'A', (p) => p, { lines, linesPx: 8 })[0]!;
      expect(covers(wide, crease, 4 + 3)).toBe(false);
      expect(wide.off).toBe(true);
      const roomy30 = placeLabels(label, () => roomy(30, 30), () => 'A', (p) => p, { lines, linesPx: 8 });
      expect(at(roomy30)).toEqual([[0, 30, 30, false, false]]);
    });

    it('does not dodge an aux line the paper leaves out', () => {
      // Face 0 is the small face; face 1, over it on the paper, carries an aux line 12 px over face 0.
      const big = [
        { x: 60, y: 60 },
        { x: 160, y: 60 },
        { x: 160, y: 100 },
        { x: 60, y: 100 },
      ];
      const scene: OristudioCpFoldedPaperScene = {
        schema_version: 3,
        flipped: false,
        sheet: 200,
        faces: [thin, big].map((outline) => ({
          outline,
          points: [],
          front_up: true,
          edges: outline.map((from, i) => ({ from, to: outline[(i + 1) % outline.length]!, kind: 'border' as const })),
        })),
        subfaces: [
          { polygon: thin, faces_top_to_bottom: [0] },
          { polygon: big, faces_top_to_bottom: [1] },
        ],
        aux_lines: [{ from: { x: 60, y: 88 }, to: { x: 160, y: 88 }, face: 1 }],
        sheet_points: [],
      };
      const spots = foldedLabelIndex(scene);
      const place = (aux: boolean) =>
        placeLabels(label, spots, () => 'A', (p) => p, { lines: labelLineIndex(foldedPaneLines(scene, false, aux)) })[0]!;
      const shown = place(true);
      expect(covers(shown, across(88, 60, 160), 3)).toBe(false);
      // With the aux pen left out, the line is not there to dodge: straight over the face, as with no lines.
      const hidden = place(false);
      expect([hidden.x, hidden.y]).toEqual([104, 88]);
      expect([hidden.x, hidden.y]).not.toEqual([shown.x, shown.y]);
    });

    it('with no clear spot, falls back as before: beside the face, whatever it covers', () => {
      const lines = labelLineIndex([...sides(thin), ...mesh]);
      const plain = placeLabels(label, spotsOf, () => 'A', (p) => p);
      const meshed = placeLabels(label, spotsOf, () => 'A', (p) => p, { lines });
      expect(at(meshed)).toEqual(at(plain));
      expect(meshed[0]!.off).toBe(true);
    });

    it('with no clear spot, beside its face over a crease comes before inside it over another letter, as before', () => {
      // The subject's letter takes the one spot of a roomy face; the object's face is the same face.
      const labels: LayerPaneLabel[] = [
        { face: 0, tone: 'pick', keep: true },
        { face: 1, tone: 'pick', keep: true },
      ];
      const face = roomy(200, 200, 40);
      const plain = placeLabels(labels, () => face, (f) => 'AB'[f]!, (p) => p);
      const meshed = placeLabels(labels, () => face, (f) => 'AB'[f]!, (p) => p, { lines: labelLineIndex(mesh) });
      const object = meshed.find((chip) => chip.face === 1)!;
      expect(object.off).toBe(true);
      expect(overlap(object, meshed.find((chip) => chip.face === 0)!)).toBe(false);
      // Where it went with no lines: nothing near is clear of a crease, so the lines change nothing.
      expect(at(meshed)).toEqual(at(plain));
    });

    it('changes no letter with no lines, nor one that fits inside its face', () => {
      const lines = labelLineIndex(mesh);
      const roomyLabel: LayerPaneLabel[] = [{ face: 0, tone: 'pick', keep: true }];
      expect(at(placeLabels(roomyLabel, () => roomy(30, 30), () => 'A', (p) => p, { lines }))).toEqual([[0, 30, 30, false, false]]);
      expect(at(placeLabels(label, spotsOf, () => 'A', (p) => p, { lines: null }))).toEqual(
        at(placeLabels(label, spotsOf, () => 'A', (p) => p))
      );
      expect(labelLineIndex([])).toBeNull();
    });
  });

  it('places in the pane’s pixels, through the projection', () => {
    const placed = placeLabels(
      [{ face: 0, tone: 'pick', keep: true }],
      () => roomy(3, 3, 6),
      () => 'A',
      ({ x, y }) => ({ x: x * 10, y: y * 10 })
    );
    expect(at(placed)).toEqual([[0, 30, 30, false, false]]);
  });

  it('leaves out a face with no letter or nowhere to sit', () => {
    const placed = placeLabels(
      [
        { face: 0, tone: 'plain', keep: true },
        { face: 1, tone: 'plain', keep: true },
      ],
      (face) => (face === 0 ? { visible: true, spots: [], outline: [] } : roomy(0, 0)),
      (face) => (face === 1 ? '' : 'A'),
      (p) => p
    );
    expect(placed).toEqual([]);
  });
});
