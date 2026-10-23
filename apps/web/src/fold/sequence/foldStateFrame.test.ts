import { describe, expect, it } from 'vitest';
import { MAX_STORED_STROKES } from '../../cp-workspace/sheets/sheetThumbnail';
import { diagonalHalfScene, squareScene } from './foldScene.fixtures';
import { applyIsometry, foldStateFrame, invertIsometry, sceneToModel, sheetToScene } from './foldStateFrame';

const roles = (strokes: readonly { role: string }[] | undefined) => (strokes ?? []).map((each) => each.role).sort();

describe('foldStateFrame', () => {
  it('reads the flat square: its box, its area, and that it is a rectangle a reader names by compass', () => {
    const frame = foldStateFrame(squareScene());
    expect(frame.bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(frame.area).toBeCloseTo(1);
    expect(frame.rectangular).toBe(true);
    expect(frame.creases.size).toBe(4);
  });

  it('takes a sheet point to the screen through the face it lies in', () => {
    const frame = foldStateFrame(diagonalHalfScene());
    // The top-left corner was folded onto the bottom-right.
    expect(sheetToScene(frame, [0, 1])).toEqual([1, 0]);
    expect(sheetToScene(frame, [1, 0])).toEqual([1, 0]);
    // Off the paper there is no face to go through.
    expect(sheetToScene(frame, [2, 2])).toBeNull();
    expect(sceneToModel(frame, [0.25, 0.75])).toEqual([0.25, 0.75]);
  });

  it('knows a folded silhouette is no rectangle, and halves the area', () => {
    const frame = foldStateFrame(diagonalHalfScene());
    expect(frame.area).toBeCloseTo(0.5);
    expect(frame.rectangular).toBe(false);
  });

  it('draws the crease pattern by its letters, and the folded form by the edges the viewer sees', () => {
    const square = foldStateFrame(squareScene());
    expect(roles(square.pattern?.strokes)).toEqual(['edge', 'edge', 'edge', 'edge']);
    expect(roles(square.form?.strokes)).toEqual(['edge', 'edge', 'edge', 'edge']);

    const folded = foldStateFrame(diagonalHalfScene());
    expect(roles(folded.pattern?.strokes)).toEqual(['edge', 'edge', 'edge', 'edge', 'valley']);
    // The folded half covers the half that stays: only its three edges show.
    expect(folded.form?.strokes).toHaveLength(3);
    // Fitted into the thumbnail's own box, snapped to a tenth, within what a file takes back.
    expect(folded.form?.viewBox).toBe('0 0 100 100');
    for (const stroke of folded.form?.strokes ?? []) {
      for (const value of [stroke.x1, stroke.y1, stroke.x2, stroke.y2]) {
        expect(Math.round(value * 10) / 10).toBe(value);
      }
    }
    expect(folded.form!.strokes.length).toBeLessThanOrEqual(MAX_STORED_STROKES);
  });

  it('draws a precrease and a crease mark in the crease pattern as aux lines, as the crease-pattern pane does', () => {
    const scene = diagonalHalfScene();
    const flat = { ...scene.creases.find((crease) => crease.kind !== 'border')!, kind: 'flat' as const };
    const marked = {
      ...scene,
      creases: scene.creases.map((crease) => (crease.kind === 'border' ? crease : flat)),
      crease_marks: [{ from: { x: 0.2, y: 0.5 }, to: { x: 0.3, y: 0.5 }, letter: 'mountain' as const, made_at: 1, pieces: [] }],
    };
    expect(roles(foldStateFrame(marked).pattern?.strokes)).toEqual(['aux', 'aux', 'edge', 'edge', 'edge', 'edge']);
  });

  it('inverts an isometry', () => {
    const turned: [number, number, number, number, number, number] = [0, -1, 1, 1, 0, 0];
    const inverse = invertIsometry(turned)!;
    const [x, y] = applyIsometry(turned, [0.3, 0.7]);
    expect(applyIsometry(inverse, [x, y])[0]).toBeCloseTo(0.3);
    expect(applyIsometry(inverse, [x, y])[1]).toBeCloseTo(0.7);
    expect(invertIsometry([0, 0, 0, 0, 0, 0])).toBeNull();
  });
});
