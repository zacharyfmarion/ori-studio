import { describe, expect, it } from 'vitest';
import type {
  OristudioBpTreeEdge,
  OristudioBpTreeVertex,
  OristudioBpTreeView,
} from '../engine/oristudioBpTypes';
import { optimizerSymmetryAxisForMirror, resolveOptimizerSymmetry } from './bpOptimizerSymmetry';

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
    angle: 90,
    loc: CENTRE,
    fold: 'book' as const,
    quarterTurn: false,
    pairs: [],
    ...overrides,
  };
}

describe('optimizerSymmetryAxisForMirror', () => {
  it('puts a book fold along the grid on a rectangular sheet', () => {
    expect(optimizerSymmetryAxisForMirror('rectangular', { fold: 'book', quarterTurn: false })).toBe('verticalHalf');
    expect(optimizerSymmetryAxisForMirror('rectangular', { fold: 'diagonal', quarterTurn: false })).toBe('mainDiagonal');
  });

  it('swaps them on a diamond, where the paper is turned 45 degrees', () => {
    // The paper's corners point along the grid axes there, so a corner-to-corner
    // fold runs along a grid line and a book fold cuts across at 45 degrees.
    expect(optimizerSymmetryAxisForMirror('diagonal', { fold: 'diagonal', quarterTurn: false })).toBe('verticalHalf');
    expect(optimizerSymmetryAxisForMirror('diagonal', { fold: 'book', quarterTurn: false })).toBe('mainDiagonal');
  });

  it('names each of the four axes exactly once across the eight inputs', () => {
    // Two sheet kinds × two folds × two turns, and the kernel has four axes. Each
    // has to be reachable — an axis no input names is one the optimizer can be
    // asked for and never is — and each pairing has to be one-to-one, or two
    // different designs would resolve to the same mirror.
    const inputs = (['rectangular', 'diagonal'] as const).flatMap((kind) =>
      (['book', 'diagonal'] as const).flatMap((fold) =>
        [false, true].map((quarterTurn) => ({
          kind,
          axis: optimizerSymmetryAxisForMirror(kind, { fold, quarterTurn }),
        }))
      )
    );
    for (const kind of ['rectangular', 'diagonal'] as const) {
      const axes = inputs.filter((entry) => entry.kind === kind).map((entry) => entry.axis);
      expect(new Set(axes).size).toBe(4);
    }
  });

  it('never lets the class depend on the turn', () => {
    // The fold decides book-versus-diagonal and the turn decides which of that
    // pair. If a turn could change the class, "this model is book-symmetric"
    // would stop being a fact about the model.
    const diagonalAxes = new Set(['mainDiagonal', 'antiDiagonal']);
    for (const kind of ['rectangular', 'diagonal'] as const) {
      for (const fold of ['book', 'diagonal'] as const) {
        const straight = optimizerSymmetryAxisForMirror(kind, { fold, quarterTurn: false });
        const turned = optimizerSymmetryAxisForMirror(kind, { fold, quarterTurn: true });
        expect(diagonalAxes.has(turned)).toBe(diagonalAxes.has(straight));
        expect(turned).not.toBe(straight);
      }
    }
  });
});

describe('resolveOptimizerSymmetry', () => {
  it('builds a total involution from explicit pairs plus on-axis flaps', () => {
    const result = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] })
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
    const result = resolveOptimizerSymmetry(bugTree(), symmetryState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Map(result.payload.partners).get(1)).toBe(2);
  });

  it('reads a flap drawn on the mirror line as its own mirror', () => {
    // Drawing snaps a flap onto the line, so this needs no separate declaring.
    const result = resolveOptimizerSymmetry(bugTree(), symmetryState());
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
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('v3');
  });

  it('rejects an axis the optimizer cannot honour', () => {
    const offAngle = resolveOptimizerSymmetry(bugTree(), symmetryState({ angle: 30 }));
    expect(offAngle.ok).toBe(false);

    const offCentre = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ loc: { x: 3, y: 4 }, pairs: [{ v1: 1, v2: 2 }] })
    );
    expect(offCentre.ok).toBe(false);
    if (offCentre.ok) return;
    expect(offCentre.reason).toContain('centre of the sheet');
  });

  it('does not ask whether mirror draw is on', () => {
    // Mirror draw decides whether a *new* node is drawn with a twin. Whether the
    // design is symmetric is a property of the drawing, and the run's own
    // `respectSymmetry` option is the per-run opt out — so a design stays
    // optimizable symmetrically after the user stops drawing that way.
    const result = resolveOptimizerSymmetry(bugTree(), symmetryState());
    expect(result.ok).toBe(true);
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
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] })
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
      })
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
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] })
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
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.negativeSide).toEqual([2]);
  });

  it('is unaffected by the fold, which only decides where that side lands', () => {
    const book = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ pairs: [{ v1: 1, v2: 2 }] })
    );
    const diagonal = resolveOptimizerSymmetry(
      bugTree(),
      symmetryState({ fold: 'diagonal', pairs: [{ v1: 1, v2: 2 }] })
    );
    expect(book.ok && diagonal.ok).toBe(true);
    if (!book.ok || !diagonal.ok) return;
    expect(book.payload.negativeSide).toEqual(diagonal.payload.negativeSide);
    expect(book.payload.axis).not.toBe(diagonal.payload.axis);
  });
});
