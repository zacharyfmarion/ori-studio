import { describe, expect, it } from 'vitest';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import type { SnapContext } from './annotateSnap';
import type { PicturePoint } from './annotationModel';
import { annotation, IN_3D, NO_ASSETS, sceneStep, uploadStep } from './pictureSnap.fixtures';
import { clickedOpening, draggedOpening, placeRightAngle, squaredOpening, towardMiddle } from './rightAnglePlacement';

/** The pictures' frame: a square, its longer side one unit. */
const FRAME = { width: 1, height: 1 };
const crease = (a: ScenePoint, b: ScenePoint) => line('diagram-valley', a, b);
const R = Math.SQRT1_2;
const round = (point: PicturePoint | null) =>
  point && point.map((value) => Math.round(value * 1000) / 1000 + 0);

/** A square with a diagonal from its top-left corner: the top-right and bottom-left corners are square. */
const DIAGONAL = sceneStep([face([SQUARE]), crease([0, 0], [100, 100])]);
/** A square crossed by both midlines: four right angles at its middle. */
const CROSS = sceneStep([face([SQUARE]), crease([50, 0], [50, 100]), crease([0, 50], [100, 50])]);

function context(step = DIAGONAL, overrides: Partial<SnapContext> = {}): SnapContext {
  return { step, assets: NO_ASSETS, annotations: [], enabled: true, radius: 0.1, style: DEFAULT_DIAGRAM_STYLE, ...overrides };
}

describe('placeRightAngle (decision 12)', () => {
  it('puts the corner on the vertex of the right angle the pointer is in, opening into it', () => {
    const start = placeRightAngle(context(), [0.95, 0.04], { free: false });
    expect(start.at).toEqual([1, 0]);
    expect(start.target).toEqual({ at: [1, 0], kind: 'corner' });
    expect(round(start.opens)).toEqual(round([-R, R]));
    // At the crossing: the quadrant the pointer is in.
    expect(round(placeRightAngle(context(CROSS), [0.46, 0.55], { free: false }).opens)).toEqual(round([-R, R]));
    expect(round(placeRightAngle(context(CROSS), [0.55, 0.45], { free: false }).opens)).toEqual(round([R, -R]));
  });

  it('snaps the corner and opens no way where it finds no right angle: in the dead zone, or where the diagonal halves one', () => {
    // On the vertex itself: too near to say which way.
    expect(placeRightAngle(context(), [0.995, 0.005], { free: false })).toEqual({
      at: [1, 0],
      target: { at: [1, 0], kind: 'corner' },
      opens: null,
    });
    // The top-left corner, which the diagonal halves.
    expect(placeRightAngle(context(), [0.04, 0.06], { free: false })).toMatchObject({ at: [0, 0], opens: null });
  });

  it('puts it where the pointer is with ⌘ held or snapping off', () => {
    expect(placeRightAngle(context(), [0.95, 0.04], { free: true })).toEqual({ at: [0.95, 0.04], target: null, opens: null });
    expect(placeRightAngle(context(DIAGONAL, { enabled: false }), [0.95, 0.04], { free: false })).toEqual({
      at: [0.95, 0.04],
      target: null,
      opens: null,
    });
  });

  it('snaps only the corner on a 3D picture, whose right angles are not drawn square', () => {
    const solid = sceneStep([line('diagram-valley', [0, 0], [100, 0]), line('diagram-valley', [100, 0], [100, 100])], IN_3D);
    const start = placeRightAngle(context(solid), [0.95, 0.04], { free: false });
    expect(start.opens).toBeNull();
    expect(start.at).toEqual([1, 0]);
  });

  it('squares to lines drawn on an upload, which has none of its own', () => {
    const { step, assets } = uploadStep();
    const lines = [
      annotation({ id: 'a', kind: 'valley-line', from: [0.2, 0.2], to: [0.8, 0.2] }),
      annotation({ id: 'b', kind: 'mountain-line', from: [0.2, 0.2], to: [0.2, 0.8] }),
    ];
    const start = placeRightAngle({ ...context(step), assets, annotations: lines }, [0.25, 0.24], { free: false });
    expect(start.at).toEqual([0.2, 0.2]);
    expect(start.target?.kind).toBe('annotation');
    expect(round(start.opens)).toEqual(round([R, R]));
  });
});

describe('draggedOpening', () => {
  it('opens square into the right angle a drag from its corner points into', () => {
    // From the crossing, a little off the diagonal of each quadrant.
    expect(round(draggedOpening(context(CROSS), [0.5, 0.5], [0.6, 0.55], { free: false, shift: false }))).toEqual(
      round([R, R])
    );
    expect(round(draggedOpening(context(CROSS), [0.5, 0.5], [0.45, 0.3], { free: false, shift: false }))).toEqual(
      round([-R, -R])
    );
  });

  it('opens toward the pointer where there is no right angle, Shift holding it to 45° steps, ⌘ to the pointer', () => {
    // The top-left corner, halved by the diagonal: no right angle to open into.
    expect(round(draggedOpening(context(), [0, 0], [0.3, 0.1], { free: false, shift: false }))).toEqual(
      round([3 / Math.hypot(3, 1), 1 / Math.hypot(3, 1)])
    );
    expect(round(draggedOpening(context(), [0, 0], [0.3, 0.1], { free: false, shift: true }))).toEqual([1, 0]);
    expect(round(draggedOpening(context(), [0, 0], [0.3, 0.2], { free: false, shift: true }))).toEqual(round([R, R]));
    // ⌘: the crossing's quadrant is not taken.
    expect(round(draggedOpening(context(CROSS), [0.5, 0.5], [0.6, 0.55], { free: true, shift: false }))).toEqual(
      round([1 / Math.hypot(1, 0.5), 0.5 / Math.hypot(1, 0.5)])
    );
  });

  it('says nothing below the shortest drag: a click', () => {
    expect(draggedOpening(context(CROSS), [0.5, 0.5], [0.505, 0.505], { free: false, shift: false })).toBeNull();
  });
});

describe('a click that found no right angle', () => {
  it('opens into the right angle at its corner nearest the way to the middle, else toward the middle', () => {
    // The top-right corner from its dead zone: its one right angle.
    const start = placeRightAngle(context(), [0.995, 0.005], { free: false });
    expect(round(clickedOpening(context(), start, FRAME, { free: false }))).toEqual(round([-R, R]));
    // Nowhere in particular: toward the middle, square on the page.
    const loose = placeRightAngle(context(), [0.3, 0.8], { free: false });
    expect(round(clickedOpening(context(), loose, FRAME, { free: false }))).toEqual(round([R, -R]));
    // What the press found comes first.
    const found = placeRightAngle(context(), [0.95, 0.04], { free: false });
    expect(clickedOpening(context(), found, FRAME, { free: false })).toBe(found.opens);
    // Lines drawn on an upload meeting square away from the middle: into their angle, not toward the middle.
    const { step, assets } = uploadStep();
    const lines = [
      annotation({ id: 'a', kind: 'valley-line', from: [0.3, 0.4], to: [0.1, 0.4] }),
      annotation({ id: 'b', kind: 'valley-line', from: [0.3, 0.4], to: [0.3, 0.1] }),
    ];
    const away = { ...context(step), assets, annotations: lines };
    const pressed = placeRightAngle(away, [0.301, 0.401], { free: false });
    expect(pressed).toMatchObject({ at: [0.3, 0.4], opens: null });
    expect(round(clickedOpening(away, pressed, FRAME, { free: false }))).toEqual(round([-R, -R]));
    expect(round(clickedOpening(away, pressed, FRAME, { free: true }))).toEqual(round([R, R]));
  });

  it('opens up and to the right from the middle itself', () => {
    expect(round(towardMiddle([0.5, 0.5], FRAME))).toEqual(round([R, -R]));
    expect(round(towardMiddle([0.5, 0.9], FRAME))).toEqual(round([R, -R]));
    expect(round(towardMiddle([0.9, 0.5], FRAME))).toEqual(round([-R, -R]));
  });
});

describe('squaredOpening', () => {
  it('turns a mark moved onto a corner into the right angle there nearest the way it opened', () => {
    expect(round(squaredOpening(context(CROSS), [0.5, 0.5], [0.9, 0.1], { free: false }))).toEqual(round([R, R]));
    expect(round(squaredOpening(context(CROSS), [0.5, 0.5], [-0.2, -0.9], { free: false }))).toEqual(round([-R, -R]));
    // Where there is none, or with ⌘, as it opened.
    expect(squaredOpening(context(), [0.3, 0.3], [1, 0], { free: false })).toEqual([1, 0]);
    expect(squaredOpening(context(CROSS), [0.5, 0.5], [1, 0], { free: true })).toEqual([1, 0]);
  });
});
