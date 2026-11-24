import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
} from '../../engine/oristudioCpTypes';
import {
  flipFoldedState,
  foldedFigureCurrentCase,
  foldedFigureCycling,
  foldedFigureDrawsPaper,
  foldedFigureListsEqual,
  foldedFigureRefoldStyle,
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
  function flat(
    snapshot: Partial<OristudioCpFoldedFigureSnapshot>
  ): OristudioCpFoldedFigureEntry {
    return { snapshot, folded3d: null } as unknown as OristudioCpFoldedFigureEntry;
  }

  function spatial(
    snapshot: Partial<OristudioCpFolded3dSnapshot>
  ): OristudioCpFoldedFigureEntry {
    return { snapshot: null, folded3d: snapshot } as unknown as OristudioCpFoldedFigureEntry;
  }

  it('reads a flat figure', () => {
    expect(
      foldedFigureCycling(
        flat({
          find_another_overlap_valid: true,
          discovered_fold_cases: 3,
          current_fold_case: 2,
        })
      )
    ).toEqual({ hasNext: true, discovered: 3, current: 2, wrapsToFirst: false });
  });

  it('reads a 3D figure the same way', () => {
    expect(
      foldedFigureCycling(
        spatial({
          find_another_overlap_valid: true,
          discovered_fold_cases: 3,
          current_fold_case: 2,
        })
      )
    ).toEqual({ hasNext: true, discovered: 3, current: 2, wrapsToFirst: false });
  });

  it('reports the wrap only once more than one solution is known', () => {
    const exhausted = { find_another_overlap_valid: false, discovered_fold_cases: 4 };
    expect(foldedFigureCycling(spatial(exhausted)).wrapsToFirst).toBe(true);
    expect(
      foldedFigureCycling(spatial({ ...exhausted, discovered_fold_cases: 1 })).wrapsToFirst
    ).toBe(false);
  });

  it('falls back to the discovered count for a figure saved before the two split', () => {
    expect(
      foldedFigureCycling(
        flat({ find_another_overlap_valid: false, discovered_fold_cases: 5 })
      ).current
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
      foldedFigureCycling({ snapshot: null, folded3d: null } as OristudioCpFoldedFigureEntry)
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

describe('foldedFigureRefoldStyle', () => {
  // The three ways a flat fold can end, as the kernel reports them: Paper with
  // an order, or rewound to the see-through stage with none.
  const solved = { display_style: 'Paper5', discovered_fold_cases: 1, outcome: 'Solved' } as const;
  const contradiction = { display_style: 'Transparent3', discovered_fold_cases: 0, outcome: 'Contradiction' } as const;
  const noSolutions = { display_style: 'Transparent3', discovered_fold_cases: 0, outcome: 'NoSolutions' } as const;

  function figure(
    displayStyle: OristudioCpFoldedFigureDisplayStyle,
    snapshot: Partial<OristudioCpFoldedFigureSnapshot> | null,
    folded3d: Partial<OristudioCpFolded3dSnapshot> | null = null
  ): OristudioCpFoldedFigureEntry {
    return { displayStyle, snapshot, folded3d } as unknown as OristudioCpFoldedFigureEntry;
  }
  const next = (snapshot: Partial<OristudioCpFoldedFigureSnapshot>) => snapshot as OristudioCpFoldedFigureSnapshot;

  // The report: Paper asked of a contradiction made the kernel search again and
  // throw, so Refold failed where a fresh fold of the same creases drew.
  it('lands a Paper figure see-through when its refold finds no layer order', () => {
    expect(foldedFigureRefoldStyle(figure('Paper5', solved), next(contradiction))).toBe('Transparent3');
    expect(foldedFigureRefoldStyle(figure('Paper5', solved), next(noSolutions))).toBe('Transparent3');
  });

  it('keeps a style that draws without a layer order', () => {
    expect(foldedFigureRefoldStyle(figure('Wire2', solved), next(contradiction))).toBe('Wire2');
    expect(foldedFigureRefoldStyle(figure('Transparent3', solved), next(contradiction))).toBe('Transparent3');
  });

  it('keeps a chosen style when the refold folds', () => {
    expect(foldedFigureRefoldStyle(figure('Paper5', solved), next(solved))).toBe('Paper5');
    expect(foldedFigureRefoldStyle(figure('Transparent3', solved), next(solved))).toBe('Transparent3');
  });

  // The round trip: add the crease that makes it self-intersect, refold, take
  // it out again, refold. The see-through style was the contradiction's, so the
  // figure comes back as Paper, as a fresh fold of those creases does.
  it('returns a figure a contradiction made see-through to Paper once it folds again', () => {
    expect(foldedFigureRefoldStyle(figure('Transparent3', contradiction), next(solved))).toBe('Paper5');
    expect(foldedFigureRefoldStyle(figure('Transparent3', contradiction), next(contradiction))).toBe('Transparent3');
  });

  it('keeps Wireframe chosen on a figure without a layer order', () => {
    expect(foldedFigureRefoldStyle(figure('Wire2', contradiction), next(solved))).toBe('Wire2');
  });

  // A 3D figure folding flat again: its style was chosen (any style projects in
  // 3D), and it has no flat snapshot to have stopped at.
  it('keeps a 3D figure’s style unless the flat refold cannot draw it', () => {
    const spatial = { verdict: { verdict: 'no_layer_order' }, discovered_fold_cases: 0 };
    expect(foldedFigureRefoldStyle(figure('Transparent3', null, spatial), next(solved))).toBe('Transparent3');
    expect(foldedFigureRefoldStyle(figure('Paper5', null, spatial), next(contradiction))).toBe('Transparent3');
  });
});

describe('foldedFigureDrawsPaper', () => {
  it('is false only for a flat fold that found no layer order', () => {
    const flat = (snapshot: Partial<OristudioCpFoldedFigureSnapshot>) =>
      ({ snapshot, folded3d: null }) as unknown as OristudioCpFoldedFigureEntry;
    expect(foldedFigureDrawsPaper(flat({ display_style: 'Paper5', discovered_fold_cases: 1, outcome: 'Solved' }))).toBe(true);
    expect(
      foldedFigureDrawsPaper(flat({ display_style: 'Transparent3', discovered_fold_cases: 0, outcome: 'Contradiction' }))
    ).toBe(false);
    // A 3D figure's picture is projected in the app, in any style.
    const spatial = { snapshot: null, folded3d: { verdict: { verdict: 'no_layer_order' }, discovered_fold_cases: 0 } };
    expect(foldedFigureDrawsPaper(spatial as unknown as OristudioCpFoldedFigureEntry)).toBe(true);
  });
});
