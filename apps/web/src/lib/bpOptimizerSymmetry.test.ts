import { describe, expect, it } from 'vitest';
import type {
  OristudioBpTreeEdge,
  OristudioBpTreeVertex,
  OristudioBpTreeView,
} from '../engine/oristudioBpTypes';
import { optimizerSymmetryAxisForFold, resolveOptimizerSymmetry } from './bpOptimizerSymmetry';

const SHEET = 8;
const CENTRE = { x: SHEET / 2, y: SHEET / 2 };

function vertex(id: number, x: number, y: number, isLeaf = true): OristudioBpTreeVertex {
  return {
    id,
    name: `v${id}`,
    loc: { x, y },
    isRoot: id === 0,
    isLeaf,
    degree: 1,
    dist: 0,
    height: 0,
    maxHeight: null,
    maxNewLeafLength: null,
    dualFlapId: null,
  };
}

function edge(id: number, a: number, b: number, length: number): OristudioBpTreeEdge {
  return {
    id,
    vertices: [a, b],
    length,
    maxLength: null,
    isLeafEdge: true,
    dualRiverId: null,
  };
}

function tree(
  vertices: OristudioBpTreeVertex[],
  edges: OristudioBpTreeEdge[] = []
): OristudioBpTreeView {
  return {
    rootVertexId: 0,
    sheet: {
      kind: 'rectangular',
      width: SHEET,
      height: SHEET,
      grid: { kind: 'rectangular', interval: 1, snap: true },
    },
    vertices,
    edges,
    maxTreeHeight: null,
  };
}

/** Root plus two mirrored leaves and one leaf on the axis. */
function bugTree() {
  return tree(
    [
      vertex(0, 4, 4, false),
      vertex(1, 2, 6),
      vertex(2, 6, 6),
      vertex(3, 4, 1),
    ],
    [edge(0, 0, 1, 3), edge(1, 0, 2, 3), edge(2, 0, 3, 3)]
  );
}

function symmetryState(overrides: Partial<Parameters<typeof resolveOptimizerSymmetry>[1]> = {}) {
  return {
    enabled: true,
    angle: 90,
    loc: CENTRE,
    pairs: [],
    ...overrides,
  };
}

describe('optimizerSymmetryAxisForFold', () => {
  it('puts a book fold along the grid on a rectangular sheet', () => {
    expect(optimizerSymmetryAxisForFold('rectangular', 'book')).toBe('verticalHalf');
    expect(optimizerSymmetryAxisForFold('rectangular', 'diagonal')).toBe('mainDiagonal');
  });

  it('swaps them on a diamond, where the paper is turned 45 degrees', () => {
    // The paper's corners point along the grid axes there, so a corner-to-corner
    // fold runs along a grid line and a book fold cuts across at 45 degrees.
    expect(optimizerSymmetryAxisForFold('diagonal', 'diagonal')).toBe('verticalHalf');
    expect(optimizerSymmetryAxisForFold('diagonal', 'book')).toBe('mainDiagonal');
  });
});

describe('resolveOptimizerSymmetry', () => {
  it('builds a total involution from explicit pairs plus on-axis flaps', () => {
    const result = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] }),
      { fold: 'book' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.axis).toBe('verticalHalf');
    expect(new Map(result.payload.partners)).toEqual(
      new Map([
        [1, 2],
        [2, 1],
        [3, 3],
      ])
    );
    expect(result.inconsistentPairs).toEqual([]);
  });

  it('infers a partner from where the flap is drawn', () => {
    // Read from the tree drawing, which random-layout mode leaves alone — it
    // discards the packing, not the tree.
    const result = resolveOptimizerSymmetry(bugTree(), symmetryState(), { fold: 'book' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Map(result.payload.partners).get(1)).toBe(2);
  });

  it('reads a flap drawn on the mirror line as its own mirror', () => {
    // Drawing snaps a flap onto the line, so this needs no separate declaring.
    const result = resolveOptimizerSymmetry(bugTree(), symmetryState(), { fold: 'book' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Map(result.payload.partners).get(3)).toBe(3);
  });

  it('names the flaps it cannot resolve rather than assuming the axis', () => {
    const lopsided = tree([
      vertex(0, 4, 4, false),
      vertex(1, 2, 6),
      vertex(2, 6, 6),
      vertex(3, 1, 2),
    ]);
    const result = resolveOptimizerSymmetry(
      lopsided,
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] }),
      { fold: 'book' }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('v3');
  });

  it('rejects an axis the optimizer cannot honour', () => {
    const offAngle = resolveOptimizerSymmetry(bugTree(), symmetryState({ angle: 30 }), {
      fold: 'book',
    });
    expect(offAngle.ok).toBe(false);

    const offCentre = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ loc: { x: 3, y: 4 }, pairs: [{ v1: 1, v2: 2 }] }),
      { fold: 'book' }
    );
    expect(offCentre.ok).toBe(false);
    if (offCentre.ok) return;
    expect(offCentre.reason).toContain('centre of the sheet');
  });

  it('is inactive when symmetry is turned off', () => {
    const result = resolveOptimizerSymmetry(bugTree(), symmetryState({ enabled: false }), {
      fold: 'book',
    });
    expect(result.ok).toBe(false);
  });

  it('flags a pairing that is not interchangeable in the tree', () => {
    // Leaves 1 and 2 are paired but hang off edges of different lengths, so
    // swapping them does not preserve the tree distances. Still a legal mirror,
    // just a wasteful one.
    const lopsided = tree(
      [
        vertex(0, 4, 4, false),
        vertex(1, 2, 6),
        vertex(2, 6, 6),
        vertex(3, 4, 1),
      ],
      [edge(0, 0, 1, 3), edge(1, 0, 2, 5), edge(2, 0, 3, 3)]
    );
    const result = resolveOptimizerSymmetry(
      lopsided,
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] }),
      { fold: 'book' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inconsistentPairs.length).toBeGreaterThan(0);
  });
});

describe('on-axis declaration', () => {
  it('accepts a self-pair as "this flap sits on the axis"', () => {
    // A flap on the axis has no partner to pair with, so a pair whose two
    // members are the same flap is how the user says so when inference is off.
    const result = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({
        pairs: [
          { v1: 1, v2: 2 },
          { v1: 3, v2: 3 },
        ],
      }),
      { fold: 'book' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Map(result.payload.partners).get(3)).toBe(3);
  });
});

describe('the sides the tree was drawn on', () => {
  it('names the left member of each pair, and nothing on the axis', () => {
    // Vertex 1 sits at x=2, left of the centre line at x=4; its partner 2 is at
    // x=6. Vertex 3 is on the axis and has no side.
    const result = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] }),
      { fold: 'book' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.negativeSide).toEqual([1]);
  });

  it('follows the drawing when the pair is drawn the other way round', () => {
    const mirrored = tree(
      [vertex(0, 4, 4, false), vertex(1, 6, 6), vertex(2, 2, 6), vertex(3, 4, 1)],
      [edge(0, 0, 1, 3), edge(1, 0, 2, 3), edge(2, 0, 3, 3)]
    );
    const result = resolveOptimizerSymmetry(
      mirrored,
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] }),
      { fold: 'book' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.negativeSide).toEqual([2]);
  });

  it('is unaffected by the fold, which only decides where that side lands', () => {
    const book = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] }),
      { fold: 'book' }
    );
    const diagonal = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] }),
      { fold: 'diagonal' }
    );
    expect(book.ok && diagonal.ok).toBe(true);
    if (!book.ok || !diagonal.ok) return;
    expect(book.payload.negativeSide).toEqual(diagonal.payload.negativeSide);
    expect(book.payload.axis).not.toBe(diagonal.payload.axis);
  });
});
