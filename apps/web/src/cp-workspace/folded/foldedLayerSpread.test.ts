/**
 * Layers stepped apart by depth, on folds small enough to work out by hand.
 *
 * The figures are in the kernel's shape: a unit square of paper per layer,
 * each face naming its sheet vertices as the kernel does
 * (`OristudioCpFoldedPaperFace.points`). The spread is read at 5% of a model
 * one unit across, drawn 100 scene px per unit: the deepest layer steps 5 px.
 */

import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFoldedPaperFace,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedPaperSubface,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { foldedPaintOrder, foldedSceneEpsilon, wovenDrawOrder } from './foldedFlatScene';
import {
  affineSpread,
  foldedModelSize,
  layerLevels,
  layerSpread,
  meanValueWeights,
  SPREAD_DIRECTIONS,
  spreadUnit,
  type AffineSpreadOptions,
  type DepthSpreadOptions,
} from './foldedLayerSpread';

const point = (x: number, y: number): Point => ({ x, y });

function face(corners: Array<[number, number]>, points: number[], frontUp = true): OristudioCpFoldedPaperFace {
  const outline = corners.map(([x, y]) => point(x, y));
  return {
    outline,
    points,
    front_up: frontUp,
    edges: outline.map((from, i) => ({ from, to: outline[(i + 1) % outline.length]!, kind: 'border' })),
  };
}

const UNIT: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function square(stack: number[]): OristudioCpFoldedPaperSubface {
  return { polygon: UNIT.map(([x, y]) => point(x, y)), faces_top_to_bottom: stack };
}

function scene(faces: OristudioCpFoldedPaperFace[], subfaces: OristudioCpFoldedPaperSubface[]): OristudioCpFoldedPaperScene {
  return { schema_version: 2, flipped: false, sheet: 3, faces, subfaces, aux_lines: [], sheet_points: [] };
}

/**
 * A 2 × 1 sheet folded in half: the right square over onto the left. Sheet
 * vertices 0 1 2 along the bottom, 3 4 5 along the top; the fold is 1–4.
 */
const UNDER = 0;
const OVER = 1;
function bookFold(): OristudioCpFoldedPaperScene {
  return scene(
    [
      face(UNIT, [0, 1, 4, 3]),
      // Folded over: 2 lands on 0's place and 5 on 3's.
      face([[1, 0], [0, 0], [0, 1], [1, 1]], [1, 2, 5, 4], false),
    ],
    [square([OVER, UNDER])]
  );
}

/**
 * A 3 × 1 sheet rolled: the right panel folded in over the middle one, then
 * the two over onto the left. The tucked panel ends up between the others.
 * Sheet vertices 0–3 along the bottom, 4–7 along the top.
 */
const LEFT = 0;
const MIDDLE = 1;
const TUCKED = 2;
function letterFold(): OristudioCpFoldedPaperScene {
  return scene(
    [
      face(UNIT, [0, 1, 5, 4]),
      face([[1, 0], [0, 0], [0, 1], [1, 1]], [1, 2, 6, 5], false),
      face([[0, 0], [1, 0], [1, 1], [0, 1]], [2, 3, 7, 6]),
    ],
    [square([MIDDLE, TUCKED, LEFT])]
  );
}

const SPREAD: DepthSpreadOptions = { kind: 'depth', amount: 0.05, toward: 'up-left' };
const FRAME = { scale: 100, epsilon: 1e-9 };

function spreadOf(kernel: OristudioCpFoldedPaperScene, options = SPREAD) {
  return layerSpread(kernel, foldedPaintOrder(kernel), options, FRAME);
}

/** A step of `px` scene px up and to the left. */
const upLeft = (px: number): ScenePoint => [-px * Math.SQRT1_2, -px * Math.SQRT1_2];

function expectStep(actual: ScenePoint, expected: ScenePoint): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe('levels', () => {
  it('counts the layers over a face: the book’s top leaf 0, the leaf under it 1', () => {
    const kernel = bookFold();
    const { levels, zMax } = spreadOf(kernel);
    expect([...levels]).toEqual([1, 0]);
    expect(zMax).toBe(1);
  });

  it('puts the tucked panel of a rolled letter fold between the others', () => {
    const kernel = letterFold();
    expect(foldedPaintOrder(kernel)).toEqual([LEFT, TUCKED, MIDDLE]);
    const { levels, zMax } = spreadOf(kernel);
    expect([levels[MIDDLE], levels[TUCKED], levels[LEFT]]).toEqual([0, 1, 2]);
    expect(zMax).toBe(2);
  });

  it('takes the longest chain over a face, through other faces’ stacks', () => {
    // 0 over 1 in one place, 1 over 2 in another, 0 over 2 directly in a
    // third: 2 is two layers down, not one.
    const stacks = [[0, 1], [1, 2], [0, 2]].map((stack) => ({ polygon: [], faces_top_to_bottom: stack }));
    const { levels, zMax } = layerLevels(3, stacks, [2, 1, 0]);
    expect([...levels]).toEqual([0, 1, 2]);
    expect(zMax).toBe(2);
  });

  it('leaves a face in no stack at 0', () => {
    const { levels } = layerLevels(3, [{ polygon: [], faces_top_to_bottom: [0, 1] }], [1, 0, 2]);
    expect([...levels]).toEqual([0, 1, 0]);
  });

  it('breaks a woven three-flap cycle where the painter’s order broke it', () => {
    // A over B, B over C, C over A, each in its own place; all three over a
    // base D. The order draws C under A — the lightest "draw after" — so the
    // C-over-A pair is the one left out.
    const [A, B, C, D] = [0, 1, 2, 3];
    const after = new Map([
      [A, new Map([[B, 5]])],
      [B, new Map([[C, 5]])],
      [C, new Map([[A, 1]])],
    ]);
    const woven = wovenDrawOrder([A, B, C], after);
    expect(woven).toEqual([C, B, A]);
    const stacks = [[A, B], [B, C], [C, A], [A, D], [B, D], [C, D]].map((stack) => ({
      polygon: [],
      faces_top_to_bottom: stack,
    }));
    const { levels, zMax } = layerLevels(4, stacks, [D, ...woven]);
    expect([levels[A], levels[B], levels[C], levels[D]]).toEqual([0, 1, 2, 3]);
    expect(zMax).toBe(3);
  });

  it('spreads nothing when nothing is stacked', () => {
    const kernel = scene([face(UNIT, [0, 1, 2, 3])], [square([0])]);
    const spread = spreadOf(kernel);
    expect(spread.zMax).toBe(0);
    expect(spread.offset(0, point(0, 0))).toEqual([0, 0]);
  });
});

describe('vertex steps', () => {
  it('steps the book’s fold by half the leaf under it, and keeps it joined', () => {
    const kernel = bookFold();
    const { offset } = spreadOf(kernel);
    // Under leaf: its free corners (0, 3) step the whole 5 px, the fold's
    // ends (1, 4) half that.
    expectStep(offset(UNDER, point(0, 0)), upLeft(5));
    expectStep(offset(UNDER, point(0, 1)), upLeft(5));
    expectStep(offset(UNDER, point(1, 0)), upLeft(2.5));
    expectStep(offset(UNDER, point(1, 1)), upLeft(2.5));
    // Top leaf: its free corners (2, 5) — folded onto 0's and 3's places —
    // stay; the fold's ends step as the under leaf's do.
    expectStep(offset(OVER, point(0, 0)), [0, 0]);
    expectStep(offset(OVER, point(0, 1)), [0, 0]);
    expectStep(offset(OVER, point(1, 0)), upLeft(2.5));
    // Along the fold, both leaves move alike: the crease stays one line.
    expectStep(offset(UNDER, point(1, 0.3)), upLeft(2.5));
    expectStep(offset(OVER, point(1, 0.3)), upLeft(2.5));
    // Inside, the mean of the corners: (1 + 1 + ½ + ½) / 4 and (0 + 0 + ½ + ½) / 4.
    expectStep(offset(UNDER, point(0.5, 0.5)), upLeft(3.75));
    expectStep(offset(OVER, point(0.5, 0.5)), upLeft(1.25));
  });

  it('steps a rolled letter fold’s vertices by the mean of the levels round them', () => {
    const kernel = letterFold();
    const { offset } = spreadOf(kernel);
    // Levels 2 (left), 0 (middle), 1 (tucked), out of 2: vertex 0 is the
    // left panel's alone, 1 joins left and middle, 2 middle and tucked, 3 is
    // the tucked panel's alone.
    expectStep(offset(LEFT, point(0, 0)), upLeft(5)); // vertex 0: 2/2
    expectStep(offset(LEFT, point(1, 0)), upLeft(2.5)); // vertex 1: (2 + 0)/2 /2
    expectStep(offset(MIDDLE, point(0, 0)), upLeft(1.25)); // vertex 2: (0 + 1)/2 /2
    expectStep(offset(TUCKED, point(0, 0)), upLeft(1.25)); // vertex 2 again
    expectStep(offset(TUCKED, point(1, 0)), upLeft(2.5)); // vertex 3: 1/2
    // The tucked panel's free edge steps exactly as the fold over it, so it
    // lies along that fold and does not poke past it.
    expectStep(offset(TUCKED, point(1, 0.5)), offset(LEFT, point(1, 0.5)));
  });

  it('steps a face the kernel could not name whole, by its own level', () => {
    const kernel = bookFold();
    kernel.faces[UNDER]!.points = [];
    const { offset } = spreadOf(kernel);
    for (const corner of kernel.faces[UNDER]!.outline) expectStep(offset(UNDER, corner), upLeft(5));
    // Its vertices no longer count toward the fold's: the top leaf's corners
    // there step by the top leaf's level alone.
    expectStep(offset(OVER, point(1, 0)), [0, 0]);
  });

  it('counts a face in no stack at level 0 at the vertices it shares', () => {
    // The book again, with a third face beside the fold that no subface
    // stacks: it shares vertex 1 with the under leaf.
    const kernel = bookFold();
    kernel.faces.push(face([[1, 0], [2, 0], [2, -1]], [1, 6, 7]));
    const { levels, offset } = spreadOf(kernel);
    expect(levels[2]).toBe(0);
    // The model is two units across now, so the deepest step is 10 px.
    // Vertex 1: under (1), over (0), beside (0) → ⅓ of that.
    expectStep(offset(UNDER, point(1, 0)), upLeft(10 / 3));
    expectStep(offset(2, point(2, 0)), [0, 0]);
  });
});

describe('meanValueWeights', () => {
  const unit = UNIT.map(([x, y]) => point(x, y));
  const interpolate = (ring: readonly Point[], weights: number[]): Point =>
    weights.reduce((sum, w, i) => point(sum.x + w * ring[i]!.x, sum.y + w * ring[i]!.y), point(0, 0));

  it('weighs a square’s centre equally, and is a corner’s own there', () => {
    expect(meanValueWeights(unit, point(0.5, 0.5), 1e-9)!.map((w) => Number(w.toFixed(12)))).toEqual([
      0.25, 0.25, 0.25, 0.25,
    ]);
    expect(meanValueWeights(unit, point(1, 1), 1e-9)).toEqual([0, 0, 1, 0]);
    // Within epsilon of a corner counts as on it.
    expect(meanValueWeights(unit, point(1 + 1e-10, 1), 1e-9)).toEqual([0, 0, 1, 0]);
  });

  it('is linear along an edge: the far corners weigh nothing', () => {
    const weights = meanValueWeights(unit, point(0.25, 0), 1e-9)!;
    expect(weights).toEqual([0.75, 0.25, 0, 0]);
  });

  it('reproduces where a point is, in a square and in a non-convex L', () => {
    const ell = [point(0, 0), point(2, 0), point(2, 1), point(1, 1), point(1, 2), point(0, 2)];
    for (const [ring, inside] of [
      [unit, [point(0.3, 0.7), point(0.9, 0.05)]],
      // Either arm, the corner by the reflex vertex, and on the reflex edges.
      [ell, [point(0.5, 1.5), point(1.5, 0.5), point(0.9, 0.9), point(1, 1.5), point(1.5, 1)]],
    ] as const) {
      for (const p of inside) {
        const weights = meanValueWeights(ring, p, 1e-9)!;
        expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        const back = interpolate(ring, weights);
        expect(back.x).toBeCloseTo(p.x, 12);
        expect(back.y).toBeCloseTo(p.y, 12);
      }
    }
    // On the L's reflex edge (1,1)→(1,2), only its ends weigh.
    expect(meanValueWeights(ell, point(1, 1.5), 1e-9)).toEqual([0, 0, 0, 0.5, 0.5, 0]);
  });

  it('turns either way alike', () => {
    const reversed = [...unit].reverse();
    const forward = meanValueWeights(unit, point(0.2, 0.6), 1e-9)!;
    const backward = meanValueWeights(reversed, point(0.2, 0.6), 1e-9)!;
    forward.forEach((w, i) => expect(backward[unit.length - 1 - i]).toBeCloseTo(w, 12));
  });

  it('has nothing to say about a ring with no inside', () => {
    expect(meanValueWeights([], point(0, 0), 1e-9)).toBeNull();
    expect(meanValueWeights([point(1, 1), point(1, 1), point(1, 1)], point(0, 0), 1e-9)).toBeNull();
  });
});

describe('direction and amount', () => {
  it('names eight screen directions, y down', () => {
    const r = Math.SQRT1_2;
    expect(Object.fromEntries(SPREAD_DIRECTIONS.map((d) => [d, spreadUnit(d)]))).toEqual({
      'up-left': [-r, -r],
      up: [0, -1],
      'up-right': [r, -r],
      right: [1, 0],
      'down-right': [r, r],
      down: [0, 1],
      'down-left': [-r, r],
      left: [-1, 0],
    });
  });

  it('steps the deepest layer the amount of the model’s longest side, in scene px', () => {
    // The letter fold is one unit across: at 100 px per unit, 20% is 20 px.
    const kernel = letterFold();
    const { offset } = layerSpread(kernel, foldedPaintOrder(kernel), { amount: 0.2, toward: 'down' }, FRAME);
    expectStep(offset(LEFT, point(0, 0)), [0, 20]);
    const wide = { ...kernel, faces: kernel.faces.map((f) => ({ ...f, outline: f.outline.map((p) => point(p.x * 3, p.y)) })) };
    expect(foldedModelSize(wide)).toBe(3);
    const step = layerSpread(wide, foldedPaintOrder(wide), { amount: 0.2, toward: 'right' }, FRAME).offset(LEFT, point(0, 0));
    expectStep(step, [60, 0]);
  });

  it('measures the model by its folded faces’ bounds, and nothing when there are none', () => {
    // A turn is applied to the picture after the kernel's figure, so the
    // size is the same however the pose turns it (`foldedFlatScene.test.ts`
    // turns a real fold to see the step stay put).
    expect(foldedModelSize(bookFold())).toBe(1);
    expect(foldedModelSize({ faces: [] })).toBe(0);
  });

  it('reads points on a corner or an edge at the scene’s own tolerance', () => {
    // 1e-5 of the sheet: a hair off the fold is still on it.
    const kernel = bookFold();
    const { offset } = layerSpread(kernel, foldedPaintOrder(kernel), SPREAD, {
      scale: 100,
      epsilon: foldedSceneEpsilon(kernel),
    });
    expectStep(offset(UNDER, point(1 + 1e-6, 0.4)), upLeft(2.5));
  });
});

/**
 * DEFOX's affine opening, on the same folds with the sheet under them: the
 * book's sheet is 2 × 1 (vertices 0 1 2 along the bottom, 3 4 5 along the
 * top), the letter's 3 × 1 (0–3 and 4–7). τ is 10%, so p = τ / (1 − τ) is
 * 1/9: a point moves τ of the way toward its place on the sheet along the
 * axis, and p / (1 − p) = 1/8 of it away across the axis at full skew.
 */
describe('affine opening', () => {
  const BOOK_SHEET = [point(0, 0), point(1, 0), point(2, 0), point(0, 1), point(1, 1), point(2, 1)];
  const LETTER_SHEET = [0, 1, 2, 3].map((x) => point(x, 0)).concat([0, 1, 2, 3].map((x) => point(x, 1)));
  const OPEN: Omit<AffineSpreadOptions, 'kind'> = { amount: 0.1, keep: 'bottom', skew: 0, axisDeg: 0 };
  const EPSILON = { epsilon: 1e-9 };

  const book = () => ({ ...bookFold(), sheet_points: BOOK_SHEET });
  const letter = () => ({ ...letterFold(), sheet_points: LETTER_SHEET });

  function expectMove(actual: Point, expected: [number, number]): void {
    expect(actual.x).toBeCloseTo(expected[0], 12);
    expect(actual.y).toBeCloseTo(expected[1], 12);
  }

  it('holds the bottom leaf still and lerps the top one τ of the way back to the sheet, at no skew', () => {
    const spread = affineSpread(book(), OPEN, EPSILON);
    expect(spread.anchor).toBe(UNDER);
    for (const corner of book().faces[UNDER]!.outline) expectMove(spread.offset(UNDER, corner), [0, 0]);
    // The top leaf's free corners, 2 and 5, folded onto (0, 0) and (0, 1):
    // their places on the sheet are (2, 0) and (2, 1), so 0.2 to the right.
    expectMove(spread.offset(OVER, point(0, 0)), [0.2, 0]);
    expectMove(spread.offset(OVER, point(0, 1)), [0.2, 0]);
    // The fold is where it lies on the sheet already.
    expectMove(spread.offset(OVER, point(1, 0)), [0, 0]);
    // Inside, the same lerp: (0.5, 0.5) lies at (1.5, 0.5) on the sheet.
    expectMove(spread.offset(OVER, point(0.5, 0.5)), [0.1, 0]);
  });

  it('holds the top leaf still instead, and opens the one under it', () => {
    const spread = affineSpread(book(), { ...OPEN, keep: 'top' }, EPSILON);
    expect(spread.anchor).toBe(OVER);
    for (const corner of book().faces[OVER]!.outline) expectMove(spread.offset(OVER, corner), [0, 0]);
    // Laid under the top leaf (x → 2 − x), the bottom leaf's free corner 0 lies at (2, 0).
    expectMove(spread.offset(UNDER, point(0, 0)), [0.2, 0]);
    expectMove(spread.offset(UNDER, point(1, 1)), [0, 0]);
    // The axis is the sheet's: held through the folded-over leaf, 45° on the
    // sheet is 135° in the picture, so the way back, (2, 0), is (1, −1) along
    // it and (1, 1) across it.
    const skewed = affineSpread(book(), { ...OPEN, keep: 'top', skew: 1, axisDeg: 45 }, EPSILON);
    expectMove(skewed.offset(UNDER, point(0, 0)), [0.1 - 0.125, -0.1 - 0.125]);
  });

  it('moves toward the sheet along the axis and away across it, at full skew', () => {
    // Corner 2 is 2 units from its place on the sheet, along x.
    const along = affineSpread(book(), { ...OPEN, skew: 1, axisDeg: 0 }, EPSILON);
    expectMove(along.offset(OVER, point(0, 0)), [0.2, 0]);
    const across = affineSpread(book(), { ...OPEN, skew: 1, axisDeg: 90 }, EPSILON);
    expectMove(across.offset(OVER, point(0, 0)), [-0.25, 0]);
    // At 45° (+x toward +y, the sheet's y down) the way to the sheet, (2, 0), is
    // (1, 1) along the axis and (1, −1) across it: τ of the one, −1/8 of the other.
    const diagonal = affineSpread(book(), { ...OPEN, skew: 1, axisDeg: 45 }, EPSILON);
    expectMove(diagonal.offset(OVER, point(0, 0)), [0.1 - 0.125, 0.1 + 0.125]);
    // A = p((1 − q)I + qR): halfway, along x across a vertical axis, p(½ − ½) = 0.
    const half = affineSpread(book(), { ...OPEN, skew: 0.5, axisDeg: 90 }, EPSILON);
    expectMove(half.offset(OVER, point(0, 0)), [0, 0]);
    // The anchor stays still at any skew and axis.
    expectMove(diagonal.offset(UNDER, point(0, 0)), [0, 0]);
  });

  it('turns the opening with the kernel’s frame, whichever leaf is held still (review)', () => {
    // A turn of 30°: neither the identity nor a reflection, for which the
    // sheet's axis carried into the scene (M·A·M⁻¹) and carried the other way
    // (M⁻¹·A·M) agree.
    const angle = (30 * Math.PI) / 180;
    const turn = (p: Point) => point(p.x * Math.cos(angle) - p.y * Math.sin(angle), p.x * Math.sin(angle) + p.y * Math.cos(angle));
    const plain = book();
    const turned = {
      ...plain,
      faces: plain.faces.map((each) => ({
        ...each,
        outline: each.outline.map(turn),
        edges: each.edges.map((edge) => ({ ...edge, from: turn(edge.from), to: turn(edge.to) })),
      })),
      subfaces: plain.subfaces.map((each) => ({ ...each, polygon: each.polygon.map(turn) })),
    };
    for (const keep of ['bottom', 'top'] as const) {
      const options = { ...OPEN, keep, skew: 1, axisDeg: 45 };
      const upright = affineSpread(plain, options, EPSILON);
      const shown = affineSpread(turned, options, EPSILON);
      expect(shown.anchor).toBe(upright.anchor);
      plain.faces.forEach(({ outline }, index) => {
        for (const corner of outline) {
          const moved = turn(upright.offset(index, corner));
          expectMove(shown.offset(index, turn(corner)), [moved.x, moved.y]);
        }
      });
    }
  });

  it('opens a rolled letter fold from its bottom panel or its top one', () => {
    // Bottom: the left panel still. The middle one's free edge (2, 6) lies at
    // x = 2 on the sheet, folded onto 0; the tucked panel's far edge (3, 7) at
    // x = 3, folded onto 1. Both go 0.2 right — the tucked panel past the
    // fold 1–5 that wraps it, as DEFOX's opening does.
    const bottom = affineSpread(letter(), OPEN, EPSILON);
    expect(bottom.anchor).toBe(LEFT);
    expectMove(bottom.offset(LEFT, point(0, 0)), [0, 0]);
    expectMove(bottom.offset(MIDDLE, point(1, 0)), [0, 0]);
    expectMove(bottom.offset(MIDDLE, point(0, 0)), [0.2, 0]);
    expectMove(bottom.offset(TUCKED, point(1, 1)), [0.2, 0]);
    // Top: the middle panel still, laid on the sheet by x → 2 − x. The left
    // panel's free edge lies at x = 2 there, so 0.2 right; the tucked one's
    // far edge at x = −1, so 0.2 left — inside the fold, not past it.
    const top = affineSpread(letter(), { ...OPEN, keep: 'top' }, EPSILON);
    expect(top.anchor).toBe(MIDDLE);
    expectMove(top.offset(MIDDLE, point(0, 1)), [0, 0]);
    expectMove(top.offset(LEFT, point(0, 0)), [0.2, 0]);
    expectMove(top.offset(LEFT, point(1, 0)), [0, 0]);
    expectMove(top.offset(TUCKED, point(1, 0)), [-0.2, 0]);
    expectMove(top.offset(TUCKED, point(0, 0)), [0, 0]);
  });

  it('opens a turned-over pass as the front’s mirror, holding the same paper still', () => {
    const front = book();
    // The rear pass: mirrored (x → −x), every stack read bottom-up, each side flipped.
    const back = {
      ...front,
      flipped: true,
      faces: front.faces.map((f) => ({ ...f, outline: f.outline.map((p) => point(-p.x, p.y)), front_up: !f.front_up })),
      subfaces: front.subfaces.map((s) => ({
        polygon: s.polygon.map((p) => point(-p.x, p.y)),
        faces_top_to_bottom: [...s.faces_top_to_bottom].reverse(),
      })),
    };
    for (const keep of ['bottom', 'top'] as const) {
      const options = { ...OPEN, keep, skew: 0.7, axisDeg: 30 };
      const seen = affineSpread(front, options, EPSILON);
      const turned = affineSpread(back, options, EPSILON);
      expect(turned.anchor, keep).toBe(seen.anchor);
      let moved = false;
      front.faces.forEach(({ outline }, face) =>
        outline.forEach((p) => {
          const move = seen.offset(face, p);
          moved ||= Math.hypot(move.x, move.y) > 0.01;
          expectMove(turned.offset(face, point(-p.x, p.y)), [-move.x, move.y]);
        })
      );
      expect(moved, keep).toBe(true);
    }
  });

  it('holds still the top or bottom face over the most area, the lower index on a tie', () => {
    // A strip over two faces side by side, the right one twice as wide.
    const [LEFT_SQUARE, RIGHT_WIDE, STRIP] = [0, 1, 2];
    const sheet = [point(0, 0), point(1, 0), point(1, 1), point(0, 1), point(3, 0), point(3, 1), point(0, 2), point(3, 2)];
    const kernel = {
      ...scene(
        [
          face(UNIT, [0, 1, 2, 3]),
          face([[1, 0], [3, 0], [3, 1], [1, 1]], [1, 4, 5, 2]),
          face([[0, 1], [3, 1], [3, 0], [0, 0]], [3, 5, 7, 6], false),
        ],
        [
          { polygon: UNIT.map(([x, y]) => point(x, y)), faces_top_to_bottom: [STRIP, LEFT_SQUARE] },
          { polygon: [point(1, 0), point(3, 0), point(3, 1), point(1, 1)], faces_top_to_bottom: [STRIP, RIGHT_WIDE] },
        ]
      ),
      sheet_points: sheet,
    };
    expect(affineSpread(kernel, OPEN, EPSILON).anchor).toBe(RIGHT_WIDE);
    expect(affineSpread(kernel, { ...OPEN, keep: 'top' }, EPSILON).anchor).toBe(STRIP);
    // Made as wide as each other, the left square wins.
    kernel.subfaces[1]!.polygon = [point(1, 0), point(2, 0), point(2, 1), point(1, 1)];
    expect(affineSpread(kernel, OPEN, EPSILON).anchor).toBe(LEFT_SQUARE);
  });

  it('leaves a face the kernel could not name where it is, and holds none still without the sheet', () => {
    const unnamed = book();
    unnamed.faces[OVER]!.points = [];
    const spread = affineSpread(unnamed, OPEN, EPSILON);
    expect(spread.anchor).toBe(UNDER);
    expectMove(spread.offset(OVER, point(0, 0)), [0, 0]);
    // Only an unnamed face on top: there is nothing to hold, so nothing moves.
    expect(affineSpread(unnamed, { ...OPEN, keep: 'top' }, EPSILON).anchor).toBeNull();
    // A scene of the schema before the sheet was sent: the same.
    const older = affineSpread(bookFold(), OPEN, EPSILON);
    expect(older.anchor).toBeNull();
    expectMove(older.offset(OVER, point(0, 0)), [0, 0]);
  });
});
