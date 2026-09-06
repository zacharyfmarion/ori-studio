import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  planVariant,
  type ReferencesPlanComponent,
  type ReferencesPlanRecord,
} from './referencesResults';
import {
  breakdownSections,
  breakdownTotals,
  directionOfGroup,
  firstStepOf,
  flatIndexOf,
  flatPlanSteps,
  isPinched,
  planIsForSheet,
  rowForStep,
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

describe('breakdownSections', () => {
  const sequence = plannerSequenceFixture();

  it('splits the crate’s groups into rounds, in order', () => {
    const sections = breakdownSections(sequence);
    expect(sections.map((section) => section.round)).toEqual([1, 2, 3]);
    expect(sections.map((section) => section.kind)).toEqual(['round', 'round', 'round']);
  });

  it('keeps the crate’s grouping instead of re-deriving it', () => {
    const sections = breakdownSections(sequence);
    const parallel = sections[1].rows[0];
    expect(parallel.count).toBe(3);
    expect(parallel.stepIds).toEqual([2, 3, 4]);
    expect(parallel.axiom).toBe(2);
  });

  it('resolves the facts a group does not carry: pinched, visible, unlocks', () => {
    const [first] = breakdownSections(sequence);
    const landmark = first.rows[0];
    expect(landmark.kind).toBe('aux');
    expect(landmark.pinched).toBe(true);
    expect(landmark.visible).toBe(false);
    expect(landmark.unlocks).toEqual([2, 3, 4]);
  });

  it('counts CP and auxiliary steps per section', () => {
    const sections = breakdownSections(sequence);
    expect(sections[0]).toMatchObject({ stepCount: 1, cpCount: 0, auxCount: 1 });
    expect(sections[1]).toMatchObject({ stepCount: 3, cpCount: 3, auxCount: 0 });
  });

  it('calls round 0 the landmarks phase', () => {
    const hoisted = plannerSequenceFixture();
    hoisted.groups[0].round = 0;
    const sections = breakdownSections(hoisted);
    expect(sections[0]).toMatchObject({ round: 0, kind: 'landmarks', id: 'landmarks' });
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
    expect(flatIndexOf(flat, 1, 2)).toBe(one.steps.length + 2);
    expect(flatIndexOf(flat, 5, 0)).toBe(-1);
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

  it('finds a step by id and the row it belongs to', () => {
    expect(stepsById(sequence).get(3)?.line.d).toBe(0.5);
    const sections = breakdownSections(sequence);
    expect(rowForStep(sections, 3)?.count).toBe(3);
    expect(rowForStep(sections, 99)).toBeNull();
    expect(firstStepOf(sections[1].rows[0])).toBe(2);
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
      plannerToken: null,
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
