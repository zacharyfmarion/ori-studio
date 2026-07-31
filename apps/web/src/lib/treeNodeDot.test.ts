import { describe, expect, it } from 'vitest';
import { treeDotPx, TREE_DOT_SELECTED_SCALE, type TreeDotSizes } from './treeNodeDot';

const BP: TreeDotSizes = { leafPx: 6, branchPx: 7 };
const DESIGN: TreeDotSizes = { leafPx: 7, branchPx: 8 };

describe('treeDotPx', () => {
  it('draws leaves smaller than branch nodes at rest', () => {
    expect(treeDotPx(BP, true, false)).toBeLessThan(treeDotPx(BP, false, false));
  });

  it('grows a selected dot past every dot at rest', () => {
    // The bug this guards: a selected flap tip used to be indistinguishable from
    // its unselected neighbours, because the leaf's own styling outranked the
    // selection's. Whatever else it wears, the picked dot has to be the biggest.
    const atRest = [
      treeDotPx(BP, true, false),
      treeDotPx(BP, false, false),
      treeDotPx(DESIGN, true, false),
      treeDotPx(DESIGN, false, false),
    ];
    expect(treeDotPx(BP, true, true)).toBeGreaterThan(Math.max(...atRest.slice(0, 2)));
    expect(treeDotPx(DESIGN, true, true)).toBeGreaterThan(Math.max(...atRest.slice(2)));
  });

  it('emphasises leaves and branch nodes by the same proportion', () => {
    // A river vertex and a flap tip are equally selectable; neither may get a
    // quieter selection than the other.
    for (const sizes of [BP, DESIGN]) {
      for (const isLeaf of [true, false]) {
        expect(treeDotPx(sizes, isLeaf, true) / treeDotPx(sizes, isLeaf, false)).toBeCloseTo(
          TREE_DOT_SELECTED_SCALE,
          10
        );
      }
    }
  });
});
