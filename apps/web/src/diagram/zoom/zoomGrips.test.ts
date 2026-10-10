import { describe, expect, it } from 'vitest';
import type { PicturePoint } from '../annotate/annotationModel';
import type { DiagramZoomOutline } from '../document/diagramDocument';
import { draggedOutline, sameOutline, zoomGripAt, zoomGripPoint, zoomGrips } from './zoomGrips';
import { zoomOutlinePoints } from './zoomModel';

const circle: DiagramZoomOutline = { centre: [0.5, 0.4], radius: 0.2 };
const rectangle: DiagramZoomOutline = { centre: [0.5, 0.4], size: [0.4, 0.2] };
const turned: DiagramZoomOutline = { centre: [0.5, 0.4], size: [0.4, 0.2], angle: 90 };

const close = (point: PicturePoint) => [expect.closeTo(point[0], 9), expect.closeTo(point[1], 9)];

/** The outline's corner opposite `corner`, on the page. */
const corner = (outline: DiagramZoomOutline, index: 0 | 1 | 2 | 3) => zoomGripPoint(outline, { part: 'corner', corner: index });

describe('an enlarge area’s grips (Revision 2, S3)', () => {
  it('are a circle’s centre and rim; a rectangle’s centre, corners and edges, turned with it', () => {
    expect(zoomGrips(circle).map(({ grip }) => grip.part)).toEqual(['centre', 'rim']);
    expect(zoomGripPoint(circle, { part: 'rim' })).toEqual(close([0.7, 0.4]));
    expect(zoomGrips(rectangle).map(({ grip }) => grip.part)).toEqual([
      'centre',
      'corner',
      'corner',
      'corner',
      'corner',
      'edge',
      'edge',
      'edge',
      'edge',
    ]);
    expect(corner(rectangle, 0)).toEqual(close([0.3, 0.3]));
    expect(corner(rectangle, 2)).toEqual(close([0.7, 0.5]));
    expect(zoomGripPoint(rectangle, { part: 'edge', edge: 1 })).toEqual(close([0.7, 0.4]));
    // A quarter turn clockwise: its top-left corner is now at the top right.
    expect(corner(turned, 0)).toEqual(close([0.6, 0.2]));
  });

  it('takes a circle’s rim anywhere round it, its centre by its dot, nothing elsewhere', () => {
    expect(zoomGripAt(circle, [0.5, 0.21], 0.02)).toEqual({ part: 'rim' });
    expect(zoomGripAt(circle, [0.505, 0.4], 0.02)).toEqual({ part: 'centre' });
    expect(zoomGripAt(circle, [0.55, 0.45], 0.02)).toBeNull();
    // A circle smaller than the reach: its rim, on a tie, so it can still be resized.
    expect(zoomGripAt({ centre: [0, 0], radius: 0.01 }, [0.01, 0], 0.02)).toEqual({ part: 'rim' });
  });

  it('takes a rectangle’s nearest grip, a corner or an edge before its centre', () => {
    expect(zoomGripAt(rectangle, [0.71, 0.51], 0.02)).toEqual({ part: 'corner', corner: 2 });
    expect(zoomGripAt(rectangle, [0.5, 0.29], 0.02)).toEqual({ part: 'edge', edge: 0 });
    expect(zoomGripAt(rectangle, [0.5, 0.4], 0.02)).toEqual({ part: 'centre' });
    expect(zoomGripAt(rectangle, [0.4, 0.3], 0.02)).toBeNull();
  });
});

describe('the outline a grip’s drag makes', () => {
  it('moves the outline by its centre, as far as the pointer goes', () => {
    expect(draggedOutline(circle, { part: 'centre' }, [0.5, 0.4], [0.6, 0.45])).toEqual({
      centre: close([0.6, 0.45]),
      radius: 0.2,
    });
  });

  it('resizes a circle by its rim, as far in or out as the pointer has gone', () => {
    expect(draggedOutline(circle, { part: 'rim' }, [0.7, 0.4], [0.8, 0.4]).radius).toBeCloseTo(0.3, 9);
    expect(draggedOutline(circle, { part: 'rim' }, [0.5, 0.2], [0.5, 0.25]).radius).toBeCloseTo(0.15, 9);
  });

  it('drags a corner with the opposite one held — at any turn — or about the centre with Alt', () => {
    const dragged = draggedOutline(rectangle, { part: 'corner', corner: 2 }, [0.7, 0.5], [0.8, 0.6]);
    expect(dragged.size).toEqual(close([0.5, 0.3]));
    expect(corner(dragged, 0)).toEqual(close(corner(rectangle, 0)));
    expect(corner(dragged, 2)).toEqual(close([0.8, 0.6]));
    // Turned a quarter: its corner 2, on the page at the bottom left, goes where the pointer does; corner 0 stays.
    const from = corner(turned, 2);
    const turnedDrag = draggedOutline(turned, { part: 'corner', corner: 2 }, from, [from[0] - 0.05, from[1] + 0.1]);
    expect(corner(turnedDrag, 0)).toEqual(close(corner(turned, 0)));
    expect(corner(turnedDrag, 2)).toEqual(close([from[0] - 0.05, from[1] + 0.1]));
    const alt = draggedOutline(rectangle, { part: 'corner', corner: 2 }, [0.7, 0.5], [0.8, 0.6], { alt: true });
    expect(alt.centre).toEqual(close([0.5, 0.4]));
    expect(alt.size).toEqual(close([0.6, 0.4]));
  });

  it('keeps the aspect with Shift, by the side dragged further', () => {
    const square = draggedOutline(rectangle, { part: 'corner', corner: 2 }, [0.7, 0.5], [0.9, 0.52], { shift: true });
    // Half as wide again, and so half as tall again: the top-left corner held.
    expect(square.size).toEqual(close([0.6, 0.3]));
    expect(corner(square, 0)).toEqual(close(corner(rectangle, 0)));
    // An edge with Shift: the other side with it, about the line through the centre.
    const edge = draggedOutline(rectangle, { part: 'edge', edge: 1 }, [0.7, 0.4], [0.9, 0.4], { shift: true });
    expect(edge.size).toEqual(close([0.6, 0.3]));
    expect(edge.centre).toEqual(close([0.6, 0.4]));
  });

  it('drags an edge with the opposite one held, the other side kept', () => {
    const dragged = draggedOutline(rectangle, { part: 'edge', edge: 3 }, [0.3, 0.4], [0.4, 0.4]);
    expect(dragged.size).toEqual(close([0.3, 0.2]));
    expect(dragged.centre).toEqual(close([0.55, 0.4]));
  });

  it('turns a rectangle inside out past the side it is held from, never to nothing', () => {
    const past = draggedOutline(rectangle, { part: 'edge', edge: 1 }, [0.7, 0.4], [0.2, 0.4]);
    expect(past.size).toEqual(close([0.1, 0.2]));
    expect(past.centre).toEqual(close([0.25, 0.4]));
    const flat = draggedOutline(rectangle, { part: 'edge', edge: 1 }, [0.7, 0.4], [0.3, 0.4]);
    expect(flat.size![0]).toBeGreaterThan(0);
  });

  it('tells two outlines apart number for number', () => {
    expect(sameOutline(circle, { ...circle })).toBe(true);
    expect(sameOutline(rectangle, turned)).toBe(false);
    expect(zoomOutlinePoints(turned).length).toBeGreaterThan(0);
  });
});
