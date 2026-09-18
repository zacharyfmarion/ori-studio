import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { PrecreasePlanStopReason } from './precreasePlan';
import type { PrecreaseSequence } from './precreaseSequence';
import { planEndingCard } from './referencesFilmstrip';

const t = i18n.t.bind(i18n);

/** Only the two counts the card reads; the rest is a totals-shaped stub. */
function totals(made: number, total: number): PrecreaseSequence['totals'] {
  return { cp_lines: made, lower_bound: total } as PrecreaseSequence['totals'];
}

describe('planEndingCard', () => {
  it('says every crease is made only for a complete plan', () => {
    const card = planEndingCard(t, 'complete', totals(332, 332));
    expect(card.badge).toBe('Finished');
    expect(card.sentence).toContain('Every crease is made');
  });

  it('tells the reader they stopped it, and how far it got', () => {
    const card = planEndingCard(t, 'aborted', totals(9, 332));
    expect(card.badge).toBe('Stopped');
    expect(card.sentence).toContain('at your request');
    expect(card.sentence).toContain('9 of 332');
  });

  it('calls a plan that ran out of ideas incomplete and points at the notes', () => {
    const card = planEndingCard(t, 'unsolved', totals(300, 332));
    expect(card.badge).toBe('Incomplete');
    expect(card.sentence).toContain('300 of 332');
    expect(card.sentence).toContain('listed under the cards');
  });

  it('names the cap or the clock when one ended the run', () => {
    expect(planEndingCard(t, 'point_cap', totals(40, 332)).sentence).toContain('point cap');
    expect(planEndingCard(t, 'budget', totals(9, 332)).sentence).toContain('ran out of time');
    for (const reason of ['point_cap', 'budget', 'refused_sheet'] as PrecreasePlanStopReason[]) {
      expect(planEndingCard(t, reason, totals(0, 332)).badge).toBe('Stopped');
    }
  });

  it('never claims completion for a stop that is not one', () => {
    const reasons: PrecreasePlanStopReason[] = ['aborted', 'unsolved', 'point_cap', 'budget', 'refused_sheet'];
    for (const reason of reasons) {
      expect(planEndingCard(t, reason, totals(1, 2)).sentence).not.toContain('Every crease is made');
    }
  });
});
