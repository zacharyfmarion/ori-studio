import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cubicPoint } from '../../lib/cubicBezier';
import { readFontMetrics } from '../fonts/fontMetrics';
import { LABEL_ADVANCES, LABEL_ADVANCES_FROM } from './labelAdvances';
import type { DiagramPathNode, KnownDiagramAnnotation } from '../document/diagramDocument';
import { arcToPath } from './annotationPath';
import {
  ANNOTATION_REACH,
  ARROW_BEND,
  MAX_PATH_NODES,
  arrowApex,
  arrowShape,
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
  type PictureMove,
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
    expect(labelHalfWidth('Ж')).toBeCloseTo(LABEL_SIZE * (1 / 2 + 0.2), 12);
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
    expect(LABEL_ADVANCES_FROM + LABEL_ADVANCES.length - 1).toBe(0x36f);
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
