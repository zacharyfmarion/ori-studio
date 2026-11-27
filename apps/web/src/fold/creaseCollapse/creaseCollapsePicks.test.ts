import { describe, expect, it } from 'vitest';
import type { FoldEngineRefused, FoldScene } from '../engine/foldEngineWire';
import { collapsePieceAt, collapsePieceIndex, collapsePieces, type FoldCollapsePiece } from './creaseCollapsePieces';
import { clickPiece, collapsePicksKey, collapseStretches, pickOf, picksOn } from './creaseCollapsePicks';
import { collapseChoice, collapseProblem } from './useFoldCreaseCollapseTool';

/**
 * A flat square, front up, cut by its diagonal into two faces, with a
 * precrease along x = 0.5 that the diagonal crosses at the centre, and a
 * pinch mark from (0.25, 0.25) — on the diagonal — to (0, 0.5).
 */
function scene(): FoldScene {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0.5, y: 0 },
    { x: 0.5, y: 1 },
    { x: 0.5, y: 0.5 },
  ];
  const crease = (id: number, a: number, b: number, kind: 'border' | 'fold' | 'flat', letter: 'mountain' | 'valley' | null) => ({
    id,
    vertices: [a, b] as [number, number],
    from: points[a]!,
    to: points[b]!,
    kind,
    letter,
    made_at: kind === 'border' ? 0 : 1,
  });
  const identity = [1, 0, 0, 0, 1, 0] as const;
  return {
    creases: [
      crease(0, 0, 4, 'border', null),
      crease(1, 4, 1, 'border', null),
      crease(2, 1, 2, 'border', null),
      crease(3, 2, 5, 'border', null),
      crease(4, 5, 3, 'border', null),
      crease(5, 3, 0, 'border', null),
      crease(6, 0, 6, 'flat', 'valley'),
      crease(7, 6, 2, 'flat', 'valley'),
      crease(8, 4, 6, 'fold', 'mountain'),
      crease(9, 6, 5, 'fold', 'mountain'),
    ],
    crease_marks: [{ from: { x: 0.25, y: 0.25 }, to: { x: 0, y: 0.5 }, letter: 'valley', made_at: 1, pieces: [] }],
    sheet_points: points,
    faces: [
      { points: [0, 4, 6], outline: [], front_up: true },
      { points: [4, 1, 2, 6], outline: [], front_up: true },
      { points: [6, 2, 5], outline: [], front_up: true },
      { points: [0, 6, 5, 3], outline: [], front_up: true },
    ],
    face_transforms: [identity, identity, identity, identity],
    subfaces: [
      { polygon: [points[0], points[4], points[6]], faces_top_to_bottom: [0] },
      { polygon: [points[4], points[1], points[2], points[6]], faces_top_to_bottom: [1] },
      { polygon: [points[6], points[2], points[5]], faces_top_to_bottom: [2] },
      { polygon: [points[0], points[6], points[5], points[3]], faces_top_to_bottom: [3] },
    ],
  } as unknown as FoldScene;
}

const near = (p: readonly [number, number], q: readonly [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
const pieceFrom = (pieces: readonly FoldCollapsePiece[], a: [number, number], b: [number, number]) =>
  pieces.find((piece) => (near(piece.sheet[0], a) && near(piece.sheet[1], b)) || (near(piece.sheet[0], b) && near(piece.sheet[1], a)));

describe('Collapse’s pieces', () => {
  it('are the creases and marks, cut where a mark ends on a crease, never the border', () => {
    const pieces = collapsePieces(scene());
    // The diagonal's lower half is cut where the pinch ends on it.
    expect(pieceFrom(pieces, [0, 0], [0.25, 0.25])).toMatchObject({ now: 'open', letter: 'valley', mark: false });
    expect(pieceFrom(pieces, [0.25, 0.25], [0.5, 0.5])).toMatchObject({ now: 'open', mark: false });
    expect(pieceFrom(pieces, [0.5, 0.5], [1, 1])).toBeDefined();
    // The folds keep their letters.
    expect(pieceFrom(pieces, [0.5, 0], [0.5, 0.5])).toMatchObject({ now: 'mountain', letter: 'mountain' });
    // The mark is a piece of its own.
    expect(pieceFrom(pieces, [0.25, 0.25], [0, 0.5])).toMatchObject({ now: 'open', mark: true });
    // No border: 2 + 2 diagonal pieces, 2 fold halves, the mark.
    expect(pieces).toHaveLength(6);
  });

  it('are found under the pointer on the crease pattern, and drawn through the faces on the folded pane', () => {
    const index = collapsePieceIndex(scene(), scene());
    const hit = collapsePieceAt(index, 'crease-pattern', { x: 0.1, y: 0.11 }, 0.02);
    expect(hit && index.pieces[hit.piece]).toBe(pieceFrom(index.pieces, [0, 0], [0.25, 0.25]));
    expect(collapsePieceAt(index, 'crease-pattern', { x: 0.1, y: 0.8 }, 0.02)).toBeNull();
    const folded = collapsePieceAt(index, 'folded', { x: 0.5, y: 0.8 }, 0.02);
    expect(folded && index.pieces[folded.piece]?.now).toBe('mountain');
    // A crease between two faces is drawn once, seen.
    const images = index.images.filter((image) => image.piece === folded?.piece);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ visible: true, frontUp: true });
  });
});

describe('Collapse’s picks', () => {
  const pieces = collapsePieces(scene());
  const diagonal = pieceFrom(pieces, [0.5, 0.5], [1, 1])!;
  const fold = pieceFrom(pieces, [0.5, 0], [0.5, 0.5])!;

  it('set a piece to the letter in hand, set it again, or let it go', () => {
    const valley = clickPiece([], diagonal, 'valley');
    expect(valley).toEqual([{ a: diagonal.sheet[0], b: diagonal.sheet[1], to: 'valley', was: 'open', letter: 'valley' }]);
    // Again with another letter: set to that one.
    const mountain = clickPiece(valley, diagonal, 'mountain');
    expect(pickOf(mountain, diagonal)?.to).toBe('mountain');
    expect(mountain).toHaveLength(1);
    // Again with the same letter: let go.
    expect(clickPiece(mountain, diagonal, 'mountain')).toEqual([]);
    // A precrease clicked with Open, a mountain with Mountain: already that, nothing taken.
    expect(clickPiece([], diagonal, 'open')).toEqual([]);
    expect(clickPiece([], fold, 'mountain')).toEqual([]);
    // A mountain opened, then clicked with Mountain: back to what it is.
    const opened = clickPiece([], fold, 'open');
    expect(opened).toMatchObject([{ to: 'open', was: 'mountain', letter: 'mountain' }]);
    expect(clickPiece(opened, fold, 'mountain')).toEqual([]);
  });

  it('are asked for as stretches, keyed whatever their order, and let go when the paper has no piece for them', () => {
    const picks = clickPiece(clickPiece([], diagonal, 'valley'), fold, 'open');
    expect(collapseStretches(picks)).toEqual([
      { a: diagonal.sheet[0], b: diagonal.sheet[1], to: 'valley' },
      { a: fold.sheet[0], b: fold.sheet[1], to: 'open' },
    ]);
    expect(collapsePicksKey(picks)).toBe(collapsePicksKey([...picks].reverse()));
    expect(picksOn(picks, pieces)).toBe(picks);
    expect(picksOn(picks, [fold])).toEqual([picks[1]]);
  });
});

describe('Collapse’s orders and refusals', () => {
  it('step through the listed orders as the chooser counts them, the last part fastest', () => {
    const components = [{ orders: 2 }, { orders: 3 }];
    expect([0, 1, 2, 3, 5].map((k) => collapseChoice(components, k))).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]]);
    expect(collapseChoice([], 0)).toEqual([]);
  });

  it('say why the creases do not fold, and where', () => {
    const refused = (refusal: Record<string, unknown>) => ({ status: 'refused', refusal }) as unknown as FoldEngineRefused;
    expect(collapseProblem(refused({ code: 'collapse_not_flat_at_vertex', rule: 'maekawa', point: [0.5, 0.5] }))).toEqual({
      problem: 'vertex',
      points: [[0.5, 0.5]],
    });
    expect(collapseProblem(refused({ code: 'import_no_order', points: [[0.2, 0.3], 'x'] }))).toEqual({ problem: 'order', points: [[0.2, 0.3]] });
    expect(collapseProblem(refused({ code: 'collapse_crease_missing', point: [0, 1] })).problem).toBe('other');
  });
});
