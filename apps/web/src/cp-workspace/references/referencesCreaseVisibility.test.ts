import { describe, expect, it } from 'vitest';
import {
  REFERENCES_ALL_CREASES,
  REFERENCES_DIM_ALPHA,
  REFERENCES_EMPHASIS_WIDTH,
  planVisibility,
  targetVisibility,
  unreadVisibility,
} from './referencesCreaseVisibility';
import type { ReferencesViewStep } from './referencesSequenceView';
import type { ReferencesPlanVariant } from './referencesResults';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';

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
    witnesses: [],
    chosen: null,
    ease: 0,
    hard: false,
    err: 0,
    direction: 'valley',
    direction_share: 1,
    side: 'front',
    unlocks: [],
    cp_line_ids: cpLineIds,
    cp_spans: [],
    visible: true,
    witnesses_complete: true,
    marks_exist: true,
    missing_marks: [],
    exact: true,
    pressed_on: [],
    made: [],
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

const fold = (step: number, component = 0): ReferencesViewStep => ({
  kind: 'fold',
  side: 'front',
  component,
  step,
});

const SHEET = new Set([1, 2, 3, 4, 10, 11, 12]);
const BORDER = new Set([1, 2, 3, 4]);

describe('planVisibility', () => {
  const variants = [variant([step(1, [10]), step(2, [11]), step(3, [12])])];
  const flat: ReferencesViewStep[] = [fold(0), fold(1), fold(2)];
  const input = { sheetLineIds: SHEET, borderLineIds: BORDER, activeLineIds: new Set<number>() };

  it('shows the border plus the creases made so far, and nothing later', () => {
    const at = planVisibility(variants, flat, 1, input);
    expect([...(at.visible ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10]);
    // Step 3's crease has not been folded yet.
    expect(at.visible?.has(12)).toBe(false);
  });

  // The one the step is asking for is not on the paper yet, so the pattern is
  // not where it comes from — the step's own diagram draws it, once.
  it('leaves out the crease the step is about', () => {
    const at = planVisibility(variants, flat, 1, input);
    expect(at.visible?.has(11)).toBe(false);
    expect(planVisibility(variants, flat, 0, input).visible?.has(10)).toBe(false);
    expect(planVisibility(variants, flat, 2, input).visible?.has(12)).toBe(false);
  });

  it('lets only the paper as it stands be picked', () => {
    const at = planVisibility(variants, flat, 1, input);
    expect(at.pickable).toBe(at.visible);
    // The finished card: everything, and everything pickable.
    const views: ReferencesViewStep[] = [...flat, { kind: 'done', side: 'front', component: 0 }];
    expect(planVisibility(variants, views, 3, input).pickable?.has(12)).toBe(true);
  });

  it('dims the creases earlier steps made, and never the paper', () => {
    const at = planVisibility(variants, flat, 1, input);
    expect(at.dimmed?.has(10)).toBe(true);
    // The border is the paper the folds are drawn on, not one of them.
    expect(at.dimmed?.has(1)).toBe(false);
    expect(at.visible?.has(1)).toBe(true);
    expect(at.dimAlpha).toBe(REFERENCES_DIM_ALPHA);
  });

  it('shows the finished pattern on the card that follows the last fold', () => {
    const views: ReferencesViewStep[] = [
      ...flat,
      { kind: 'done', side: 'front', component: 0 },
    ];
    const at = planVisibility(variants, views, 3, input);
    expect([...(at.visible ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11, 12]);
  });

  it('never leaks a crease that is not on the selected sheet', () => {
    const withStranger = [variant([step(1, [10, 99])])];
    const at = planVisibility(withStranger, [fold(0)], 0, input);
    expect(at.visible?.has(99)).toBe(false);
  });

  // A plan carried over from a multi-sheet run must not build up another
  // pattern's creases into this one.
  it('ignores steps belonging to another component', () => {
    const two = [
      variant([step(1, [10]), step(2, [12])]),
      variant([step(1, [11])]),
    ];
    const flatTwo: ReferencesViewStep[] = [fold(0, 1), fold(0, 0), fold(1, 0)];
    const at = planVisibility(two, flatTwo, 2, input);
    // Component 1's step 0 came earlier in the list; it is another sheet's.
    expect(at.visible?.has(11)).toBe(false);
    expect(at.visible?.has(10)).toBe(true);
  });
});

describe('targetVisibility', () => {
  // The whole sheet used to stay behind the construction, dimmed. Dimmed or
  // not, it was the pattern, and a reader who picked a crease at step 38 of
  // the plan took the build-up for part of the answer.
  it('shows the paper and the picked crease, and hides every other crease', () => {
    const at = targetVisibility({
      sheetLineIds: SHEET,
      borderLineIds: BORDER,
      activeLineIds: new Set([11]),
    });
    expect([...(at.visible ?? [])].sort()).toEqual([...BORDER, 11].sort());
    expect(at.visible?.has(10)).toBe(false);
    expect(at.dimmed).toBeNull();
    expect(at.dimAlpha).toBe(1);
    // Hidden creases are not there to point at: a click on one is a click on
    // blank paper, which clears the pick and brings the sheet back.
    expect(at.pickable).toBe(at.visible);
  });

  it('shows blank paper for a picked vertex, which has no crease of its own', () => {
    const at = targetVisibility({
      sheetLineIds: SHEET,
      borderLineIds: BORDER,
      activeLineIds: new Set(),
    });
    expect([...(at.visible ?? [])].sort()).toEqual([...BORDER].sort());
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
  // A plan step has nothing to emphasise here: the crease it is about is not
  // in this channel, because the paper does not have it yet.
  it('is not how a plan step picks its crease out', () => {
    const at = planVisibility(
      [variant([step(1, [10]), step(2, [11])])],
      [fold(0), fold(1)],
      1,
      { sheetLineIds: SHEET, borderLineIds: BORDER, activeLineIds: new Set() }
    );
    expect(at.emphasis).toBeUndefined();
    expect(at.visible?.has(11)).toBe(false);
  });

  it('widens the picked crease when one reference is being read', () => {
    const at = targetVisibility({
      sheetLineIds: SHEET,
      borderLineIds: BORDER,
      activeLineIds: new Set([11]),
    });
    expect([...(at.emphasis ?? [])]).toEqual([11]);
    // Width, not hue: the crease's colour is already saying which way it folds.
    expect(at.emphasisWidth).toBe(REFERENCES_EMPHASIS_WIDTH);
    expect(at.visible?.has(11)).toBe(true);
  });
});

describe('a card that is not a fold', () => {
  const variants = [variant([step(1, [10]), step(2, [11]), step(3, [12])])];
  const input = { sheetLineIds: SHEET, borderLineIds: BORDER, activeLineIds: new Set<number>() };

  // Dimming is what makes one crease stand out. A turn-over and the finished
  // pattern have no crease of their own, so a dimmed build-up would just be a
  // faded picture with nothing picked out of it.
  it('shows its build-up at full strength', () => {
    const views: ReferencesViewStep[] = [
      fold(0),
      fold(1),
      { kind: 'turn-over', side: 'front', component: 0, after: 1 },
      fold(2),
      { kind: 'done', side: 'front', component: 0 },
    ];
    const turn = planVisibility(variants, views, 2, input);
    expect(turn.dimAlpha).toBe(1);
    expect(turn.dimmed).toBeNull();
    // …and still holds back the crease that is not made yet. The fold it comes
    // after *is* made, unlike on a fold card, which stops short of its own.
    expect([...(turn.visible ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11]);

    const done = planVisibility(variants, views, 4, input);
    expect(done.dimAlpha).toBe(1);
    expect([...(done.visible ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11, 12]);
  });

  it('still dims behind a fold', () => {
    const views: ReferencesViewStep[] = [fold(0), fold(1)];
    const at = planVisibility(variants, views, 1, input);
    expect(at.dimAlpha).toBe(REFERENCES_DIM_ALPHA);
    expect([...(at.dimmed ?? [])]).toEqual([10]);
    expect(at.visible?.has(11)).toBe(false);
  });
});

describe('the direction a crease keeps', () => {
  const withDirection = (id: number, ids: number[], direction: 'mountain' | 'valley') => ({
    ...step(id, ids),
    direction,
  });
  const input = { sheetLineIds: SHEET, borderLineIds: BORDER, activeLineIds: new Set<number>() };

  // A step folds one line one way (plan D20). Left to the pattern's own
  // assignment, a line whose creases disagree goes back to reading red here and
  // blue there the moment its step stops being active.
  it('is the one its step folded, for every step so far and not just the active one', () => {
    const variants = [
      variant([
        withDirection(1, [10], 'mountain'),
        withDirection(2, [11], 'valley'),
        withDirection(3, [12], 'mountain'),
      ]),
    ];
    const views: ReferencesViewStep[] = [fold(0), fold(1), fold(2)];
    const at = planVisibility(variants, views, 2, input);
    expect([...(at.directions ?? [])]).toEqual([
      [10, 'mountain'],
      [11, 'valley'],
    ]);
    // Step 3's line is the one being folded, so the pattern is not drawing it
    // at all — its own diagram is, in the direction the step names.
    expect(at.directions?.has(12)).toBe(false);
  });

  it('says nothing about an auxiliary line, which the pattern does not assign', () => {
    const variants = [variant([{ ...step(1, [10]), direction: 'unassigned' as const }])];
    const at = planVisibility(variants, [fold(0)], 0, input);
    expect(at.directions?.size).toBe(0);
  });

  // A grid step's own direction is unassigned — a pleat alternates — and the
  // family's lines each carry theirs. The canvas must read those, or a line
  // the pattern wants the other way keeps the pattern's colour here while the
  // card and the sentence say the pleat's.
  it('is the pleat direction of each grid line, not the step-level unassigned', () => {
    const sequence = plannerSequenceWithGridFixture();
    const variants = [variant(sequence.steps)];
    const views: ReferencesViewStep[] = [fold(0), fold(1), fold(2)];
    const at = planVisibility(variants, views, 2, {
      ...input,
      sheetLineIds: new Set([1, 2, 3, 4, 5]),
      borderLineIds: new Set<number>(),
    });
    expect([...at.visible ?? []].sort()).toEqual([1, 2, 3, 4]);
    expect([...(at.directions ?? [])]).toEqual([
      [1, 'mountain'],
      [2, 'valley'],
      [3, 'valley'],
      // Pleated valley though the pattern says mountain: it stays as made.
      [4, 'valley'],
    ]);
    const back = planVisibility(variants, views, 2, {
      ...input,
      mirrored: true,
      sheetLineIds: new Set([1, 2, 3, 4, 5]),
      borderLineIds: new Set<number>(),
    });
    expect(back.directions?.get(1)).toBe('valley');
    expect(back.directions?.get(4)).toBe('mountain');
  });

  // The point layer needs to tell the outline from the folds: a dot at every
  // place a crease will one day meet the border is a giveaway and a crowd.
  it('names the border so the point layer can leave its bare vertices alone', () => {
    const variants = [variant([step(1, [10])])];
    expect(planVisibility(variants, [fold(0)], 0, input).borderLineIds).toBe(BORDER);
    const views: ReferencesViewStep[] = [fold(0), { kind: 'done', side: 'front', component: 0 }];
    expect(planVisibility(variants, views, 1, input).borderLineIds).toBe(BORDER);
  });
});
