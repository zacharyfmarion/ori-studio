import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
} from '../../engine/oristudioCpTypes';
import {
  flipFoldedState,
  foldedFigureCurrentCase,
  foldedFigureCycling,
  foldedFigureListsEqual,
} from './foldedFigureState';

describe('flipFoldedState', () => {
  it('toggles Front <-> Back (turning the paper over)', () => {
    expect(flipFoldedState('Front0')).toBe('Back1');
    expect(flipFoldedState('Back1')).toBe('Front0');
  });

  it('resolves the overlay states to Back (reverse of the default Front view)', () => {
    expect(flipFoldedState('Both2')).toBe('Back1');
    expect(flipFoldedState('Transparent3')).toBe('Back1');
  });
});

describe('foldedFigureCycling', () => {
  // The four cycling fields are spelled the same way and mean the same thing on
  // both snapshots, which is the whole reason one solution verb can bind to
  // either. These factories are deliberately minimal: the accessor must not
  // reach past those four fields.
  function flat(snapshot: Partial<OristudioCpFoldedFigureSnapshot>): OristudioCpFoldedFigureEntry {
    return { snapshot, folded3d: null } as unknown as OristudioCpFoldedFigureEntry;
  }

  function spatial(snapshot: Partial<OristudioCpFolded3dSnapshot>): OristudioCpFoldedFigureEntry {
    return { snapshot: null, folded3d: snapshot } as unknown as OristudioCpFoldedFigureEntry;
  }

  it('reads a flat figure', () => {
    expect(
      foldedFigureCycling(
        flat({
          find_another_overlap_valid: true,
          discovered_fold_cases: 3,
          current_fold_case: 2,
        }),
      ),
    ).toEqual({ hasNext: true, discovered: 3, current: 2, wrapsToFirst: false });
  });

  it('reads a 3D figure the same way', () => {
    expect(
      foldedFigureCycling(
        spatial({
          find_another_overlap_valid: true,
          discovered_fold_cases: 3,
          current_fold_case: 2,
        }),
      ),
    ).toEqual({ hasNext: true, discovered: 3, current: 2, wrapsToFirst: false });
  });

  it('reports the wrap only once more than one solution is known', () => {
    const exhausted = { find_another_overlap_valid: false, discovered_fold_cases: 4 };
    expect(foldedFigureCycling(spatial(exhausted)).wrapsToFirst).toBe(true);
    expect(
      foldedFigureCycling(spatial({ ...exhausted, discovered_fold_cases: 1 })).wrapsToFirst,
    ).toBe(false);
  });

  it('falls back to the discovered count for a figure saved before the two split', () => {
    expect(
      foldedFigureCycling(flat({ find_another_overlap_valid: false, discovered_fold_cases: 5 }))
        .current,
    ).toBe(5);
  });

  it('reports nothing for a figure with neither snapshot', () => {
    expect(foldedFigureCycling(undefined)).toEqual({
      hasNext: false,
      discovered: 0,
      current: 0,
      wrapsToFirst: false,
    });
    expect(
      foldedFigureCycling({ snapshot: null, folded3d: null } as OristudioCpFoldedFigureEntry),
    ).toEqual({ hasNext: false, discovered: 0, current: 0, wrapsToFirst: false });
  });
});

describe('foldedFigureCurrentCase', () => {
  it('answers for a 3D figure, which has no flat snapshot to read', () => {
    const figure = {
      snapshot: null,
      folded3d: { discovered_fold_cases: 2, current_fold_case: 2 },
    } as unknown as OristudioCpFoldedFigureEntry;
    expect(foldedFigureCurrentCase(figure)).toBe(2);
  });
});

describe('foldedFigureListsEqual', () => {
  const entry = (id: string) => ({ id }) as OristudioCpFoldedFigureEntry;

  it('is what "the verb changed nothing" means, and nothing weaker', () => {
    const a = entry('folded-1');
    const b = entry('folded-2');
    expect(foldedFigureListsEqual([a, b], [a, b])).toBe(true);
    expect(foldedFigureListsEqual([], [])).toBe(true);
    expect(foldedFigureListsEqual([a], [a, b])).toBe(false);
    expect(foldedFigureListsEqual([a, b], [b, a])).toBe(false);
    // A rebuilt entry is a changed entry. Every verb that touches a figure
    // spreads it into a new object, so structural equality here would call a
    // real edit "unchanged" and swallow its undo step.
    expect(foldedFigureListsEqual([a], [entry('folded-1')])).toBe(false);
  });
});
