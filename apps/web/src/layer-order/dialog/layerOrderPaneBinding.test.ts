import { describe, expect, it } from 'vitest';
import { dispatch, openFactsOf, opened } from '../model/layerOrderModel.fixtures';
import { layerOrderFaceMarks } from './layerOrderPaneBinding';

/** Opened on a host order that puts face 3 inside the fold at the crease of faces 0 and 2 (D19). */
const inside = () =>
  opened(openFactsOf({ openedOn: { kind: 'closest', moved: 4, ignored: 0, inside: { face: 3, crease: [0, 2] } } })).state;

describe('the D19 notice on the panes', () => {
  it('lights the face inside the fold and its crease while nothing else is lit', () => {
    const marks = layerOrderFaceMarks(inside());
    expect(marks.row).toEqual([3]);
    expect(marks.crease).toEqual([0, 2]);
  });

  it('steps aside once a face is picked, and comes back while the notice is pointed at', () => {
    const picking = dispatch(inside(), { type: 'face_picked', face: 2, origin: 'pattern' }).state;
    const quiet = layerOrderFaceMarks(picking);
    expect(quiet.row).not.toContain(3);
    expect(quiet.crease).toBeNull();
    const lit = layerOrderFaceMarks(picking, true);
    expect(lit.row).toContain(3);
    expect(lit.crease).toEqual([0, 2]);
  });

  it('marks no crease when the engine names none, or the order folds', () => {
    const named = opened(openFactsOf({ openedOn: { kind: 'closest', moved: 4, ignored: 0 } })).state;
    expect(layerOrderFaceMarks(named).crease).toBeNull();
    expect(layerOrderFaceMarks(named).row).toEqual([]);
    expect(layerOrderFaceMarks(opened().state).crease).toBeNull();
  });
});
