import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cubicPoint } from '../../lib/cubicBezier';
import { readFontMetrics } from '../fonts/fontMetrics';
import { LABEL_ADVANCES, LABEL_ADVANCES_FROM } from './labelAdvances';
import type { DiagramPathNode, KnownDiagramAnnotation } from '../document/diagramDocument';
import { arcToPath, bendPathSegment, pathNodesOf } from './annotationPath';
import {
  ANNOTATION_KINDS,
  ANNOTATION_REACH,
  ARROW_BEND,
  DEFAULT_WHITE_ARROW,
  MAX_PATH_NODES,
  MIN_ANNOTATION_LENGTH,
  canBeShaped,
  flipsArc,
  isShapedArrow,
  CALLOUT_GAP,
  CALLOUT_HALF_HEIGHT_EMS,
  CALLOUT_PAD_EMS,
  CALLOUT_TEXT_SIZE,
  LABEL_MAX_LENGTH,
  NEW_CALLOUT_TEXT,
  annotationEnds,
  arrowApex,
  arrowShape,
  calloutHalfBox,
  calloutShape,
  carriesText,
  carryAnnotation,
  cleanAnnotation,
  createAnnotation,
  defaultBend,
  flipAnnotationArc,
  frameOf,
  isDegenerate,
  LABEL_SIZE,
  labelHalfWidth,
  mirrorMove,
  moveAnnotation,
  moveAnnotationEnd,
  pathCubics,
  RIGHT_ANGLE_DIAGONAL,
  rightAngleAt,
  rightAngleDiagonal,
  turnRightAngle,
  placedByClick,
  textEms,
  type PictureMove,
  type PicturePoint,
} from './annotationModel';

const SQUARE = { width: 1, height: 1 };
const id = () => 'annotation-1';

describe('a new annotation', () => {
  it('puts a sign or a label at the press, with its own defaults', () => {
    expect(createAnnotation('turn-over', [0.2, 0.3], [0.9, 0.9], SQUARE, id)).toEqual({
      id: 'annotation-1',
      kind: 'turn-over',
      from: [0.2, 0.3],
      to: [0.2, 0.3],
      axis: 'vertical',
    });
    expect(createAnnotation('rotate', [0.2, 0.3], [0.2, 0.3], SQUARE, id).rotate).toEqual({
      amount: 'quarter',
      direction: 'cw',
    });
    expect(createAnnotation('label', [0.2, 0.3], [0.2, 0.3], SQUARE, id).text).toBe('A');
  });

  it('draws a line or a push from the drag, with no bulge', () => {
    const line = createAnnotation('hidden-line', [0, 0], [1, 1], SQUARE, id);
    expect(line).toEqual({ id: 'annotation-1', kind: 'hidden-line', from: [0, 0], to: [1, 1] });
  });

  it('bulges a fold arrow toward the picture’s middle, as References does', () => {
    // Along the top, left to right: the middle is below, which is the right of its travel.
    const top = createAnnotation('valley-arrow', [0.2, 0.1], [0.8, 0.1], SQUARE, id);
    expect(top.bend).toBeCloseTo(-ARROW_BEND, 9);
    expect(arrowApex(top.from, top.to, top.bend!)[1]).toBeGreaterThan(0.1);
    // Along the bottom: the middle is above.
    const bottom = createAnnotation('valley-arrow', [0.2, 0.9], [0.8, 0.9], SQUARE, id);
    expect(arrowApex(bottom.from, bottom.to, bottom.bend!)[1]).toBeLessThan(0.9);
    expect(defaultBend([0.2, 0.9], [0.8, 0.9], SQUARE)).toBeCloseTo(ARROW_BEND, 9);
  });
});

describe('an arrow’s arc', () => {
  it('bulges to the left of its travel as the page shows it for a positive bend', () => {
    // Travelling right on a y-down page, left is up.
    const apex = arrowApex([0, 0.5], [1, 0.5], 0.25);
    expect(apex[0]).toBeCloseTo(0.5, 9);
    expect(apex[1]).toBeCloseTo(0.25, 9);
    // A 60° arc's sagitta: 1 − cos 30° of its chord.
    expect(arrowApex([0, 0], [1, 0], ARROW_BEND)[1]).toBeCloseTo(-(1 - Math.cos(Math.PI / 6)), 9);
  });

  it('turns over with Flip arc, and nothing else does', () => {
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'mountain-arrow', from: [0, 0], to: [1, 0], bend: 0.2 };
    expect(flipAnnotationArc(arrow).bend).toBe(-0.2);
    const line: KnownDiagramAnnotation = { id: 'b', kind: 'valley-line', from: [0, 0], to: [1, 0] };
    expect(flipAnnotationArc(line)).toBe(line);
  });
});

describe('moving one', () => {
  const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'push-arrow', from: [0.1, 0.1], to: [0.5, 0.5] };

  it('moves the whole, or one end', () => {
    expect(moveAnnotation(arrow, [0.1, -0.1])).toMatchObject({ from: [0.2, 0], to: [0.6, 0.4] });
    expect(moveAnnotation(arrow, [0, 0])).toBe(arrow);
    expect(moveAnnotationEnd(arrow, 'to', [0.9, 0.9])).toMatchObject({ from: [0.1, 0.1], to: [0.9, 0.9] });
  });

  it('moves a sign whole by either end: it has one place', () => {
    const sign: KnownDiagramAnnotation = { id: 's', kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5] };
    expect(moveAnnotationEnd(sign, 'from', [0.2, 0.2])).toMatchObject({ from: [0.2, 0.2], to: [0.2, 0.2] });
  });

  it('knows a slip from a line', () => {
    expect(isDegenerate({ ...arrow, to: [0.105, 0.1] }, 0.015)).toBe(true);
    expect(isDegenerate(arrow, 0.015)).toBe(false);
    expect(isDegenerate({ id: 'l', kind: 'label', from: [0, 0], to: [0, 0] }, 0.015)).toBe(false);
  });
});

describe('carrying one through its picture’s move', () => {
  it('flips a mirror’s bulge and sense, and turns a turn-over’s axis a quarter turn round', () => {
    const frame = frameOf(400, 300)!;
    expect(frame).toEqual({ width: 1, height: 0.75 });
    const mirror = mirrorMove(frame);
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.4, 0.2], bend: 0.1 };
    expect(carryAnnotation(arrow, mirror)).toMatchObject({ from: [0.9, 0.2], to: [0.6, 0.2], bend: -0.1 });
    const rotate: KnownDiagramAnnotation = {
      id: 'r',
      kind: 'rotate',
      from: [0.5, 0.5],
      to: [0.5, 0.5],
      rotate: { amount: 'half', direction: 'cw' },
    };
    expect(carryAnnotation(rotate, mirror).rotate).toEqual({ amount: 'half', direction: 'ccw' });
    const turnOver: KnownDiagramAnnotation = { id: 't', kind: 'turn-over', from: [0, 0], to: [0, 0], axis: 'vertical' };
    const quarter = { point: (point: [number, number]) => point, mirrors: false, turnDeg: 90 };
    expect(carryAnnotation(turnOver, quarter).axis).toBe('horizontal');
    expect(carryAnnotation(turnOver, { ...quarter, turnDeg: 180 }).axis).toBe('vertical');
    expect(carryAnnotation(turnOver, { ...quarter, turnDeg: 15 }).axis).toBe('vertical');
  });
});

describe('keeping within reach', () => {
  it('stops an end, a new annotation and a carried point at the reach the file reads', () => {
    const line: KnownDiagramAnnotation = { id: 'l', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
    expect(moveAnnotationEnd(line, 'from', [-6, 0.5]).from).toEqual([-4, 0.5]);
    expect(createAnnotation('push-arrow', [-9, 0], [0, 9], SQUARE, id)).toMatchObject({ from: [-4, 0], to: [0, 4] });
    const mirror = mirrorMove({ width: 1, height: 1 });
    expect(carryAnnotation({ ...line, from: [-3.5, 0.5] }, mirror).from).toEqual([4, 0.5]);
  });

  it('moves a body only as far as keeps it whole', () => {
    const line: KnownDiagramAnnotation = { id: 'l', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
    const moved = moveAnnotation(line, [-9, 0]);
    expect(moved.from[0]).toBeCloseTo(-4, 9);
    expect(moved.to[0] - moved.from[0]).toBeCloseTo(0.8, 9);
  });
});

describe('a label’s width', () => {
  it('counts a wide character as an em and Latin as wide as its font sets it', () => {
    expect(labelHalfWidth('漢字漢字')).toBeCloseTo(LABEL_SIZE * (4 / 2 + 0.2), 12);
    expect(labelHalfWidth('iii')).toBeLessThan(labelHalfWidth('MMM') / 2);
    // A combining mark adds nothing; a letter the table has no width for, an em.
    expect(labelHalfWidth('e\u0301')).toBeCloseTo(labelHalfWidth('e'), 12);
    // Cyrillic and Greek as the font sets them (review: each was an em, a Russian callout twice as wide as its words).
    expect(labelHalfWidth('Ж')).toBeCloseTo(LABEL_SIZE * ((LABEL_ADVANCES[0x416 - LABEL_ADVANCES_FROM]! / 1000) / 2 + 0.2), 12);
    expect(labelHalfWidth('Ж')).toBeLessThan(labelHalfWidth('Ա'));
    expect(labelHalfWidth('Ա')).toBeCloseTo(LABEL_SIZE * (1 / 2 + 0.2), 12);
    // A joiner and a variation selector draw nothing: a family of three is three emoji wide, not five.
    expect(labelHalfWidth('🧑\u200d🤝\u200d🧑')).toBeCloseTo(LABEL_SIZE * (3 / 2 + 0.2), 12);
    expect(labelHalfWidth('')).toBeGreaterThan(0);
  });

  it('holds the ink of the widest Latin labels (review)', () => {
    // Half each one's ink, in ems, on its wider side: Noto Sans Regular's glyph outlines laid side by
    // side, measured in the review of c8389df19. The estimate before reached 0.04–0.6 em short.
    const ink: [string, number][] = [
      ['MAMMOTH', 2.622],
      ['WOW', 1.309],
      ['WHOM', 1.668],
      ['WWWWW', 2.313],
      ['mmmmm', 2.257],
      ['MW', 0.906],
      ['MOUNTAIN', 2.639],
    ];
    for (const [text, half] of ink) expect(labelHalfWidth(text) / LABEL_SIZE, text).toBeGreaterThanOrEqual(half);
  });

  it('sets its Latin as the bundled Noto Sans does, glyph for glyph', () => {
    const font = readFontMetrics(readFileSync(resolve(__dirname, '../fonts/NotoSans-Regular.ttf')));
    expect(font.unitsPerEm).toBe(1000);
    LABEL_ADVANCES.forEach((advance, index) => {
      const codePoint = LABEL_ADVANCES_FROM + index;
      expect(advance, codePoint.toString(16)).toBe(font.has(codePoint) ? font.advance(codePoint) : -1);
    });
    expect(LABEL_ADVANCES_FROM + LABEL_ADVANCES.length - 1).toBe(0x52f);
  });
});

describe('a shaped arrow', () => {
  const path: DiagramPathNode[] = [
    { at: [0.1, 0.5], out: [0.2, 0.3] },
    { at: [0.4, 0.5], in: [0.3, 0.6], out: [0.5, 0.4], type: 'corner' },
    { at: [0.7, 0.5], in: [0.6, 0.7] },
  ];
  const shaped: KnownDiagramAnnotation = { id: 's', kind: 'valley-arrow', from: [0.1, 0.5], to: [0.7, 0.5], path };
  const every = (arrow: KnownDiagramAnnotation) =>
    arrow.path!.flatMap((node) => [node.at, ...(node.in ? [node.in] : []), ...(node.out ? [node.out] : [])]);

  it('is a path to everything that asks its shape, never the default arc', () => {
    expect(arrowShape(shaped)).toEqual({ kind: 'path', path });
    expect(arrowShape({ bend: 0.2 })).toEqual({ kind: 'arc', bend: 0.2 });
    expect(arrowShape({})).toEqual({ kind: 'arc', bend: ARROW_BEND });
  });

  it('is carried point by point, handles too, a mirror needing nothing turned over', () => {
    const mirror = mirrorMove({ width: 1, height: 1 });
    const carried = carryAnnotation(shaped, mirror);
    expect(carried.bend).toBeUndefined();
    expect(carried.from).toEqual([0.9, 0.5]);
    expect(carried.path![1]).toEqual({ at: [0.6, 0.5], in: [0.7, 0.6], out: [0.5, 0.4], type: 'corner' });
    // The curve itself carried: every point of it lands where the move takes it.
    const quarter: PictureMove = { point: ([x, y]) => [1 - y, x], mirrors: false, turnDeg: 90 };
    const turned = pathCubics(carryAnnotation(shaped, quarter).path!);
    pathCubics(path).forEach((cubic, index) => {
      for (const t of [0.2, 0.5, 0.9]) {
        const [x, y] = cubicPoint(cubic, t);
        const [u, v] = cubicPoint(turned[index]!, t);
        expect(u).toBeCloseTo(1 - y, 12);
        expect(v).toBeCloseTo(x, 12);
      }
    });
    // An arc made a path and mirrored is the mirrored arc made a path.
    const arc: KnownDiagramAnnotation = { id: 'a', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.6, 0.4], bend: 0.3 };
    const viaPath = carryAnnotation(arcToPath(arc), mirror).path!;
    const viaArc = arcToPath(carryAnnotation(arc, mirror)).path!;
    viaPath.forEach((node, index) => {
      expect(node.at[0]).toBeCloseTo(viaArc[index]!.at[0], 12);
      expect(node.at[1]).toBeCloseTo(viaArc[index]!.at[1], 12);
    });
  });

  it('moves whole only as far as keeps every node and handle within reach', () => {
    const moved = moveAnnotation(shaped, [9, 0]);
    // The furthest point right is the handle at 0.6 + 0.1: it stops at reach.
    expect(Math.max(...every(moved).map(([x]) => x))).toBeCloseTo(ANNOTATION_REACH, 12);
    expect(moved.to[0] - moved.from[0]).toBeCloseTo(0.6, 12);
    expect(moved.path![1]!.out![0] - moved.path![1]!.at[0]).toBeCloseTo(0.1, 12);
    expect(moveAnnotation(shaped, [0, 0])).toBe(shaped);
  });

  it('moves an end as its node, the handle coming with it', () => {
    const moved = moveAnnotationEnd(shaped, 'from', [0, 0.4]);
    expect(moved.from).toEqual([0, 0.4]);
    expect(moved.path![0]!.at).toEqual([0, 0.4]);
    expect(moved.path![0]!.out![0]).toBeCloseTo(0.1, 12);
    expect(moved.path![0]!.out![1]).toBeCloseTo(0.2, 12);
    expect(moveAnnotationEnd(shaped, 'to', [0.8, 0.6]).path![2]!.at).toEqual([0.8, 0.6]);
  });

  it('flips across its chord, and an arc made a path flips as the arc does', () => {
    const flipped = flipAnnotationArc(shaped);
    expect(flipped.from).toEqual(shaped.from);
    expect(flipped.path![0]!.out![0]).toBeCloseTo(0.2, 12);
    expect(flipped.path![0]!.out![1]).toBeCloseTo(0.7, 12);
    expect(flipped.path![1]!.type).toBe('corner');
    const arc: KnownDiagramAnnotation = { id: 'a', kind: 'mountain-arrow', from: [0.2, 0.3], to: [0.6, 0.4], bend: 0.2 };
    const viaPath = flipAnnotationArc(arcToPath(arc)).path!;
    const viaArc = arcToPath(flipAnnotationArc(arc)).path!;
    viaPath.forEach((node, index) => {
      expect(node.out?.[0] ?? 0).toBeCloseTo(viaArc[index]!.out?.[0] ?? 0, 12);
      expect(node.in?.[1] ?? 0).toBeCloseTo(viaArc[index]!.in?.[1] ?? 0, 12);
    });
    // One whose ends meet has no chord to flip across.
    const loop = { ...shaped, to: shaped.from, path: [path[0]!, { at: [0.1, 0.5] as [number, number], in: [0.3, 0.8] as [number, number] }] };
    expect(flipAnnotationArc(loop)).toBe(loop);
  });

  it('keeps a smooth node smooth when a flip takes it past reach: its handles come in with it', () => {
    const edge: KnownDiagramAnnotation = {
      id: 'e',
      kind: 'valley-arrow',
      from: [3.5, 0],
      to: [3.5, 1],
      path: [
        { at: [3.5, 0], out: [3.2, 0.1] },
        { at: [2.9, 0.5], in: [2.9, 0.3], out: [2.9, 0.7] },
        { at: [3.5, 1], in: [3.2, 0.9] },
      ],
    };
    // Mirrored across its chord the middle node lands at 4.1, past reach, and is brought in to 4.
    const middle = flipAnnotationArc(edge).path![1]!;
    expect(middle.at).toEqual([4, 0.5]);
    expect(middle.in![0]).toBeCloseTo(4, 12);
    expect(middle.in![1]).toBeCloseTo(0.3, 12);
    expect(middle.out![0]).toBeCloseTo(4, 12);
    expect(middle.out![1]).toBeCloseTo(0.7, 12);
  });

  it('has a length along its path: a loop that ends by its tail is an arrow, a stub is not', () => {
    const loop: KnownDiagramAnnotation = {
      ...shaped,
      to: [0.105, 0.5],
      path: [
        { at: [0.1, 0.5], out: [0.4, 0.1] },
        { at: [0.105, 0.5], in: [0.4, 0.9] },
      ],
    };
    expect(isDegenerate(loop, 0.015)).toBe(false);
    const stub = { ...loop, path: [{ at: [0.1, 0.5] as [number, number] }, { at: [0.105, 0.5] as [number, number] }] };
    expect(isDegenerate(stub, 0.015)).toBe(true);
  });

  it('is written as the reader reads it: points and handles within reach, no stray handle, no more nodes than it holds', () => {
    expect(cleanAnnotation(shaped)).toBe(shaped);
    const stray: KnownDiagramAnnotation = {
      ...shaped,
      bend: 0.2,
      from: [0, 0],
      path: [{ ...path[0]!, in: [0, 0] }, { ...path[1]!, out: [9, 0.4] }, { ...path[2]!, out: [1, 1] }],
    };
    const clean = cleanAnnotation(stray);
    expect(clean.bend).toBeUndefined();
    expect(clean.from).toEqual([0.1, 0.5]);
    expect(clean.path![0]!.in).toBeUndefined();
    expect(clean.path![2]!.out).toBeUndefined();
    // Drawn in along itself to reach's edge: its direction from the node kept.
    expect(clean.path![1]!.out).toEqual([ANNOTATION_REACH, 0.5 - (0.1 * (ANNOTATION_REACH - 0.4)) / (9 - 0.4)]);
    const many = Array.from({ length: 30 }, (_, index): DiagramPathNode => ({ at: [index / 30, 0.5] }));
    const long = cleanAnnotation({ ...shaped, path: many, to: [29 / 30, 0.5] });
    expect(long.path).toHaveLength(MAX_PATH_NODES);
    expect(long.to).toEqual([29 / 30, 0.5]);
    // A path on a kind that is not shaped, or of one node, is dropped: an arc, or straight, again.
    expect(cleanAnnotation({ ...shaped, kind: 'push-arrow' }).path).toBeUndefined();
    const lone = cleanAnnotation({ ...shaped, path: [path[0]!] });
    expect(lone.bend).toBe(ARROW_BEND);
    expect(lone.path).toBeUndefined();
  });
});

describe('a circle', () => {
  it('is put down at the press, its centre, with nothing more: no letter, no axis', () => {
    expect(createAnnotation('circle', [0.2, 0.3], [0.9, 0.9], SQUARE, id)).toEqual({
      id: 'annotation-1',
      kind: 'circle',
      from: [0.2, 0.3],
      to: [0.2, 0.3],
    });
  });

  it('moves whole by its body or its one place, and is never a slip', () => {
    const circle = createAnnotation('circle', [0.2, 0.3], [0.2, 0.3], SQUARE, id);
    const moved = moveAnnotation(circle, [0.1, 0.1]);
    expect(moved.from[0]).toBeCloseTo(0.3, 12);
    expect(moved.to).toEqual(moved.from);
    expect(moveAnnotationEnd(circle, 'to', [0.5, 0.6])).toMatchObject({ from: [0.5, 0.6], to: [0.5, 0.6] });
    expect(isDegenerate(circle, 0.5)).toBe(false);
  });

  it('is carried with its picture: its centre goes where the point does, and nothing turns', () => {
    const circle = createAnnotation('circle', [0.2, 0.3], [0.2, 0.3], SQUARE, id);
    expect(carryAnnotation(circle, mirrorMove(SQUARE))).toEqual({ ...circle, from: [0.8, 0.3], to: [0.8, 0.3] });
    // Not a fold arrow: Flip arc leaves it.
    expect(flipAnnotationArc(circle)).toBe(circle);
  });

  it('is written at one point, within reach', () => {
    const stray: KnownDiagramAnnotation = { id: 'c', kind: 'circle', from: [5, 0.3], to: [0.4, 0.4] };
    expect(cleanAnnotation(stray)).toEqual({
      id: 'c',
      kind: 'circle',
      from: [ANNOTATION_REACH, 0.3],
      to: [ANNOTATION_REACH, 0.3],
    });
  });
});

describe('a right angle', () => {
  const R = Math.SQRT1_2;
  const opens = (annotation: KnownDiagramAnnotation) => rightAngleDiagonal(annotation).map((v) => Math.round(v * 1e9) / 1e9 + 0);
  const length = ({ from, to }: KnownDiagramAnnotation) => Math.hypot(to[0] - from[0], to[1] - from[1]);

  it('is put down in a corner, `to` a short way along the way it opens: only its direction', () => {
    const drawn = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.6], SQUARE, id);
    expect(drawn).toMatchObject({ id: 'annotation-1', kind: 'right-angle', from: [0.2, 0.3] });
    expect(length(drawn)).toBeCloseTo(RIGHT_ANGLE_DIAGONAL, 12);
    expect(opens(drawn)).toEqual([Math.round(R * 1e9) / 1e9, Math.round(R * 1e9) / 1e9]);
    // A click, which says no way: up and to the right, as an ∟'s square sits.
    expect(opens(createAnnotation('right-angle', [0.2, 0.3], [0.2, 0.3], SQUARE, id))).toEqual(
      [R, -R].map((v) => Math.round(v * 1e9) / 1e9 + 0)
    );
    // Its corner is where it was put, to the bit: a snapped corner stays on its point.
    expect(createAnnotation('right-angle', [0.1 + 0.2, 0.7], [1, 1], SQUARE, id).from).toEqual([0.1 + 0.2, 0.7]);
    expect(isDegenerate(drawn, 0.5)).toBe(false);
  });

  it('keeps `to` within reach by drawing the corner in, never by turning it', () => {
    const edge = rightAngleAt([ANNOTATION_REACH, 0.5], [1, 1]);
    expect(edge.to[0]).toBe(ANNOTATION_REACH);
    expect(edge.from[0]).toBeCloseTo(ANNOTATION_REACH - RIGHT_ANGLE_DIAGONAL * R, 12);
    // Drawn in across only: it stays level with where it was put.
    expect(edge.from[1]).toBeCloseTo(0.5, 12);
    expect(edge.to[1]).toBeCloseTo(0.5 + RIGHT_ANGLE_DIAGONAL * R, 12);
    const past = createAnnotation('right-angle', [9, -9], [10, -10], SQUARE, id);
    expect(Math.abs(past.to[0]) <= ANNOTATION_REACH && Math.abs(past.to[1]) <= ANNOTATION_REACH).toBe(true);
    expect(opens(past)).toEqual(opens({ ...past, from: [0, 0], to: [1, -1] }));
  });

  it('is written with its `to` a set way along, the same object when it already is', () => {
    const written = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.3], SQUARE, id);
    expect(cleanAnnotation(written)).toBe(written);
    // One a file or a newer build wrote further along: the same way, the length this build writes.
    const far: KnownDiagramAnnotation = { id: 'r', kind: 'right-angle', from: [0.2, 0.3], to: [0.2, 0.9] };
    const clean = cleanAnnotation(far);
    expect(clean.from).toEqual([0.2, 0.3]);
    expect(length(clean)).toBeCloseTo(RIGHT_ANGLE_DIAGONAL, 12);
    expect(opens(clean)).toEqual([0, 1]);
    // Past reach: the corner brought in, the way it opens kept.
    const stray: KnownDiagramAnnotation = { id: 'r', kind: 'right-angle', from: [5, 0.3], to: [6, 0.3] };
    expect(cleanAnnotation(stray).to).toEqual([ANNOTATION_REACH, 0.3]);
    expect(opens(cleanAnnotation(stray))).toEqual([1, 0]);
  });

  it('moves whole by its body or its corner, and turns toward a point by its other end', () => {
    const mark = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.6], SQUARE, id);
    const moved = moveAnnotation(mark, [0.1, -0.1]);
    expect(moved.from[0]).toBeCloseTo(0.3, 12);
    expect(opens(moved)).toEqual(opens(mark));
    const cornered = moveAnnotationEnd(mark, 'from', [0.6, 0.6]);
    expect(cornered.from).toEqual([0.6, 0.6]);
    expect(opens(cornered)).toEqual(opens(mark));
    const turned = moveAnnotationEnd(mark, 'to', [0.2, 0.9]);
    expect(turned.from).toEqual([0.2, 0.3]);
    expect(opens(turned)).toEqual([0, 1]);
  });

  it('turns a quarter clockwise about its corner, four turns round to where it was', () => {
    const mark = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.0], SQUARE, id);
    expect(opens(mark)).toEqual([R, -R].map((v) => Math.round(v * 1e9) / 1e9 + 0));
    // Clockwise on the page, y down: up-right, then down-right, down-left, up-left.
    const once = turnRightAngle(mark);
    expect(once.from).toEqual(mark.from);
    expect(opens(once)).toEqual([R, R].map((v) => Math.round(v * 1e9) / 1e9));
    expect(opens(turnRightAngle(once))).toEqual([-R, R].map((v) => Math.round(v * 1e9) / 1e9));
    const round = turnRightAngle(turnRightAngle(turnRightAngle(once)));
    expect(round.to[0]).toBeCloseTo(mark.to[0], 12);
    expect(round.to[1]).toBeCloseTo(mark.to[1], 12);
    // Nothing else turns.
    const circle = createAnnotation('circle', [0.2, 0.3], [0.2, 0.3], SQUARE, id);
    expect(turnRightAngle(circle)).toBe(circle);
    expect(flipAnnotationArc(mark)).toBe(mark);
  });

  it('is carried with its picture: its corner where the point goes, opening the way its diagonal went', () => {
    const mark = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.0], SQUARE, id);
    // A mirror turns it over: up-right becomes up-left.
    const mirrored = carryAnnotation(mark, mirrorMove(SQUARE));
    expect(mirrored.from[0]).toBeCloseTo(0.8, 12);
    expect(mirrored.from[1]).toBeCloseTo(0.3, 12);
    expect(opens(mirrored)).toEqual([-R, -R].map((v) => Math.round(v * 1e9) / 1e9));
    // A quarter turn clockwise about the middle turns the way it opens with it.
    const quarter: PictureMove = { point: ([x, y]) => [1 - y, x], mirrors: false, turnDeg: 90 };
    const turned = carryAnnotation(mark, quarter);
    expect(turned.from[0]).toBeCloseTo(0.7, 12);
    expect(turned.from[1]).toBeCloseTo(0.2, 12);
    expect(opens(turned)).toEqual([R, R].map((v) => Math.round(v * 1e9) / 1e9));
    // Scaled up, as a picture refitted larger is: `to` written its set way along again.
    const larger: PictureMove = { point: ([x, y]) => [2 * x, 2 * y], mirrors: false, turnDeg: 0 };
    expect(length(carryAnnotation(mark, larger))).toBeCloseTo(RIGHT_ANGLE_DIAGONAL, 12);
  });
});

describe('a white arrow', () => {
  const laid = () => createAnnotation('white-arrow', [0.2, 0.3], [0.6, 0.5], SQUARE, id);
  const bent = () => bendPathSegment(laid(), 0, 0.5, [0.35, 0.2]);

  it('is laid straight from the drag, a path of two nodes, in the template’s look: regular, pointed', () => {
    expect(laid()).toEqual({
      id: 'annotation-1',
      kind: 'white-arrow',
      from: [0.2, 0.3],
      to: [0.6, 0.5],
      path: [{ at: [0.2, 0.3] }, { at: [0.6, 0.5] }],
      width: 'regular',
      tail: 'pointed',
    });
    expect(DEFAULT_WHITE_ARROW).toEqual({ width: 'regular', tail: 'pointed' });
    // Always a path: no arc to fill in, and Edit Path shows its own nodes, not an arc's.
    expect(arrowShape(laid())).toEqual({ kind: 'path', path: laid().path });
    expect(pathNodesOf(laid())).toEqual(laid().path);
    expect(laid()).not.toHaveProperty('bend');
  });

  it('is shaped with Edit Path and flipped, as a fold arrow is; shaped only once it is no longer straight', () => {
    expect(canBeShaped('white-arrow')).toBe(true);
    expect(flipsArc('white-arrow')).toBe(true);
    expect(isShapedArrow(laid())).toBe(false);
    expect(isShapedArrow(bent())).toBe(true);
    // A fold arrow is shaped once it is a path at all.
    const arc = createAnnotation('valley-arrow', [0.2, 0.3], [0.6, 0.5], SQUARE, id);
    expect(isShapedArrow(arc)).toBe(false);
    expect(isShapedArrow(arcToPath(arc))).toBe(true);
    // A handle drawn back onto its node is straight again.
    const onNodes: KnownDiagramAnnotation = { ...laid(), path: [{ at: [0.2, 0.3], out: [0.2, 0.3] }, { at: [0.6, 0.5] }] };
    expect(isShapedArrow(onNodes)).toBe(false);
    // Flipped across its chord, its look kept: its bulge's handle on the other side.
    const flipped = flipAnnotationArc(bent());
    expect(flipped).toMatchObject({ kind: 'white-arrow', width: 'regular', tail: 'pointed' });
    expect(flipped.to[0]).toBeCloseTo(0.6, 12);
    const side = (annotation: KnownDiagramAnnotation) => {
      const [x, y] = annotation.path![0]!.out!;
      return Math.sign((0.6 - 0.2) * (y - 0.3) - (0.5 - 0.3) * (x - 0.2));
    };
    expect(side(flipped)).toBe(-side(bent()));
  });

  it('is a path whatever it is written as: one without is laid straight between its ends', () => {
    const { path: _path, ...bare } = laid();
    expect(cleanAnnotation(bare)).toEqual(laid());
    // A path of one node is no path: laid straight again, not made an arc.
    expect(cleanAnnotation({ ...laid(), path: [{ at: [0.2, 0.3] }] })).toEqual(laid());
    const clean = laid();
    expect(cleanAnnotation(clean)).toBe(clean);
  });

  it('moves, and is carried with its picture, its look kept and its every node and handle with it', () => {
    const arrow = { ...bent(), width: 'wide' as const, tail: 'cleft' as const };
    const moved = moveAnnotation(arrow, [0.1, 0]);
    expect(moved).toMatchObject({ kind: 'white-arrow', width: 'wide', tail: 'cleft', from: [expect.closeTo(0.3, 12), 0.3] });
    expect(moved.path![0]!.out![0]).toBeCloseTo(arrow.path![0]!.out![0] + 0.1, 12);
    const mirrored = carryAnnotation(arrow, mirrorMove(SQUARE));
    expect(mirrored).toMatchObject({ kind: 'white-arrow', width: 'wide', tail: 'cleft', from: [0.8, 0.3], to: [0.4, 0.5] });
    expect(mirrored.path![0]!.out![0]).toBeCloseTo(1 - arrow.path![0]!.out![0], 12);
  });

  it('is a slip when shorter than the shortest arrow, measured along it', () => {
    expect(isDegenerate(createAnnotation('white-arrow', [0.2, 0.3], [0.2, 0.3 + MIN_ANNOTATION_LENGTH / 2], SQUARE, id), MIN_ANNOTATION_LENGTH)).toBe(true);
    expect(isDegenerate(laid(), MIN_ANNOTATION_LENGTH)).toBe(false);
  });
});

describe('a callout', () => {
  const callout = (from: [number, number], to: [number, number], text = 'Repeat behind'): KnownDiagramAnnotation => ({
    id: 'c',
    kind: 'callout',
    from,
    to,
    text,
  });

  it('is drawn from the point it marks to where its box sits, saying the words it is given', () => {
    expect(createAnnotation('callout', [0.2, 0.3], [0.6, 0.1], SQUARE, id, '裏側も同様に')).toEqual({
      id: 'annotation-1',
      kind: 'callout',
      from: [0.2, 0.3],
      to: [0.6, 0.1],
      text: '裏側も同様に',
    });
    // Words of no language given: English's.
    expect(createAnnotation('callout', [0.2, 0.3], [0.6, 0.1], SQUARE, id).text).toBe(NEW_CALLOUT_TEXT);
    // Kept to what a label may say.
    expect(createAnnotation('callout', [0.2, 0.3], [0.6, 0.1], SQUARE, id, `a\nb${'x'.repeat(200)}`).text).toHaveLength(
      LABEL_MAX_LENGTH
    );
  });

  it('puts its box beside its point for a click, out from the middle, its near corner a gap out each way', () => {
    const { halfWidth, halfHeight } = calloutHalfBox(NEW_CALLOUT_TEXT);
    const cases: Array<[[number, number], [1 | -1, 1 | -1]]> = [
      [[0.3, 0.2], [-1, -1]],
      [[0.7, 0.2], [1, -1]],
      [[0.3, 0.8], [-1, 1]],
      [[0.7, 0.8], [1, 1]],
      // The middle itself: up and to the right.
      [[0.5, 0.5], [1, -1]],
    ];
    for (const [at, [sx, sy]] of cases) {
      const placed = createAnnotation('callout', at, at, SQUARE, id);
      expect(placed.from).toEqual(at);
      expect(placed.to[0]).toBeCloseTo(at[0] + sx * (halfWidth + CALLOUT_GAP), 12);
      expect(placed.to[1]).toBeCloseTo(at[1] + sy * (halfHeight + CALLOUT_GAP), 12);
      const { line, box } = calloutShape(placed);
      const corner = [sx > 0 ? box.x : box.x + box.width, sy > 0 ? box.y : box.y + box.height];
      expect(Math.abs(corner[0]! - at[0])).toBeCloseTo(CALLOUT_GAP, 12);
      expect(Math.abs(corner[1]! - at[1])).toBeCloseTo(CALLOUT_GAP, 12);
      // Its line heads for the box's middle and stops on the side facing the point: a wide box's top or bottom.
      expect(line![0]).toEqual(at);
      expect(line![1][1]).toBeCloseTo(sy > 0 ? box.y : box.y + box.height, 12);
      const toward = Math.atan2(placed.to[1] - at[1], placed.to[0] - at[0]);
      expect(Math.atan2(line![1][1] - at[1], line![1][0] - at[0])).toBeCloseTo(toward, 12);
    }
    // A drag shorter than a slip is a click.
    const slip = createAnnotation('callout', [0.3, 0.2], [0.305, 0.2], SQUARE, id);
    expect(slip.to).toEqual(createAnnotation('callout', [0.3, 0.2], [0.3, 0.2], SQUARE, id).to);
  });

  it('has a box as wide as its words are set, and a pad, as tall as a line and a pad', () => {
    const { halfWidth, halfHeight } = calloutHalfBox('Repeat behind');
    // Noto Sans sets "Repeat behind" 6.835 em wide.
    expect(textEms('Repeat behind')).toBeCloseTo(6.835, 9);
    expect(halfWidth).toBeCloseTo(CALLOUT_TEXT_SIZE * (6.835 / 2 + CALLOUT_PAD_EMS), 12);
    expect(halfHeight).toBeCloseTo(CALLOUT_TEXT_SIZE * CALLOUT_HALF_HEIGHT_EMS, 12);
    expect(calloutHalfBox('iii').halfWidth).toBeLessThan(calloutHalfBox('MMM').halfWidth);
    // Han an em a character; nothing at all as wide as a label with nothing in it.
    expect(calloutHalfBox('裏側').halfWidth).toBeCloseTo(CALLOUT_TEXT_SIZE * (2 / 2 + CALLOUT_PAD_EMS), 12);
    expect(calloutHalfBox('').halfWidth).toBeCloseTo(CALLOUT_TEXT_SIZE * (0.6 / 2 + CALLOUT_PAD_EMS), 12);
  });

  it('stops its line at its box’s outline, whichever side it comes in by, and has none from inside the box', () => {
    const { halfWidth, halfHeight } = calloutHalfBox('Repeat behind');
    const to: [number, number] = [0.5, 0.5];
    // From the left, straight in: the left side's middle.
    expect(calloutShape(callout([0.1, 0.5], to)).line).toEqual([[0.1, 0.5], [0.5 - halfWidth, 0.5]]);
    // From below: the bottom side's middle.
    const below = calloutShape(callout([0.5, 0.9], to)).line!;
    expect(below[1][0]).toBeCloseTo(0.5, 12);
    expect(below[1][1]).toBeCloseTo(0.5 + halfHeight, 12);
    // Steeply from above and to the right: through the top, on the way to the middle.
    const steep = calloutShape(callout([0.6, 0.1], to)).line!;
    expect(steep[1][1]).toBeCloseTo(0.5 - halfHeight, 12);
    expect((steep[1][0] - 0.5) / (steep[1][1] - 0.5)).toBeCloseTo((0.6 - 0.5) / (0.1 - 0.5), 12);
    // The box over its own point: no line.
    expect(calloutShape(callout([0.5 + halfWidth * 0.9, 0.5], to)).line).toBeNull();
    expect(calloutShape(callout([0.5, 0.5], to)).line).toBeNull();
    const { box } = calloutShape(callout([0.1, 0.5], to));
    expect(box.x).toBeCloseTo(0.5 - halfWidth, 12);
    expect(box.width).toBeCloseTo(2 * halfWidth, 12);
    expect(box.height).toBeCloseTo(2 * halfHeight, 12);
  });

  it('is never a slip: its box is drawn wherever it sits, its point under it or not', () => {
    expect(isDegenerate(callout([0.5, 0.5], [0.5, 0.5]), 0.5)).toBe(false);
    expect(placedByClick('callout')).toBe(true);
    expect(placedByClick('valley-line')).toBe(false);
    expect(placedByClick('label')).toBe(true);
  });

  it('carries words, as a label does, and offers its point to take hold of, its box being taken where it is drawn', () => {
    expect(ANNOTATION_KINDS.filter(carriesText).sort()).toEqual(['callout', 'label']);
    expect(annotationEnds('callout')).toEqual(['from']);
    expect(annotationEnds('valley-arrow')).toEqual(['to', 'from']);
    expect(annotationEnds('circle')).toEqual([]);
  });

  it('moves whole by its line, and its box or its point alone', () => {
    const it = callout([0.2, 0.3], [0.6, 0.1]);
    expect(moveAnnotation(it, [0.1, 0.1])).toMatchObject({ from: [0.30000000000000004, 0.4], to: [0.7, 0.2] });
    expect(moveAnnotationEnd(it, 'to', [0.9, 0.9])).toMatchObject({ from: [0.2, 0.3], to: [0.9, 0.9] });
    expect(moveAnnotationEnd(it, 'from', [0.1, 0.1])).toMatchObject({ from: [0.1, 0.1], to: [0.6, 0.1] });
  });

  it('is carried with the face under its point: its box keeps its place beside the point, turned as the picture is', () => {
    const it = callout([0.2, 0.3], [0.6, 0.1]);
    // A mirror: the box goes to the point's other side, its words upright.
    expect(carryAnnotation(it, mirrorMove(SQUARE))).toEqual({ ...it, from: [0.8, 0.3], to: [0.4, 0.1] });
    // A spread: the point goes with its face, by a map no box follows — but the box
    // keeps its offset, turned as the picture turned (here a quarter turn clockwise).
    const spread: PictureMove = {
      point: ([x, y]) => [x + 0.3 * x * x, y + 0.05],
      mirrors: false,
      turnDeg: 90,
      vector: ([dx, dy]) => [-dy, dx],
    };
    const carried = carryAnnotation(it, spread);
    expect(carried.from[0]).toBeCloseTo(0.2 + 0.3 * 0.04, 12);
    expect(carried.from[1]).toBeCloseTo(0.35, 12);
    // Its box the way the picture turned the offset, its line as long as it was.
    const [dx, dy] = [carried.to[0] - carried.from[0], carried.to[1] - carried.from[1]];
    expect(dx * 0.4 - dy * 0.2).toBeCloseTo(0, 12);
    expect(dx).toBeGreaterThan(0);
    const lineLength = (annotation: KnownDiagramAnnotation) => {
      const [a, b] = calloutShape(annotation).line!;
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    expect(lineLength(carried)).toBeCloseTo(lineLength(it), 12);
    expect(carried.text).toBe('Repeat behind');
    // Not a fold arrow: Flip arc leaves it.
    expect(flipAnnotationArc(it)).toBe(it);
  });

  it('keeps its line through a quarter turn, its box wider than tall still beside its point, and back (review)', () => {
    // Dragged with its box just under its point: a line 0.0575 long.
    const it = callout([0.5, 0.5], [0.5, 0.6]);
    const length = (annotation: KnownDiagramAnnotation) => {
      const line = calloutShape(annotation).line;
      return line ? Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) : 0;
    };
    expect(length(it)).toBeCloseTo(0.0575, 4);
    for (const degrees of [75, 90, 270]) {
      const turn = degrees * (Math.PI / 180);
      const about = (([x, y]: PicturePoint): PicturePoint => [
        0.5 + (x - 0.5) * Math.cos(turn) - (y - 0.5) * Math.sin(turn),
        0.5 + (x - 0.5) * Math.sin(turn) + (y - 0.5) * Math.cos(turn),
      ]);
      const back = (([x, y]: PicturePoint): PicturePoint => [
        0.5 + (x - 0.5) * Math.cos(-turn) - (y - 0.5) * Math.sin(-turn),
        0.5 + (x - 0.5) * Math.sin(-turn) + (y - 0.5) * Math.cos(-turn),
      ]);
      const turned = carryAnnotation(it, { point: about, mirrors: false, turnDeg: degrees });
      expect(length(turned), `${degrees}°`).toBeCloseTo(0.0575, 9);
      const home = carryAnnotation(turned, { point: back, mirrors: false, turnDeg: -degrees });
      expect(home.to[0], `${degrees}° and back`).toBeCloseTo(0.5, 9);
      expect(home.to[1], `${degrees}° and back`).toBeCloseTo(0.6, 9);
    }
  });

  it('is written with its words clean and its box within reach', () => {
    const stray = callout([0.2, 0.3], [9, 0.1], 'Repeat\nbehind');
    expect(cleanAnnotation(stray)).toEqual({ ...stray, to: [ANNOTATION_REACH, 0.1], text: 'Repeat behind' });
  });
});
