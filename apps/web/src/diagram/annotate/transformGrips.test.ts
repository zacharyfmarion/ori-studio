import { describe, expect, it } from 'vitest';
import { DIAGRAM_STAR_INK } from '../../cp-workspace/references/diagram/diagramInk';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import { ANNOTATION_KINDS, GLYPH_SCALE, type PicturePoint } from './annotationModel';
import { INK_UNITS } from './canvasInk';
import {
  MIN_GLYPH_BOX_PX,
  boxedMarkOf,
  drawnTransformBox,
  hasTransformBox,
  transformBoxHandles,
  transformBoxOf,
  transformDragged,
  transformGripAt,
} from './transformGrips';

/** One screen px in picture units at the canvas's zoom `zoom`: its frame is 1000 world px across. */
const pxAt = (zoom: number) => 1 / (zoom * 1000);
/** A mouse's reach and a finger's, in screen px (`REACH_PX`). */
const REACH = { fine: 8, coarse: 18 } as const;

const star = (more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
  id: 's-1',
  kind: 'star',
  from: [0.4, 0.5],
  to: [0.4, 0.5],
  ...more,
});

/** A star's side as drawn, in picture units, at `scale`. */
const side = (scale = 1) => 2 * DIAGRAM_STAR_INK.radius * scale * INK_UNITS;

/** The zoom a 1× star is drawn `across` screen px at. */
const zoomFor = (across: number) => across / (side() * 1000);

/** A point most of the way out along a star's arm, `degrees` clockwise from its top tip as it is turned. */
function armOf(annotation: KnownDiagramAnnotation, degrees: number): PicturePoint {
  const a = ((degrees + (annotation.angle ?? 0)) * Math.PI) / 180;
  const reach = 0.85 * DIAGRAM_STAR_INK.radius * (annotation.scale ?? 1) * INK_UNITS;
  return [annotation.from[0] + reach * Math.sin(a), annotation.from[1] - reach * Math.cos(a)];
}

describe('which marks have a transform box (Revision 3)', () => {
  it('is a star alone in 18b: every other mark keeps its grips', () => {
    const boxed = ANNOTATION_KINDS.filter((kind: DiagramAnnotationKind) =>
      hasTransformBox({ id: 'a', kind, from: [0.5, 0.5], to: [0.6, 0.5], radius: 0.1 })
    );
    expect(boxed).toEqual(['star']);
  });

  it('is the square a star’s tips reach, at its scale, turned by its own angle', () => {
    expect(transformBoxOf(star())).toEqual({ center: { x: 0.4, y: 0.5 }, width: side(), height: side(), rotation: 0 });
    const turned = transformBoxOf(star({ scale: 2, angle: 30 }))!;
    expect(turned.width).toBeCloseTo(side(2), 12);
    expect(turned.rotation).toBeCloseTo(Math.PI / 6, 12);
    // About 3 mm across at scale 1, at a card's 50 mm frame.
    expect(side() * 50).toBeCloseTo(2.98, 2);
  });
});

describe('the box as drawn (R3-30c B)', () => {
  it('is never under 24 screen px across round a star, about its centre: the star itself does not change', () => {
    // At zoom 1 a 3 mm star is about 60 px across: its own box.
    expect(side() / pxAt(1)).toBeGreaterThan(MIN_GLYPH_BOX_PX);
    expect(drawnTransformBox(star(), pxAt(1))).toEqual(transformBoxOf(star()));
    // At zoom 0.2 it is about 12 px: drawn 24 px across about its centre.
    const small = drawnTransformBox(star({ angle: 45 }), pxAt(0.2))!;
    expect(small.width / pxAt(0.2)).toBeCloseTo(MIN_GLYPH_BOX_PX, 9);
    expect(small.center).toEqual({ x: 0.4, y: 0.5 });
    expect(small.rotation).toBeCloseTo(Math.PI / 4, 12);
  });

  it('offers a star its four corners and four turn handles, 18 screen px out along each corner’s diagonal', () => {
    for (const zoom of [1, 4]) {
      const drawn = transformBoxHandles(star({ angle: 20 }), pxAt(zoom))!;
      expect(drawn.handles.scale.map((each) => each.handle)).toEqual(['nw', 'ne', 'se', 'sw']);
      drawn.handles.rotate.forEach(({ at }, index) => {
        const [x, y] = drawn.corners[index]!;
        expect(Math.hypot(at.x - x, at.y - y) / pxAt(zoom)).toBeCloseTo(18, 9);
      });
    }
  });
});

describe('what a press takes of a selected star’s box', () => {
  for (const zoom of [1, 4]) {
    it(`takes a corner’s square or its turn handle at zoom ${zoom}, nothing between`, () => {
      const px = pxAt(zoom);
      const { handles } = transformBoxHandles(star(), px)!;
      const se = handles.scale.find((each) => each.handle === 'se')!.at;
      const turn = handles.rotate.find((each) => each.corner === 'ne')!.at;
      const near = (at: { x: number; y: number }, dx: number): PicturePoint => [at.x + dx * px, at.y];
      expect(transformGripAt(star(), near(se, 3), { px, reach: REACH.fine * px })).toEqual({ kind: 'scale', handle: 'se' });
      expect(transformGripAt(star(), near(turn, -3), { px, reach: REACH.fine * px })).toEqual({ kind: 'rotate', corner: 'ne' });
      // The star's middle is its body's, not a handle's.
      expect(transformGripAt(star(), [0.4, 0.5], { px, reach: REACH.fine * px })).toBeNull();
      // Past a mouse's reach of either.
      expect(transformGripAt(star(), near(se, 30), { px, reach: REACH.fine * px })).toBeNull();
    });
  }

  it('takes the nearest handle within a finger’s reach out from the box, a square where the two are as near', () => {
    const px = pxAt(1);
    const { handles } = transformBoxHandles(star(), px)!;
    const se = handles.scale.find((each) => each.handle === 'se')!.at;
    const turn = handles.rotate.find((each) => each.corner === 'se')!.at;
    // 13 px off the square, below the box: a finger takes it; a mouse does not.
    const off: PicturePoint = [se.x - 6 * px, se.y + 12 * px];
    expect(transformGripAt(star(), off, { px, reach: REACH.coarse * px })).toEqual({ kind: 'scale', handle: 'se' });
    expect(transformGripAt(star(), off, { px, reach: REACH.fine * px })).toBeNull();
    // 10 px off it the other way, inside the box: the star's, to move it, finger or not.
    expect(transformGripAt(star(), [se.x - 10 * px, se.y - 10 * px], { px, reach: REACH.coarse * px })).toBeNull();
    // Nearer the turn handle than the square.
    const between: PicturePoint = [se.x + 0.7 * (turn.x - se.x), se.y + 0.7 * (turn.y - se.y)];
    expect(transformGripAt(star(), between, { px, reach: REACH.coarse * px })).toEqual({ kind: 'rotate', corner: 'se' });
  });

  /**
   * A press on the star itself, inside its box (18b review): a finger's 18 px
   * reach is more than a corner's 17 px from the middle of a box at its 24 px
   * floor, and a mouse's 8 px took a lower tip 7.7 px from its corner, so the
   * squares scaled a star a drag meant to move. Inside the box a handle takes
   * only a press on it as drawn.
   */
  describe('inside the box', () => {
    const cases = [
      ['at an iPad’s fit, the star 31 px across', zoomFor(31.3)],
      ['at the box’s 24 px floor, the star 6 px across', zoomFor(6)],
    ] as const;
    for (const [name, zoom] of cases) {
      it(`leaves a press on the star to its body ${name}, with a finger or a mouse; a square still takes one on it`, () => {
        const px = pxAt(zoom);
        const { handles } = transformBoxHandles(star(), px)!;
        const se = handles.scale.find((each) => each.handle === 'se')!.at;
        // Its middle, 4 px up and right of it, and its lower arms most of the way out.
        const onStar: PicturePoint[] = [[0.4, 0.5], [0.4 + 4 * px, 0.5 - 4 * px], armOf(star(), 144), armOf(star(), 216)];
        for (const reach of [REACH.coarse, REACH.fine]) {
          for (const point of onStar) expect(transformGripAt(star(), point, { px, reach: reach * px }), `${reach} px at ${point}`).toBeNull();
          // On the square: its middle, or its inner corner.
          for (const point of [[se.x, se.y], [se.x - 3.5 * px, se.y - 3.5 * px]] as PicturePoint[]) {
            expect(transformGripAt(star(), point, { px, reach: reach * px })).toEqual({ kind: 'scale', handle: 'se' });
          }
        }
        // Out from the box beside it, as far as a finger reaches.
        expect(transformGripAt(star(), [se.x + 10 * px, se.y - 4 * px], { px, reach: REACH.coarse * px })).toEqual({
          kind: 'scale',
          handle: 'se',
        });
      });
    }
  });

  it('offers nothing on a mark with no box', () => {
    const circle: KnownDiagramAnnotation = { id: 'c', kind: 'circle', from: [0.4, 0.5], to: [0.4, 0.5] };
    expect(transformGripAt(circle, [0.4, 0.5], { px: pxAt(1), reach: 1 })).toBeNull();
    expect(transformBoxHandles(circle, pxAt(1))).toBeNull();
  });
});

describe('what a drag of a handle makes of a star', () => {
  const px = pxAt(1);
  const corner = (annotation: KnownDiagramAnnotation, handle: 'nw' | 'ne' | 'se' | 'sw'): PicturePoint => {
    const at = transformBoxHandles(annotation, px)!.handles.scale.find((each) => each.handle === handle)!.at;
    return [at.x, at.y];
  };

  it('scales it about its centre, so a star snapped to a point stays on it, keeping its proportions in one scale', () => {
    const start = corner(star(), 'se');
    // The corner drawn twice as far out from the centre, a little off its diagonal.
    const at: PicturePoint = [0.4 + 2 * (start[0] - 0.4), 0.5 + 2 * (start[1] - 0.5) - 0.001];
    const grown = transformDragged(star(), { kind: 'scale', handle: 'se' }, start, at, { px, shift: false });
    expect(grown.from).toEqual([0.4, 0.5]);
    expect(grown.to).toEqual([0.4, 0.5]);
    expect(grown.scale).toBeCloseTo(2, 9);
    expect(Object.keys(grown).filter((key) => key === 'size' || key === 'width')).toEqual([]);
    // Any corner: the north-west pulled in toward the middle shrinks it.
    const nw = corner(star(), 'nw');
    const shrunk = transformDragged(star(), { kind: 'scale', handle: 'nw' }, nw, [0.4 + 0.75 * (nw[0] - 0.4), 0.5 + 0.75 * (nw[1] - 0.5)], {
      px,
      shift: false,
    });
    expect(shrunk.scale).toBeCloseTo(0.75, 9);
  });

  it('holds a resize to half and four times its print size (R3-30a A), and writes no scale at 1', () => {
    const start = corner(star(), 'se');
    const far: PicturePoint = [0.4 + 20 * (start[0] - 0.4), 0.5 + 20 * (start[1] - 0.5)];
    expect(transformDragged(star(), { kind: 'scale', handle: 'se' }, start, far, { px, shift: false }).scale).toBe(GLYPH_SCALE.max);
    expect(transformDragged(star(), { kind: 'scale', handle: 'se' }, start, [0.4, 0.5], { px, shift: false }).scale).toBe(GLYPH_SCALE.min);
    const back = transformDragged(star({ scale: 2 }), { kind: 'scale', handle: 'se' }, corner(star({ scale: 2 }), 'se'), start, {
      px,
      shift: false,
    });
    expect('scale' in back).toBe(false);
  });

  it('scales it by how far the pointer travels from where it took the square, so a press off the square’s middle does not jump it (18b review)', () => {
    const at = zoomFor(31.3);
    const fit = pxAt(at);
    const se = transformBoxHandles(star(), fit)!.handles.scale.find((each) => each.handle === 'se')!.at;
    const se3 = transformBoxHandles(star({ scale: 3 }), fit)!.handles.scale.find((each) => each.handle === 'se')!.at;
    // Taken 3 px in from its middle, and not moved yet: as it was.
    const start: PicturePoint = [se.x - 3 * fit, se.y - 3 * fit];
    expect(transformDragged(star(), { kind: 'scale', handle: 'se' }, start, start, { px: fit, shift: false })).toEqual(star());
    // Drawn out as far as the corner of a box three times the size: three times the size.
    const out: PicturePoint = [start[0] + (se3.x - se.x), start[1] + (se3.y - se.y)];
    expect(transformDragged(star(), { kind: 'scale', handle: 'se' }, start, out, { px: fit, shift: false }).scale).toBeCloseTo(3, 3);
  });

  it('grows a star whose box is at its floor by as much as the pointer pulls the box', () => {
    const small = pxAt(0.2);
    const se = transformBoxHandles(star(), small)!.handles.scale.find((each) => each.handle === 'se')!.at;
    const at: PicturePoint = [0.4 + 1.5 * (se.x - 0.4), 0.5 + 1.5 * (se.y - 0.5)];
    expect(transformDragged(star(), { kind: 'scale', handle: 'se' }, [se.x, se.y], at, { px: small, shift: false }).scale).toBeCloseTo(1.5, 9);
  });

  it('turns it as far as the pointer turns about its centre, freely; Shift holds it to 15° steps (R3-28 A)', () => {
    const turn = transformBoxHandles(star(), px)!.handles.rotate.find((each) => each.corner === 'ne')!.at;
    const start: PicturePoint = [turn.x, turn.y];
    const about = (point: PicturePoint, degrees: number): PicturePoint => {
      const a = (degrees * Math.PI) / 180;
      const [dx, dy] = [point[0] - 0.4, point[1] - 0.5];
      return [0.4 + dx * Math.cos(a) - dy * Math.sin(a), 0.5 + dx * Math.sin(a) + dy * Math.cos(a)];
    };
    // 22° clockwise on the page.
    const free = transformDragged(star(), { kind: 'rotate', corner: 'ne' }, start, about(start, 22), { px, shift: false });
    expect(free.angle).toBeCloseTo(22, 9);
    expect(free.from).toEqual([0.4, 0.5]);
    const held = transformDragged(star(), { kind: 'rotate', corner: 'ne' }, start, about(start, 22), { px, shift: true });
    expect(held.angle).toBeCloseTo(15, 9);
    // From where it was turned, back past upright: within [0, 360).
    const back = transformDragged(star({ angle: 10 }), { kind: 'rotate', corner: 'ne' }, start, about(start, -40), { px, shift: true });
    expect(back.angle).toBeCloseTo(330, 9);
    // Back to upright, the angle is not written.
    const upright = transformDragged(star({ angle: 15 }), { kind: 'rotate', corner: 'ne' }, start, about(start, -16), { px, shift: true });
    expect('angle' in upright).toBe(false);
  });
});

describe('what a box writes, by kind (18b review)', () => {
  it('turns a star to a hundredth of a degree within [0, 360), however the turn was typed or dragged', () => {
    const boxed = boxedMarkOf(star())!;
    // As the Rotation row hands it on, wrapped: 12.345 comes as 12.345000000000027.
    expect(boxed.turned(12.345).angle).toBe(12.35);
    expect(boxed.turned(12.345000000000027).angle).toBe(12.35);
    expect(boxed.turned(-12.35).angle).toBe(347.65);
    expect(boxed.turned(370).angle).toBe(10);
    // A hair short of a whole turn is upright: nothing written.
    expect('angle' in boxed.turned(359.999)).toBe(false);
    expect(boxedMarkOf(star({ angle: 30 }))!.degrees).toBe(30);
    expect(boxedMarkOf(star())!.degrees).toBe(0);
  });

  it('resizes a star by one scale, the box’s as drawn to the box’s after, kept to its range and a thousandth', () => {
    const box = transformBoxOf(star({ scale: 2 }))!;
    const boxed = boxedMarkOf(star({ scale: 2 }))!;
    expect(boxed.keepsProportions).toBe(true);
    expect(boxed.resized(box, { center: box.center, width: box.width * 1.23456, height: box.height * 1.23456 }).scale).toBe(2.469);
    expect(boxed.resized(box, { center: box.center, width: box.width * 9, height: box.height * 9 }).scale).toBe(GLYPH_SCALE.max);
    expect('scale' in boxed.resized(box, { center: box.center, width: box.width / 2, height: box.height / 2 })).toBe(false);
  });

  it('is a star’s alone in 18b', () => {
    const boxed = ANNOTATION_KINDS.filter((kind) => boxedMarkOf({ id: 'a', kind, from: [0.5, 0.5], to: [0.6, 0.5], radius: 0.1 }) !== null);
    expect(boxed).toEqual(['star']);
  });
});
