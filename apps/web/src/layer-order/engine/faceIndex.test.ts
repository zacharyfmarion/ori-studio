import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import {
  FACE_LETTER_ROWS,
  assignFaceLetters,
  faceCentroidsOf,
  faceLetter,
  faceLettersOf,
  isLayerFace,
  kernelFaceOf,
  layerFaceOf,
  letterRank,
  paperRowsOf,
} from './faceIndex';

describe('the face bridge', () => {
  it('is the identity: dialog face k is Oriedita face k', () => {
    for (const face of [0, 1, 17, 4095]) {
      expect(kernelFaceOf(face)).toBe(face);
      expect(layerFaceOf(face)).toBe(face);
    }
  });

  it('names only a figure’s own faces', () => {
    expect(isLayerFace(0, 3)).toBe(true);
    expect(isLayerFace(2, 3)).toBe(true);
    expect(isLayerFace(3, 3)).toBe(false);
    expect(isLayerFace(-1, 3)).toBe(false);
    expect(isLayerFace(1.5, 3)).toBe(false);
    expect(isLayerFace('1', 3)).toBe(false);
  });
});

describe('face letters', () => {
  it('count A … Z, AA … AZ, BA … ZZ, AAA …', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702, 703].map(faceLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
      'AAB',
    ]);
  });

  it('read back to their rank, and nothing else does', () => {
    for (let rank = 0; rank < 2000; rank += 1) expect(letterRank(faceLetter(rank))).toBe(rank);
    for (const text of ['', 'a', 'A1', 'Ä', ' A']) expect(letterRank(text)).toBeNull();
  });
});

/** Six faces in two rows of three, numbered in no particular order. */
const GRID: [face: number, x: number, y: number][] = [
  [4, 50, 25],
  [0, 85, 75],
  [2, 15, 75],
  [5, 15, 25],
  [1, 85, 25],
  [3, 50, 75],
];

function pointsOf(faces: [face: number, x: number, y: number][]): Float64Array {
  const points = new Float64Array(faces.length * 2);
  for (const [face, x, y] of faces) points.set([x, y], face * 2);
  return points;
}

const PAPER = { top: 0, bottom: 100 };

describe('assignFaceLetters', () => {
  it('letters faces in the crease pattern’s reading order: rows from the top, left to right', () => {
    const letters = assignFaceLetters(pointsOf(GRID), PAPER);
    expect(letters.inLetterOrder).toEqual([5, 4, 1, 2, 3, 0]);
    expect([0, 1, 2, 3, 4, 5].map((face) => letters.letterOf(face))).toEqual(['F', 'C', 'D', 'E', 'B', 'A']);
    expect(letters.faceOf('A')).toBe(5);
    expect(letters.faceOf('F')).toBe(0);
    expect(letters.faceOf('G')).toBeNull();
    expect(letters.letterOf(6)).toBe('');
  });

  it('keeps a row together when its faces sit at slightly different heights', () => {
    // One row of the ten: y from 30 to 39.9 on a paper 100 high.
    const row: [number, number, number][] = [
      [0, 70, 39],
      [1, 10, 31],
      [2, 40, 35],
    ];
    expect(assignFaceLetters(pointsOf(row), PAPER).inLetterOrder).toEqual([1, 2, 0]);
  });

  it('breaks a tie in row and x by face number, so no two faces tie', () => {
    const stacked: [number, number, number][] = [
      [2, 50, 50],
      [0, 50, 51],
      [1, 50, 52],
    ];
    expect(assignFaceLetters(pointsOf(stacked), PAPER).inLetterOrder).toEqual([0, 1, 2]);
  });

  it('is the same for the same figure, at any scale or offset', () => {
    const first = assignFaceLetters(pointsOf(GRID), PAPER);
    const again = assignFaceLetters(pointsOf(GRID), PAPER);
    const moved = assignFaceLetters(
      pointsOf(GRID.map(([face, x, y]) => [face, x * 4 - 200, y * 4 - 200])),
      { top: -200, bottom: 200 }
    );
    expect(again.inLetterOrder).toEqual(first.inLetterOrder);
    expect(moved.inLetterOrder).toEqual(first.inLetterOrder);
  });

  it('cuts the paper into its rows, a point on the bottom edge in the last', () => {
    expect(FACE_LETTER_ROWS).toBe(10);
    const edges: [number, number, number][] = [
      [0, 10, 100],
      [1, 90, 95],
      [2, 50, 0],
    ];
    expect(assignFaceLetters(pointsOf(edges), PAPER).inLetterOrder).toEqual([2, 0, 1]);
  });

  it('a paper with no height reads one row, left to right', () => {
    const flat = pointsOf([
      [0, 3, 0],
      [1, 1, 0],
      [2, 2, 0],
    ]);
    expect(assignFaceLetters(flat, { top: 0, bottom: 0 }).inLetterOrder).toEqual([1, 2, 0]);
  });

  it('orders faces by letter for the face menu and a subject’s objects', () => {
    const letters = assignFaceLetters(pointsOf(GRID), PAPER);
    expect([0, 1, 2, 3, 4, 5].sort(letters.compare)).toEqual([5, 4, 1, 2, 3, 0]);
  });
});

describe('letters from a paper scene', () => {
  /**
   * Four faces in a 2 × 2 grid on the crease pattern, each a 10 × 10 square
   * about its centre, all folded onto one spot. The back scene shares the
   * front's sheet points, as the kernel's do.
   */
  const scene = (side: 'front' | 'back'): OristudioCpFoldedPaperScene => {
    const square = (x: number, y: number) => [
      { x: x - 5, y: y - 5 },
      { x: x + 5, y: y - 5 },
      { x: x + 5, y: y + 5 },
      { x: x - 5, y: y + 5 },
    ];
    const spot = square(5, 5);
    return {
      schema_version: 3,
      flipped: side === 'back',
      sheet: 40,
      faces: [0, 1, 2, 3].map((k) => ({
        outline: spot,
        points: [0, 1, 2, 3].map((corner) => k * 4 + corner),
        front_up: (k % 2 === 0) === (side === 'front'),
        edges: [],
      })),
      subfaces: [{ polygon: spot, faces_top_to_bottom: side === 'front' ? [0, 1, 2, 3] : [3, 2, 1, 0] }],
      aux_lines: [],
      sheet_points: [square(10, 10), square(30, 10), square(10, 30), square(30, 30)].flat(),
    };
  };

  it('places each face by its ring’s centroid on the crease pattern', () => {
    expect([...faceCentroidsOf(scene('front'))]).toEqual([10, 10, 30, 10, 10, 30, 30, 30]);
  });

  it('reads the paper’s height from the unfolded sheet', () => {
    expect(paperRowsOf(scene('front'))).toEqual({ top: 5, bottom: 35 });
  });

  it('letters the toy figure in reading order, the same from either side', () => {
    const front = faceLettersOf(scene('front'));
    expect([0, 1, 2, 3].map((face) => front.letterOf(face))).toEqual(['A', 'B', 'C', 'D']);
    expect(faceLettersOf(scene('back')).inLetterOrder).toEqual(front.inLetterOrder);
  });

  it('puts a face with no ring last', () => {
    const ringless = scene('front');
    ringless.faces[0] = { ...ringless.faces[0]!, points: [] };
    const letters = faceLettersOf(ringless);
    expect(letters.inLetterOrder).toEqual([1, 2, 3, 0]);
  });

  it('an older scene with no sheet points still letters every face, by number', () => {
    const older = { ...scene('front'), sheet_points: [] };
    expect(faceLettersOf(older).inLetterOrder).toEqual([0, 1, 2, 3]);
    expect(paperRowsOf(older)).toEqual({ top: 0, bottom: 0 });
  });
});
