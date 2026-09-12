import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  planVariant,
  type ReferencesPlanComponent,
  type ReferencesPlanRecord,
} from './referencesResults';
import {
  breakdownTotals,
  directionOfGroup,
  flatPlanSteps,
  isPinched,
  planIsForSheet,
  stepsById,
} from './referencesBreakdown';

describe('directionOfGroup', () => {
  it('names a line by its own direction, not its normal', () => {
    // A normal along +x is a *vertical* line; getting this backwards would
    // label every crease the wrong way round in the sidebar.
    expect(directionOfGroup(0)).toEqual({ kind: 'vertical' });
    expect(directionOfGroup(Math.PI / 2)).toEqual({ kind: 'horizontal' });
    expect(directionOfGroup(Math.PI / 4)).toEqual({ kind: 'diagonal-down' });
    expect(directionOfGroup((3 * Math.PI) / 4)).toEqual({ kind: 'diagonal-up' });
  });

  it('reports an unnamed direction in degrees rather than rounding it onto an axis', () => {
    expect(directionOfGroup(Math.PI / 8)).toEqual({ kind: 'angle', degrees: 113 });
  });

  it('wraps a normal outside [0, π)', () => {
    expect(directionOfGroup(Math.PI)).toEqual({ kind: 'vertical' });
    expect(directionOfGroup(-Math.PI / 2)).toEqual({ kind: 'horizontal' });
  });
});

describe('flat step addressing', () => {
  it('walks every sheet’s steps in turn', () => {
    const one = plannerSequenceFixture();
    const two = plannerSequenceFixture();
    const flat = flatPlanSteps([one, two]);
    expect(flat).toHaveLength(one.steps.length + two.steps.length);
    expect(flat[0]).toEqual({ component: 0, step: 0 });
    expect(flat[one.steps.length]).toEqual({ component: 1, step: 0 });
    expect(flat[flat.length - 1]).toEqual({ component: 1, step: two.steps.length - 1 });
  });
});

describe('totals and lookups', () => {
  const sequence = plannerSequenceFixture();

  it('reports the lower bound beside the fold count, never as a minimum', () => {
    const totals = breakdownTotals(sequence.totals);
    expect(totals).toMatchObject({ folds: 5, cpLines: 4, aux: 1, lowerBound: 4 });
    expect(totals.atLowerBound).toBe(false);
  });

  it('says so when no auxiliary fold was needed', () => {
    expect(breakdownTotals({ ...sequence.totals, folds: 4, aux: 0 }).atLowerBound).toBe(true);
  });

  it('carries the grid’s line count, which the fold count includes and the crease count does not', () => {
    // A 16-grid pleated in both directions: 30 lines, 20 of them the
    // pattern's, which count as creases realised. The other 10 are folds but
    // not creases — the technique, not auxiliary folds — so with no auxiliary
    // fold at all the plan still sits at its lower bound.
    const totals = breakdownTotals({
      ...sequence.totals,
      folds: 24 + 10,
      cp_lines: 24,
      aux: 0,
      lower_bound: 24,
      grid_lines: 30,
      grid_cp_lines: 20,
    });
    expect(totals.gridLines).toBe(30);
    expect(totals.atLowerBound).toBe(true);
    expect(
      breakdownTotals({ ...sequence.totals, folds: 35, cp_lines: 24, aux: 1, lower_bound: 24, grid_lines: 30, grid_cp_lines: 20 }).atLowerBound
    ).toBe(false);
    expect(breakdownTotals(sequence.totals).gridLines).toBe(0);
  });

  it('finds a step by its presentation id', () => {
    expect(stepsById(sequence).get(3)?.line.d).toBe(0.5);
    expect(stepsById(sequence).get(99)).toBeUndefined();
  });

  it('knows a pinched step from a full crease', () => {
    expect(isPinched(sequence.steps[0])).toBe(true);
    expect(isPinched(sequence.steps[1])).toBe(false);
  });
});

describe('planVariant', () => {
  it('picks the order the toggle asked for', () => {
    // Both orders are computed when the plan lands, so the toggle is a
    // selection rather than a recompute — that is the whole reason the record
    // holds two.
    const plain = { sequence: plannerSequenceFixture(), model: {} as never };
    const hoisted = { sequence: plannerSequenceFixture(), model: {} as never };
    const component = {
      component: 0,
      result: {} as never,
      frame: {} as never,
      plain,
      hoisted,
    } as unknown as ReferencesPlanComponent;
    expect(planVariant(component, false)).toBe(plain);
    expect(planVariant(component, true)).toBe(hoisted);
  });
});

describe('planIsForSheet', () => {
  const plan = (components: number[], refused: number[] = []) =>
    ({
      revision: 'r1',
      components: components.map((component) => ({ component })),
      refused: refused.map((component) => ({ component, kind: null })),
      durationMs: 1,
    }) as unknown as ReferencesPlanRecord;

  it('accepts the sheet it planned', () => {
    expect(planIsForSheet(plan([2]), 2)).toBe(true);
  });

  // The bug this exists for: switching sheets changes neither the document nor
  // its revision, so a revision-only freshness test kept serving the old
  // sheet's plan against the new sheet's canvas.
  it('rejects a plan for a different sheet', () => {
    expect(planIsForSheet(plan([2]), 5)).toBe(false);
  });

  it('counts a refused sheet as described — the refusal is that sheet’s answer', () => {
    expect(planIsForSheet(plan([], [7]), 7)).toBe(true);
  });

  it('accepts anything when no sheet is resolved', () => {
    expect(planIsForSheet(plan([2]), null)).toBe(true);
  });
});
