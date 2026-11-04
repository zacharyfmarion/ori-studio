import { describe, expect, it } from 'vitest';
import { StackHitIndex } from '../../cp-workspace/picking/stackHitIndex';
import { TINT } from '../../cp-workspace/renderer/fillTint';
import { paneFacesOf } from './layerPaneFigure';
import {
  baseFoldedPaint,
  baseMarks,
  basePatternPaint,
  FACE_RING_PX,
  NO_FACE_MARKS,
  overAlpha,
  paneTintFills,
  pointerPanePaint,
  SUBJECT_RING_PX,
  type LayerFaceMarks,
  type LayerPaneTint,
  type LayerPanesView,
} from './layerPaneMarks';
import { zScene } from './layerPanes.fixtures';

const FRONT: LayerPanesView = { side: 'front', xray: false, undecided: false, turnDeg: 0 };

const marks = (over: Partial<LayerFaceMarks>): LayerFaceMarks => ({ ...NO_FACE_MARKS, ...over });

/** Each tint as `ink alpha: faces or spots`, in drawing order, the alpha to 3 places. */
const read = (tints: readonly LayerPaneTint[]) =>
  tints.map(
    (tint) => `${tint.ink} ${+tint.alpha.toFixed(3)}: ${'faces' in tint ? `faces ${tint.faces.join(',')}` : `spots ${tint.spots.join(',')}`}`
  );

/** Two tints of one ink, one over the other, as the renderer composes them. */
const compose = (under: number, over: number) => 1 - (1 - under) * (1 - over);

describe('the crease pattern’s marks, by role', () => {
  it('marks nothing with no marks', () => {
    expect(basePatternPaint(NO_FACE_MARKS)).toEqual({ tints: [], rings: [] });
    expect(pointerPanePaint(NO_FACE_MARKS, 'pattern')).toEqual({ tints: [], rings: [] });
  });

  it('tints every face with choices faintly while a subject is chosen; the pointer takes its face to the hover rung', () => {
    const lit = marks({ picking: 'subject', pickable: [0, 1, 2], pointed: 1 });
    expect(read(basePatternPaint(baseMarks(lit)).tints)).toEqual([`pick ${TINT.faint}: faces 0,1,2`]);
    const pointer = pointerPanePaint(lit, 'pattern');
    // Over the faint tint the face already has: together, exactly the hover rung.
    expect(pointer.tints).toHaveLength(1);
    const [tint] = pointer.tints;
    expect(tint).toMatchObject({ faces: [1], ink: 'pick' });
    expect(compose(TINT.faint, tint!.alpha)).toBeCloseTo(TINT.hover, 12);
    expect(pointer.rings).toEqual([{ face: 1, ink: 'pick', widthPx: FACE_RING_PX }]);
  });

  it('draws the subject strongest, with the only 2 px ring, and several objects alike (D21)', () => {
    const paint = basePatternPaint(marks({ picking: 'object', pickable: [1, 2, 3, 4], subject: 0, objects: [2, 3] }));
    expect(read(paint.tints)).toEqual([
      `pick ${TINT.faint}: faces 1,4`,
      `pick ${TINT.emphasis}: faces 0`,
      `pick ${TINT.hover}: faces 2,3`,
    ]);
    expect(paint.rings).toEqual([
      { face: 0, ink: 'pick', widthPx: SUBJECT_RING_PX },
      { face: 2, ink: 'pick', widthPx: FACE_RING_PX },
      { face: 3, ink: 'pick', widthPx: FACE_RING_PX },
    ]);
  });

  it('lights a pressed row’s subject and all its objects at the picked rung, on the pointer’s channel', () => {
    const row = marks({ row: [5, 6, 7] });
    expect(basePatternPaint(baseMarks(row))).toEqual({ tints: [], rings: [] });
    const paint = pointerPanePaint(row, 'pattern');
    expect(read(paint.tints)).toEqual([`pick ${TINT.picked}: faces 5,6,7`]);
    expect(paint.rings.map((ring) => ring.face)).toEqual([5, 6, 7]);
    // A row face that is faint already lands on the same rung.
    const faint = pointerPanePaint(marks({ picking: 'subject', pickable: [5], row: [5, 6] }), 'pattern');
    expect(read(faint.tints)).toEqual([`pick ${TINT.picked}: faces 6`, `pick ${+overAlpha(TINT.picked, TINT.faint).toFixed(3)}: faces 5`]);
  });

  it('draws a clash in danger, stronger while its reason is pointed at, and an object in it as the clash', () => {
    const clash = marks({ picking: 'object', pickable: [1, 2, 3], subject: 0, objects: [1, 2], clash: [2, 9] });
    const paint = basePatternPaint(clash);
    expect(read(paint.tints)).toEqual([
      `pick ${TINT.faint}: faces 3`,
      `pick ${TINT.emphasis}: faces 0`,
      `pick ${TINT.hover}: faces 1`,
      `danger ${TINT.moving}: faces 2,9`,
    ]);
    expect(paint.rings).toEqual([
      { face: 2, ink: 'danger', widthPx: FACE_RING_PX },
      { face: 9, ink: 'danger', widthPx: FACE_RING_PX },
      { face: 0, ink: 'pick', widthPx: SUBJECT_RING_PX },
      { face: 1, ink: 'pick', widthPx: FACE_RING_PX },
    ]);
    expect(read(basePatternPaint({ ...clash, clashStrong: true }).tints).at(-1)).toBe(`danger ${TINT.picked}: faces 2,9`);
    // Pointing at a face of the clash, or at the subject or an object, lights nothing more.
    for (const pointed of [9, 0, 1]) expect(pointerPanePaint({ ...clash, pointed }, 'pattern')).toEqual({ tints: [], rings: [] });
  });

  it('keeps what follows the pointer out of the base: a hover changes the base marks not at all', () => {
    const resting = marks({ picking: 'object', pickable: [1, 2], subject: 0 });
    expect(baseMarks(resting)).toBe(resting);
    expect(baseMarks({ ...resting, pointed: 2, row: [1] })).toEqual(resting);
  });
});

describe('the folded figure’s marks, by role', () => {
  const scene = zScene();

  it('tints nothing faint while a subject is chosen: that is the crease pattern’s', () => {
    const paint = baseFoldedPaint(marks({ picking: 'subject', pickable: [0, 1, 2] }), scene, FRONT);
    expect(paint.tints).toEqual([]);
  });

  it('tints the undecided spots of the side shown, only while the view’s Undecided is on', () => {
    const undecided = marks({ undecided: { front: [1], back: [0] } });
    expect(baseFoldedPaint(undecided, scene, FRONT).tints).toEqual([]);
    expect(read(baseFoldedPaint(undecided, scene, { ...FRONT, undecided: true }).tints)).toEqual([`pick ${TINT.faint}: spots 1`]);
    const back = baseFoldedPaint(undecided, zScene('back'), { side: 'back', xray: false, undecided: true, turnDeg: 0 });
    expect(read(back.tints)).toEqual([`pick ${TINT.faint}: spots 0`]);
  });

  it('choosing objects: their spots on top faintly, the subject’s other spots a rung up, its ring and the objects’ rings', () => {
    // Face 2 is on top of spot 1; the subject, face 0, lies under it there and alone on spot 0.
    const paint = baseFoldedPaint(marks({ picking: 'object', pickable: [1, 2], subject: 0, objects: [1, 2] }), scene, FRONT);
    expect(read(paint.tints)).toEqual([`pick ${TINT.faint}: spots 1`, `pick ${TINT.hover}: spots 0`]);
    expect(paint.rings.map(({ face, widthPx }) => [face, widthPx])).toEqual([
      [0, SUBJECT_RING_PX],
      [1, FACE_RING_PX],
      [2, FACE_RING_PX],
    ]);
  });

  it('the subject’s whole face when none of its spots is taken', () => {
    const paint = baseFoldedPaint(marks({ picking: 'object', subject: 1 }), scene, FRONT);
    expect(read(paint.tints)).toEqual([`pick ${TINT.hover}: faces 1`]);
  });

  it('lights the spots a preview changes, from the side shown, over the faint ones', () => {
    const changed = { front: new Uint32Array([1]), back: new Uint32Array([0]) };
    const paint = baseFoldedPaint(marks({ picking: 'object', pickable: [2], subject: 0, changed }), scene, FRONT);
    expect(read(paint.tints)).toEqual([`pick ${TINT.picked}: spots 1`, `pick ${TINT.hover}: spots 0`]);
    const back = baseFoldedPaint(marks({ changed }), zScene('back'), { ...FRONT, side: 'back' });
    expect(read(back.tints)).toEqual([`pick ${TINT.picked}: spots 0`]);
  });

  it('a row and the pointer as whole faces at the hover rung, composing with the base as the board does', () => {
    const lit = marks({ row: [1, 2], clash: [0], pointed: 1 });
    expect(read(baseFoldedPaint(baseMarks(lit), scene, FRONT).tints)).toEqual([`danger ${TINT.moving}: faces 0`]);
    const pointer = pointerPanePaint(lit, 'folded');
    expect(read(pointer.tints)).toEqual([`pick ${TINT.hover}: faces 1,2`, `pick ${TINT.hover}: faces 1`]);
    expect(pointer.rings.map(({ face }) => face)).toEqual([1, 2]);
  });
});

describe('a pane’s tints as one fill', () => {
  const scene = zScene();
  const inks = { pick: [0.5, 0.4, 1, 1] as const, danger: [1, 0, 0, 1] as const };

  it('fills faces by their rings and spots by the index’s cells, in order, at each rung', () => {
    const faces = paneFacesOf(scene);
    const index = new StackHitIndex(scene.subfaces);
    const tints: LayerPaneTint[] = [
      { faces: [0, 1], ink: 'pick', alpha: TINT.faint },
      { spots: [1], ink: 'danger', alpha: TINT.moving },
    ];
    const fill = paneTintFills(tints, { pick: [...inks.pick], danger: [...inks.danger] }, (face) => faces.pattern[face], index)!;
    // Two squares and one spot, two triangles each.
    expect(fill.count).toBe(18);
    const near = (values: number[]) => values.map((value) => expect.closeTo(value, 5));
    expect(Array.from(fill.color.slice(0, 4))).toEqual(near([0.5, 0.4, 1, TINT.faint]));
    expect(Array.from(fill.color.slice(12 * 4, 12 * 4 + 4))).toEqual(near([1, 0, 0, TINT.moving]));
  });

  it('is null when nothing is tinted, and skips a face with no ring', () => {
    expect(paneTintFills([], { pick: [1, 1, 1, 1], danger: [1, 1, 1, 1] }, () => undefined, null)).toBeNull();
    expect(
      paneTintFills([{ faces: [7], ink: 'pick', alpha: 0.5 }], { pick: [1, 1, 1, 1], danger: [1, 1, 1, 1] }, () => [], null)
    ).toBeNull();
  });

  it('takes a tint to a rung over another of the same ink, and adds nothing over a stronger one', () => {
    expect(compose(TINT.faint, overAlpha(TINT.picked, TINT.faint))).toBeCloseTo(TINT.picked, 12);
    expect(overAlpha(TINT.hover, TINT.emphasis)).toBe(0);
  });
});
