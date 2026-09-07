import { describe, expect, it } from 'vitest';
import {
  REFERENCES_ALL_CREASES,
  REFERENCES_DIM_ALPHA,
  REFERENCES_EMPHASIS_WIDTH,
  planVisibility,
  targetVisibility,
  unreadVisibility,
} from './referencesCreaseVisibility';
import type { ReferencesFlatStep } from './referencesBreakdown';
import type { ReferencesPlanVariant } from './referencesResults';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';

function step(id: number, cpLineIds: number[]): PrecreaseStep {
  return {
    id,
    kind: 'cp',
    tag: 'cp',
    line: { n: [1, 0], d: 0 },
    line_id: id,
    segment: [
      [0, 0],
      [1, 0],
    ],
    extent: { kind: 'full' },
    round: 1,
    witnesses: [],
    chosen: null,
    ease: 0,
    hard: false,
    err: 0,
    unlocks: [],
    cp_line_ids: cpLineIds,
    visible: true,
    witnesses_complete: true,
    hoisted: false,
  };
}

function variant(steps: PrecreaseStep[]): ReferencesPlanVariant {
  return {
    sequence: { steps } as unknown as PrecreaseSequence,
    model: { steps: [], points: [], edges: {}, findings: [] } as unknown as
      ReferencesPlanVariant['model'],
  };
}

const SHEET = new Set([1, 2, 3, 4, 10, 11, 12]);
const BORDER = new Set([1, 2, 3, 4]);

describe('planVisibility', () => {
  const variants = [variant([step(1, [10]), step(2, [11]), step(3, [12])])];
  const flat: ReferencesFlatStep[] = [
    { component: 0, step: 0 },
    { component: 0, step: 1 },
    { component: 0, step: 2 },
  ];
  const input = { sheetLineIds: SHEET, borderLineIds: BORDER, activeLineIds: new Set<number>() };

  it('shows the border plus the creases made so far, and nothing later', () => {
    const at = planVisibility(variants, flat, 1, input);
    expect([...(at.visible ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11]);
    // Step 3's crease has not been folded yet.
    expect(at.visible?.has(12)).toBe(false);
  });

  it('dims the creases earlier steps made, and never the paper', () => {
    const at = planVisibility(variants, flat, 1, input);
    expect(at.dimmed?.has(11)).toBe(false);
    expect(at.dimmed?.has(10)).toBe(true);
    // The border is the paper the folds are drawn on, not one of them.
    expect(at.dimmed?.has(1)).toBe(false);
    expect(at.visible?.has(1)).toBe(true);
    expect(at.dimAlpha).toBe(REFERENCES_DIM_ALPHA);
  });

  it('shows the finished pattern at the last step', () => {
    const at = planVisibility(variants, flat, 2, input);
    expect([...(at.visible ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11, 12]);
  });

  it('never leaks a crease that is not on the selected sheet', () => {
    const withStranger = [variant([step(1, [10, 99])])];
    const at = planVisibility(withStranger, [{ component: 0, step: 0 }], 0, input);
    expect(at.visible?.has(99)).toBe(false);
  });

  // A plan carried over from a multi-sheet run must not build up another
  // pattern's creases into this one.
  it('ignores steps belonging to another component', () => {
    const two = [variant([step(1, [10])]), variant([step(1, [11])])];
    const flatTwo: ReferencesFlatStep[] = [
      { component: 1, step: 0 },
      { component: 0, step: 0 },
    ];
    const at = planVisibility(two, flatTwo, 1, input);
    expect(at.visible?.has(11)).toBe(false);
    expect(at.visible?.has(10)).toBe(true);
  });
});

describe('targetVisibility', () => {
  it('keeps the whole sheet, dimming all but the picked crease and the paper', () => {
    const at = targetVisibility({
      sheetLineIds: SHEET,
      borderLineIds: BORDER,
      activeLineIds: new Set([11]),
    });
    expect(at.visible).toBe(SHEET);
    expect(at.dimmed?.has(11)).toBe(false);
    expect(at.dimmed?.has(10)).toBe(true);
    expect(at.dimmed?.has(1)).toBe(false);
  });

  it('falls back to the whole document when no sheet is resolved', () => {
    expect(
      targetVisibility({ sheetLineIds: null, borderLineIds: null, activeLineIds: new Set() })
    ).toBe(REFERENCES_ALL_CREASES);
  });
});

describe('unreadVisibility', () => {
  it('shows the selected sheet whole when there is no step to be at', () => {
    const at = unreadVisibility({
      sheetLineIds: SHEET,
      borderLineIds: BORDER,
      activeLineIds: new Set(),
    });
    expect(at.visible).toBe(SHEET);
    expect(at.dimmed).toBeNull();
    expect(at.dimAlpha).toBe(1);
  });

  it('draws the whole document when no sheet is resolved', () => {
    expect(
      unreadVisibility({ sheetLineIds: null, borderLineIds: null, activeLineIds: new Set() })
    ).toBe(REFERENCES_ALL_CREASES);
  });
});

describe('emphasis', () => {
  it('widens the step’s own creases instead of recolouring them', () => {
    const at = planVisibility(
      [variant([step(1, [10]), step(2, [11])])],
      [
        { component: 0, step: 0 },
        { component: 0, step: 1 },
      ],
      1,
      { sheetLineIds: SHEET, borderLineIds: BORDER, activeLineIds: new Set() }
    );
    expect([...(at.emphasis ?? [])]).toEqual([11]);
    expect(at.emphasisWidth).toBe(REFERENCES_EMPHASIS_WIDTH);
    // …and the same crease is therefore not in the dimmed set.
    expect(at.dimmed?.has(11)).toBe(false);
  });

  it('emphasises the picked crease when one reference is being read', () => {
    const at = targetVisibility({
      sheetLineIds: SHEET,
      borderLineIds: BORDER,
      activeLineIds: new Set([11]),
    });
    expect([...(at.emphasis ?? [])]).toEqual([11]);
  });
});
