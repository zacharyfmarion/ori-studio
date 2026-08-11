import { describe, expect, it } from 'vitest';
import { folded3dDrawPasses } from './foldedMeshSource';

const OPAQUE = { showFaces: true, showEdges: true, faceAlpha: 1 };

/** 30 face indices, the last 9 of them cells the layer solver could not order. */
const MIXED = {
  faceIndexCount: 30,
  undeterminedIndexStart: 21,
  undeterminedFaceAlpha: 0.45,
};

/** The same figure with every cell resolved — the ordinary case. */
const DETERMINED = { ...MIXED, undeterminedIndexStart: 30 };

describe('breaking a folded figure into draws', () => {
  it('draws a fully determined figure in one clearing pass over everything', () => {
    expect(folded3dDrawPasses(DETERMINED, OPAQUE)).toEqual([
      { clear: true, showEdges: true, faceAlpha: 1, faceRange: null },
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

  it('draws the creases once, in the first pass', () => {
    // Both passes drawing them would double their ink wherever the ranges meet.
    expect(folded3dDrawPasses(MIXED, OPAQUE).map((pass) => pass.showEdges)).toEqual([true, false]);
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
