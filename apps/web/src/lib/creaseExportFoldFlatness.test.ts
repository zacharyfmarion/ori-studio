import { describe, expect, it } from 'vitest';
import { hasNonClassicCreases, isFlatFoldableFold } from './creaseExportFold';
import { segmentFoldDocument } from './creasePatternSegmentation';
import type { FoldDocument } from '../engine/types';

/** One bordered square split by a single diagonal crease, whose angle the test sets. */
function oneSquare(diagonalAngle: number | null): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M'],
    edges_foldAngle: [0, 0, 0, 0, diagonalAngle],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  } as FoldDocument;
}

/**
 * Two bordered squares side by side, each with its own diagonal crease.
 *
 * The shared wall is a **border**, not a mountain: segments are regions enclosed by
 * border creases, so an `M` wall would make this one region rather than two.
 */
function twoPatterns(leftAngle: number, rightAngle: number): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
      [0, 3],
      [1, 4],
      [2, 5],
      [0, 4],
      [1, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'M', 'M'],
    edges_foldAngle: [0, 0, 0, 0, 0, 0, 0, leftAngle, rightAngle],
    faces_vertices: [
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
    ],
  } as FoldDocument;
}

describe('isFlatFoldableFold', () => {
  it('accepts a pattern whose creases are all full folds', () => {
    expect(isFlatFoldableFold(oneSquare(-180))).toBe(true);
  });

  it('accepts +180 as readily as -180', () => {
    expect(isFlatFoldableFold(oneSquare(180))).toBe(true);
  });

  it('tolerates rounding, so a 180 that arrived as 179.9999999 still counts as flat', () => {
    expect(isFlatFoldableFold(oneSquare(-179.9999999))).toBe(true);
  });

  it('rejects a partial fold — the case the layer solver cannot represent', () => {
    // A 90-degree crease puts faces out of plane, where the solver's adjacency reasoning
    // does not hold; it fails with SameParityAdjacentFaces rather than a usable message.
    expect(isFlatFoldableFold(oneSquare(-90))).toBe(false);
    expect(isFlatFoldableFold(oneSquare(45))).toBe(false);
  });

  it('treats a fold with no angles at all as flat', () => {
    // An imported pattern that never recorded angles is classic by construction; assuming
    // otherwise would disable folding for every such file.
    const fold = oneSquare(-180);
    delete (fold as { edges_foldAngle?: unknown }).edges_foldAngle;
    expect(isFlatFoldableFold(fold)).toBe(true);
  });

  it('ignores null entries, which mark edges that are not creases', () => {
    expect(isFlatFoldableFold(oneSquare(null))).toBe(true);
  });

  it('scopes to one pattern, so a partial fold elsewhere does not disable a flat one', () => {
    const fold = twoPatterns(-180, -45);
    const segments = segmentFoldDocument(fold);
    expect(segments.length).toBe(2);

    // Exactly one region carries the partial fold; the other must stay foldable, because
    // the dialogs fold one pattern at a time.
    const scoped = segments.map((segment) => isFlatFoldableFold(fold, segment));
    expect(scoped.filter(Boolean).length).toBe(1);

    // Unscoped — "All patterns" — the document as a whole is not flat-foldable.
    expect(isFlatFoldableFold(fold)).toBe(false);
  });

  it('keeps both regions foldable when every crease is a full fold', () => {
    const fold = twoPatterns(-180, 180);
    const segments = segmentFoldDocument(fold);
    expect(segments.map((segment) => isFlatFoldableFold(fold, segment))).toEqual([true, true]);
    expect(isFlatFoldableFold(fold)).toBe(true);
  });
});

describe('hasNonClassicCreases', () => {
  it('is false for a pattern whose creases are all full folds', () => {
    expect(hasNonClassicCreases(oneSquare(-180))).toBe(false);
    expect(hasNonClassicCreases(oneSquare(180))).toBe(false);
  });

  it('is true for a partial fold', () => {
    expect(hasNonClassicCreases(oneSquare(-90))).toBe(true);
    expect(hasNonClassicCreases(oneSquare(45))).toBe(true);
  });

  it('counts a 0-degree crease, which flat-foldability does not', () => {
    // The whole reason this is a separate predicate. `isFlatAngle` calls 0 flat, because an
    // unfolded crease leaves every face in the plane and the layer solver can run. But 0 is
    // not a *full* fold: the canvas draws it at the ramp's anchor or at the opacity floor,
    // so the export has an encoding to offer and the control must not be hidden.
    expect(isFlatFoldableFold(oneSquare(0))).toBe(true);
    expect(hasNonClassicCreases(oneSquare(0))).toBe(true);
  });

  it('tolerates rounding, so a 180 that arrived as 179.9999999 is still classic', () => {
    // Without the epsilon this reads as a 179.9999999-degree partial fold and every crease
    // in the document steps down to the opacity ceiling.
    expect(hasNonClassicCreases(oneSquare(-179.9999999))).toBe(false);
  });

  it('ignores borders and flat creases, which carry an angle of 0 by construction', () => {
    // `oneSquare`'s four borders are all at 0. Reading the angle without the assignment
    // would call every bordered pattern non-classic — and fade its sheet outline.
    expect(hasNonClassicCreases(oneSquare(-180))).toBe(false);

    const withAuxiliary = oneSquare(-180);
    withAuxiliary.edges_assignment = ['B', 'B', 'B', 'B', 'F'];
    withAuxiliary.edges_foldAngle = [0, 0, 0, 0, 0];
    expect(hasNonClassicCreases(withAuxiliary)).toBe(false);
  });

  it('treats a missing or null angle as classic', () => {
    // Matches `foldAngleFromParts`, which reads an absent magnitude as a full fold.
    expect(hasNonClassicCreases(oneSquare(null))).toBe(false);

    const fold = oneSquare(-180);
    delete (fold as { edges_foldAngle?: unknown }).edges_foldAngle;
    expect(hasNonClassicCreases(fold)).toBe(false);
  });

  it('scopes to one pattern, so a partial fold elsewhere does not surface the control', () => {
    const fold = twoPatterns(-180, -45);
    const segments = segmentFoldDocument(fold);
    expect(segments.length).toBe(2);

    const scoped = segments.map((segment) => hasNonClassicCreases(fold, segment));
    expect(scoped.filter(Boolean).length).toBe(1);

    // Unscoped — "All patterns" — the document as a whole does carry one.
    expect(hasNonClassicCreases(fold)).toBe(true);
  });
});
