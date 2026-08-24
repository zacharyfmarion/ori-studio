import { describe, expect, it } from 'vitest';

import type { OristudioCpCommandPreview } from '../../engine/oristudioCpTypes';
import { isSteppable, outcomeForPreview, stepReview } from './vertexSolveReview';

const LINES = [3, 7, 11];

function preview(overrides: Partial<OristudioCpCommandPreview> = {}): OristudioCpCommandPreview {
  return {
    segments: [],
    circles: [],
    points: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('outcomeForPreview', () => {
  it('applies straight away when there is exactly one isolated answer', () => {
    // Nothing to choose between, so asking for a choice would be asking the user
    // to confirm the only option — every other CP tool commits on its final click.
    expect(outcomeForPreview(LINES, preview({ candidate_count: 1 }))).toEqual({ kind: 'apply' });
  });

  it('reviews when there is more than one answer', () => {
    expect(outcomeForPreview(LINES, preview({ candidate_count: 2 }))).toEqual({
      kind: 'review',
      review: {
        lineIds: LINES,
        index: 0,
        count: 2,
        isFamily: false,
        isCurrent: false,
        contradictsHint: false,
      },
    });
  });

  it('reviews a lone family member rather than applying it', () => {
    // The distinction the counter exists to protect: this is one point on a
    // curve of equally valid answers, not "the" answer, so committing it unasked
    // would present an arbitrary choice as a determination.
    const outcome = outcomeForPreview(
      LINES,
      preview({ candidate_count: 0, candidate_is_family: true })
    );
    expect(outcome).toEqual({
      kind: 'review',
      review: {
        lineIds: LINES,
        index: 0,
        count: 0,
        isFamily: true,
        isCurrent: false,
        contradictsHint: false,
      },
    });
  });

  it('never counts a family member, even when the kernel also reports a count', () => {
    // `candidate_count` counts isolated branches; a preview showing a family
    // member must not borrow that number, or "1 of 2" would describe a set that
    // has no second member to step to.
    const outcome = outcomeForPreview(
      LINES,
      preview({ candidate_count: 2, candidate_is_family: true })
    );
    expect(outcome).toMatchObject({ kind: 'review', review: { count: 0, isFamily: true } });
  });

  it('holds a lone answer for review when it is the state the vertex already has', () => {
    // Applying it would be applying a no-op. Held instead, so the counter and
    // the note can say "this is what you already do" rather than dressing the
    // document's own state up as a change.
    const outcome = outcomeForPreview(
      LINES,
      preview({ candidate_count: 1, candidate_is_current: true })
    );
    expect(outcome).toMatchObject({ kind: 'review', review: { isCurrent: true, count: 1 } });
  });

  it('holds a lone answer for review when it folds a crease against its hint', () => {
    // The one case where a single answer must not commit on the third click.
    // Applying replaces the direction the user marked, and unlike every other
    // note here that loss is invisible afterwards — there is nothing left on the
    // crease to say a mark was ever there.
    const outcome = outcomeForPreview(
      LINES,
      preview({ candidate_count: 1, candidate_contradicts_hint: true })
    );
    expect(outcome).toMatchObject({
      kind: 'review',
      review: { contradictsHint: true, count: 1 },
    });
  });

  it('still applies a lone answer that agrees with the hint', () => {
    // The flag is a warning, not a second gate: an answer consistent with the
    // mark is exactly as committable as one on an unhinted crease.
    expect(
      outcomeForPreview(LINES, preview({ candidate_count: 1, candidate_contradicts_hint: false }))
    ).toEqual({ kind: 'apply' });
  });

  it('reports the kernel reason when there is no answer', () => {
    expect(outcomeForPreview(LINES, preview({ unavailable: 'AnglesUnreachable' }))).toEqual({
      kind: 'none',
      reason: 'AnglesUnreachable',
    });
  });

  it('treats a missing preview as no answer rather than throwing', () => {
    expect(outcomeForPreview(LINES, null)).toEqual({ kind: 'none', reason: null });
    expect(outcomeForPreview(LINES, preview())).toEqual({ kind: 'none', reason: null });
  });
});

describe('stepReview', () => {
  const review = {
    lineIds: LINES,
    index: 0,
    count: 3,
    isFamily: false,
    isCurrent: false,
    contradictsHint: false,
  };

  it('wraps at both ends', () => {
    // The solutions are a ring of alternatives ordered by distance from where
    // the creases already are; that ranks them but makes neither end a wall.
    expect(stepReview(review, 1).index).toBe(1);
    expect(stepReview(review, -1).index).toBe(2);
    expect(stepReview({ ...review, index: 2 }, 1).index).toBe(0);
  });

  it('drops both answer-describing flags on a step, until the new preview says otherwise', () => {
    // They describe the answer being *shown*. Carrying either across a step
    // would label the wrong one for as long as the preview took to land, and
    // the two are refreshed together from the same response.
    const stepped = stepReview({ ...review, isCurrent: true, contradictsHint: true }, 1);
    expect(stepped).toMatchObject({ isCurrent: false, contradictsHint: false });
  });

  it('stands still when there is nothing to step through', () => {
    const lone = { ...review, count: 1 };
    expect(stepReview(lone, 1)).toBe(lone);
    const family = { ...review, count: 0, isFamily: true };
    expect(stepReview(family, -1)).toBe(family);
  });
});

describe('isSteppable', () => {
  it('is false for nothing, for one answer, and for a family', () => {
    expect(isSteppable(null)).toBe(false);
    const review = {
      lineIds: LINES,
      index: 0,
      isFamily: false,
      isCurrent: false,
      contradictsHint: false,
    };
    expect(isSteppable({ ...review, count: 1 })).toBe(false);
    expect(isSteppable({ ...review, count: 0, isFamily: true })).toBe(false);
    expect(isSteppable({ ...review, count: 2 })).toBe(true);
  });
});
