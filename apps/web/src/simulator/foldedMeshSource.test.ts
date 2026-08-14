import { describe, expect, it } from 'vitest';
import { folded3dDrawPasses } from './foldedMeshSource';

const OPAQUE = { showFaces: true, showEdges: true, faceAlpha: 1 };

/**
 * 30 face indices, the last 9 of them cells the layer solver could not order,
 * and 12 creases of which the last 4 belong to those cells.
 */
const MIXED = {
  faceIndexCount: 30,
  undeterminedIndexStart: 21,
  edgeCount: 12,
  undeterminedEdgeStart: 8,
  undeterminedFaceAlpha: 0.45,
};

/** The same figure with every cell resolved — the ordinary case. */
const DETERMINED = { ...MIXED, undeterminedIndexStart: 30, undeterminedEdgeStart: 12 };

describe('breaking a folded figure into draws', () => {
  it('draws a fully determined figure in one clearing pass over everything', () => {
    expect(folded3dDrawPasses(DETERMINED, OPAQUE)).toEqual([
      { clear: true, showEdges: true, faceAlpha: 1, faceRange: null, edgeRange: null },
    ]);
  });

  it('splits an opaque figure that has cells it could not order', () => {
    // The two ranges must tile the buffer exactly: a gap drops paper, an overlap
    // draws it twice and the second draw is the translucent one, so the seam
    // would show as a darker band.
    const passes = folded3dDrawPasses(MIXED, OPAQUE);
    expect(passes).toHaveLength(2);
    expect(passes[0]!.faceRange).toEqual({ start: 0, count: 21 });
    expect(passes[1]!.faceRange).toEqual({ start: 21, count: 9 });
  });

  it('tiles the creases across the two passes as well', () => {
    // A crease belongs to a layer now, so it has to be drawn with that layer's
    // paper. The two runs partition the creases for the same reason the face
    // ranges do: a gap loses linework, an overlap doubles its ink.
    const passes = folded3dDrawPasses(MIXED, OPAQUE);
    expect(passes[0]!.edgeRange).toEqual({ start: 0, count: 8 });
    expect(passes[1]!.edgeRange).toEqual({ start: 8, count: 4 });
  });

  it('clears once, on the first pass only', () => {
    // A clear on the second pass erases the first, which is the whole reason
    // `MeshDrawOptions.clear` exists.
    expect(folded3dDrawPasses(MIXED, OPAQUE).map((pass) => pass.clear)).toEqual([true, false]);
  });

  it('draws the unordered cells translucent and the rest opaque', () => {
    // The signal itself: "these layers could be either way round" is said by
    // seeing through them, not by picking one order and drawing it confidently.
    expect(folded3dDrawPasses(MIXED, OPAQUE).map((pass) => pass.faceAlpha)).toEqual([1, 0.45]);
  });

  it('lets each pass draw its own creases', () => {
    // Not "creases in the first pass only", which is what this said while a
    // crease was one undisplaced line belonging to no layer: an undetermined
    // cell's linework would then be drawn against the resolved stack's depth and
    // at the wrong opacity. The ranges above are what keep the ink single.
    expect(folded3dDrawPasses(MIXED, OPAQUE).map((pass) => pass.showEdges)).toEqual([true, true]);
  });

  it('draws no creases in either pass when the caller asked for none', () => {
    const passes = folded3dDrawPasses(MIXED, { ...OPAQUE, showEdges: false });
    expect(passes.map((pass) => pass.showEdges)).toEqual([false, false]);
  });

  it('stays one pass when the style has already made everything translucent', () => {
    // Under the X-ray style every cell is see-through, so separating the
    // unordered ones says nothing that is not already said.
    const passes = folded3dDrawPasses(MIXED, { ...OPAQUE, faceAlpha: 0.06 });
    expect(passes).toHaveLength(1);
    expect(passes[0]!.faceAlpha).toBe(0.06);
  });

  it('stays one pass for a wireframe style, which draws no faces at all', () => {
    expect(folded3dDrawPasses(MIXED, { ...OPAQUE, showFaces: false })).toHaveLength(1);
  });

  it('keeps the caller’s edge setting on a single pass', () => {
    // `None0` draws neither, and the pass must not quietly turn creases back on.
    const passes = folded3dDrawPasses(DETERMINED, { ...OPAQUE, showEdges: false });
    expect(passes[0]!.showEdges).toBe(false);
  });
});
