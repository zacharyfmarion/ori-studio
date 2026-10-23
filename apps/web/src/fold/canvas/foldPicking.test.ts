import { describe, expect, it } from 'vitest';
import { bookScene, flatSquareLandmarks, flatSquareScene } from './foldCanvas.fixtures';
import {
  foldPickIndex,
  foldStackAt,
  pickRef,
  resolveFoldEdgePoint,
  resolveFoldPick,
  sameFoldHit,
  sheetPointsTogether,
  sheetToScene,
  topSheetPointAt,
} from './foldPicking';
import type { FoldLandmarks } from '../engine/foldEngineWire';

const RADII = { point: 0.03, line: 0.03 };
const point = { snap: 'point', edges: true, free: false } as const;
const line = { snap: 'crease-required', edges: true, free: false } as const;

describe('Fold picking', () => {
  it('snaps free-line ends to the same point targets on each pane, with exact raw fallback', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), [{ at: [1 / 3, 0], mark: 'fmark-1' }]);
    const snapping = { snap: 'free', edges: false, free: false, snapFree: true } as const;
    for (const pane of ['folded', 'crease-pattern'] as const) {
      const targets = pane === 'folded' ? index.folded : index.creasePattern;
      expect(targets.points.length).toBeGreaterThan(4);
      for (const target of targets.points) {
        const at = { x: target.at.x + 0.001, y: target.at.y + 0.001 };
        const reference = resolveFoldPick(index, pane, at, RADII, point);
        if (reference?.kind !== 'point') throw new Error('missing point target');
        expect(resolveFoldPick(index, pane, at, RADII, snapping))
          .toEqual({ kind: 'free', pane, sheet: reference.sheet, scene: reference.scene });
      }
      const at = { x: 0.37, y: 0.42 };
      expect(resolveFoldPick(index, pane, at, RADII, snapping))
        .toEqual({ kind: 'free', pane, sheet: [at.x, at.y], scene: at });
      const near = { x: 0.01, y: 0.01 };
      for (const rule of [{ ...snapping, snapFree: false }, { ...snapping, free: true }]) {
        expect(resolveFoldPick(index, pane, near, RADII, rule))
          .toEqual({ kind: 'free', pane, sheet: [near.x, near.y], scene: near });
      }
    }
    // Off-paper endpoints remain usable on the folded pane.
    expect(resolveFoldPick(index, 'folded', { x: 2, y: 0.42 }, RADII, snapping))
      .toMatchObject({ kind: 'free', sheet: null, scene: { x: 2, y: 0.42 } });
  });

  it('keeps a buried CP target in its own material coordinates when a free end snaps', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const pick = resolveFoldPick(index, 'crease-pattern', { x: 0.99, y: 0.99 }, RADII,
      { snap: 'free', edges: false, free: false, snapFree: true });
    expect(pick).toEqual({ kind: 'free', pane: 'crease-pattern', sheet: [1, 1], scene: { x: 0, y: 1 } });
  });

  it('snaps a point step to the landmark nearest, named by its sheet point', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const corner = resolveFoldPick(index, 'folded', { x: 0.99, y: 0.01 }, RADII, point);
    expect(corner).toMatchObject({ kind: 'point', pane: 'folded', provenance: 'vertex', sheet: [1, 0] });
    if (corner?.kind !== 'point') throw new Error('no point');
    expect(pickRef(corner)).toEqual({ kind: 'point', at: [1, 0] });
    // An edge's middle is a landmark too.
    expect(resolveFoldPick(index, 'folded', { x: 0.5, y: 0.01 }, RADII, point)).toMatchObject({
      provenance: 'midpoint',
      sheet: [0.5, 0],
    });
    // Nothing near: nothing taken.
    expect(resolveFoldPick(index, 'folded', { x: 0.4, y: 0.4 }, RADII, point)).toBeNull();
  });

  it('puts a free point (Alt) down where it is, on the top face, and nowhere off the paper', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const free = { ...point, free: true };
    // On the book the right half lies on top, mirrored: x = 0.2 is its sheet x = 0.8.
    const pick = resolveFoldPick(index, 'folded', { x: 0.2, y: 0.4 }, RADII, free);
    expect(pick).toMatchObject({ kind: 'point', provenance: 'free' });
    if (pick?.kind !== 'point') throw new Error('no point');
    expect(pick.sheet[0]).toBeCloseTo(0.8, 12);
    expect(pick.sheet[1]).toBeCloseTo(0.4, 12);
    expect(resolveFoldPick(index, 'folded', { x: 0.8, y: 0.4 }, RADII, free)).toBeNull();
  });

  it('takes the topmost face and the stack from the subfaces', () => {
    const index = foldPickIndex(bookScene(), null, []);
    expect(foldStackAt(index, { x: 0.25, y: 0.5 })).toEqual([1, 0]);
    expect(foldStackAt(index, { x: 0.75, y: 0.5 })).toEqual([]);
    expect(topSheetPointAt(index, { x: 0.25, y: 0.5 })?.[0]).toBeCloseTo(0.75, 12);
  });

  it('picks a crease on the crease pattern by Fold’s edge id, and a fold only where the step wants one', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const bend = resolveFoldPick(index, 'crease-pattern', { x: 0.51, y: 0.5 }, RADII, line);
    expect(bend).toMatchObject({ kind: 'segment', edge: 6, segment: 'bend', sheet: [[0.5, 0], [0.5, 1]] });
    if (bend?.kind !== 'segment') throw new Error('no segment');
    // Where the crease is on the folded pane: the bend is the form's right edge.
    expect(bend.scene[0].x).toBeCloseTo(0.5, 12);
    expect(pickRef(bend)).toEqual({ kind: 'edge', a: [0.5, 0], b: [0.5, 1] });
    // The paper's raw edge counts for an axiom, not for an existing crease.
    const edge = { x: 0.99, y: 0.5 };
    expect(resolveFoldPick(index, 'crease-pattern', edge, RADII, line)).toMatchObject({ segment: 'raw_edge' });
    expect(resolveFoldPick(index, 'crease-pattern', edge, RADII, { ...line, edges: false })).toBeNull();
  });

  it('takes a swivel’s pivot on a folded edge: a landmark on it, or the point of it under the pointer', () => {
    const index = foldPickIndex(bookScene(), null, []);
    // The fold at sheet x = ½, away from any landmark: the point of it under the pointer, the fold riding along.
    const along = resolveFoldEdgePoint(index, 'crease-pattern', { x: 0.51, y: 0.3 }, RADII, null);
    expect(along).toMatchObject({ kind: 'point', provenance: 'fold', fold: { edge: 6, segment: 'bend' } });
    if (along?.kind !== 'point') throw new Error('no point');
    expect(along.sheet[0]).toBeCloseTo(0.5, 12);
    expect(along.sheet[1]).toBeCloseTo(0.3, 12);
    expect(along.scene?.x).toBeCloseTo(0.5, 12);
    // Near its end, kept inside it: the engine takes a point strictly between its ends.
    const end = resolveFoldEdgePoint(index, 'crease-pattern', { x: 0.5, y: 0.0001 }, RADII, null);
    if (end?.kind !== 'point') throw new Error('no point');
    expect(end.sheet[1]).toBeGreaterThan(0.001);
    // Its middle, a landmark on it: taken as it is, the fold riding along.
    const middle = resolveFoldPick(index, 'crease-pattern', { x: 0.5, y: 0.51 }, RADII, point);
    expect(resolveFoldEdgePoint(index, 'crease-pattern', { x: 0.5, y: 0.51 }, RADII, middle)).toMatchObject({
      provenance: 'midpoint',
      sheet: [0.5, 0.5],
      fold: { edge: 6 },
    });
    // A corner, on no fold between its ends: as it is. Far from any fold: nothing.
    const corner = resolveFoldPick(index, 'crease-pattern', { x: 0.99, y: 0.99 }, RADII, point);
    expect(resolveFoldEdgePoint(index, 'crease-pattern', { x: 0.99, y: 0.99 }, RADII, corner)).toBe(corner);
    expect(resolveFoldEdgePoint(index, 'crease-pattern', { x: 0.8, y: 0.4 }, RADII, null)).toBeNull();
  });

  it('takes the paper on top where several layers’ points lie together, whatever order the engine lists them in', () => {
    // The book's bottom-left corner: the left half's corner under the right half's, both seen, the lower listed first.
    const landmarks: FoldLandmarks = {
      points: [
        {
          at: [0, 0],
          visible: true,
          sources: [
            { kind: 'vertex', vertex: 0, sheet: [0, 0], visible: true },
            { kind: 'vertex', vertex: 2, sheet: [1, 0], visible: true },
          ],
        },
      ],
      lines: [],
      segments: [],
    };
    const index = foldPickIndex(bookScene(), landmarks, []);
    expect(resolveFoldPick(index, 'folded', { x: 0.01, y: 0.01 }, RADII, point)).toMatchObject({ provenance: 'vertex', sheet: [1, 0] });
    // On the crease pattern each is where it is.
    expect(resolveFoldPick(index, 'crease-pattern', { x: 0.01, y: 0.01 }, RADII, point)).toMatchObject({ sheet: [0, 0] });
    // Every other layer's point at that spot, top first: what a point that stays put may be swapped for.
    expect(sheetPointsTogether(index, [0, 0])).toEqual([[1, 0]]);
    expect(sheetPointsTogether(index, [1, 0])).toEqual([[0, 0]]);
    expect(sheetPointsTogether(index, [0.25, 0.5])).toEqual([[0.75, 0.5]]);
    expect(sheetPointsTogether(index, [3, 3])).toEqual([]);
  });

  it('maps a sheet point to the scene through a face that holds it', () => {
    const scene = bookScene();
    const folded = sheetToScene(scene, [0.8, 0.3]);
    expect(folded?.x).toBeCloseTo(0.2, 12);
    expect(folded?.y).toBeCloseTo(0.3, 12);
    expect(sheetToScene(scene, [0.2, 0.3])).toEqual({ x: 0.2, y: 0.3 });
    expect(sheetToScene(scene, [1.5, 0.3])).toBeNull();
  });

  it('takes a Divide-line mark as a point of the crease pattern, its id riding along', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), [{ at: [1 / 3, 0], mark: 'fmark-1' }]);
    const mark = resolveFoldPick(index, 'crease-pattern', { x: 0.34, y: 0.005 }, RADII, point);
    expect(mark).toMatchObject({ kind: 'point', pane: 'crease-pattern', provenance: 'mark', mark: 'fmark-1' });
    if (mark?.kind !== 'point') throw new Error('no point');
    expect(pickRef(mark)).toEqual({ kind: 'mark', at: [1 / 3, 0], mark: 'fmark-1' });
  });

  it('snaps to a crease mark’s ends on both panes, hidden or not on the crease pattern', () => {
    const landmarks = flatSquareLandmarks();
    const end = (sheet: [number, number], visible: boolean) => ({
      at: sheet,
      sources: [{ kind: 'crease_mark_end' as const, crease_mark: 0, sheet, visible }],
      visible,
    });
    const scene = {
      ...flatSquareScene(),
      crease_marks: [{ from: { x: 0.5, y: 0.45 }, to: { x: 0.5, y: 0.55 }, letter: 'valley' as const, made_at: 1,
        pieces: [{ face: 0, from: { x: 0.5, y: 0.45 }, to: { x: 0.5, y: 0.55 }, seen: 'valley' as const }] }],
    };
    const index = foldPickIndex(scene, { ...landmarks, points: [...landmarks.points, end([0.5, 0.45], true), end([0.5, 0.55], false)] }, []);
    // Where the viewer sees it, on the folded pane; the hidden end is not there to click.
    expect(resolveFoldPick(index, 'folded', { x: 0.51, y: 0.45 }, RADII, point)).toMatchObject({
      provenance: 'crease-mark-end',
      sheet: [0.5, 0.45],
    });
    expect(resolveFoldPick(index, 'folded', { x: 0.51, y: 0.55 }, RADII, point)).toBeNull();
    // The crease pattern shows every layer: both ends.
    expect(resolveFoldPick(index, 'crease-pattern', { x: 0.51, y: 0.55 }, RADII, point)).toMatchObject({
      provenance: 'crease-mark-end',
      sheet: [0.5, 0.55],
    });
    // A partial flat crease is also a line reference, named by its stretch.
    expect(resolveFoldPick(index, 'crease-pattern', { x: 0.51, y: 0.5 }, RADII, line)).toMatchObject({
      kind: 'segment', segment: 'crease', creaseMark: true, sheet: [[0.5, 0.45], [0.5, 0.55]],
    });
    expect(index.creasePattern.creaseMarks).toHaveLength(1);
  });

  it('tells a hit from the one a frame ago by what it takes, a free one by where it is', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const at = (x: number, y: number) => ({
      pane: 'folded' as const,
      at: { x, y },
      pick: resolveFoldPick(index, 'folded', { x, y }, RADII, point),
    });
    expect(sameFoldHit(at(0.99, 0.01), at(0.995, 0.005))).toBe(true);
    expect(sameFoldHit(at(0.99, 0.01), at(0.01, 0.01))).toBe(false);
    // Bare paper is bare paper wherever on it the pointer is: nothing to redraw.
    expect(sameFoldHit(at(0.4, 0.4), at(0.41, 0.4))).toBe(true);
    expect(sameFoldHit(at(0.4, 0.4), at(0.99, 0.01))).toBe(false);
    expect(sameFoldHit(at(0.4, 0.4), { ...at(0.4, 0.4), pane: 'crease-pattern' })).toBe(false);
    // Over a woven section, another interval is another stack to show.
    expect(sameFoldHit({ ...at(0.4, 0.4), interval: 0 }, { ...at(0.45, 0.4), interval: 0 })).toBe(true);
    expect(sameFoldHit({ ...at(0.4, 0.4), interval: 0 }, { ...at(0.6, 0.4), interval: 1 })).toBe(false);
    const free = (x: number) => ({
      pane: 'folded' as const,
      at: { x, y: 0.5 },
      pick: { kind: 'free' as const, pane: 'folded' as const, scene: { x, y: 0.5 }, sheet: [x, 0.5] as [number, number] },
    });
    expect(sameFoldHit(free(0.3), free(0.3))).toBe(true);
    expect(sameFoldHit(free(0.3), free(0.31))).toBe(false);
  });
});


describe('a located hinge using another layer’s reference', () => {
  it('keeps an exactly coincident image but anchors to the folded edge', () => {
    const index=foldPickIndex(bookScene(),{
      points: [],
      lines: [{ line: { n: [1, 0], d: 0.5 }, segments: [6], visible: true }],
      segments: [{ edge: 6, kind: 'bend', sheet: { a: [0.5, 0], b: [0.5, 1] },
        at: [[0.5, 0], [0.5, 1]], line: 0, visible: [[0, 1]] }],
    },[]);
    // The reference belongs to different material under the edge. Its
    // resolved image is the common location; its sheet point is not on x=½.
    const reference={kind:'point',provenance:'crossing',sheet:[0.2,0.4],scene:{x:0.5,y:0.4},mark:null} as const;
    expect(resolveFoldEdgePoint(index,'folded',reference.scene,RADII,reference)).toEqual(reference);
    const hinge=resolveFoldEdgePoint(index,'folded',reference.scene,RADII,reference,true);
    expect(hinge).toMatchObject({kind:'point',provenance:'fold',sheet:[0.5,0.4],scene:reference.scene,fold:{edge:6}});
    // A nearby reference is not silently shifted. Nor is a sheet-pane
    // reference reinterpreted as a different piece of material.
    const near={...reference,scene:{x:0.5005,y:0.4}};
    expect(resolveFoldEdgePoint(index,'folded',near.scene,RADII,near,true)).toEqual(near);
    expect(resolveFoldEdgePoint(index,'crease-pattern',reference.scene,RADII,reference,true)).toEqual(reference);
  });
});
