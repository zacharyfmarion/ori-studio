import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { ReferencesFlatStep } from './referencesBreakdown';
import { mountainLineIds, sequenceDirections, stepDirection } from './referencesFoldDirection';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';
import type { ReferencesPlanVariant } from './referencesResults';
import { referencesViewSteps, sideAt } from './referencesSequenceView';

/** Border, mountain, valley, mountain, aux — Oriedita's codes, stride 5. */
const GEOMETRY = {
  segEndpoints: Float64Array.from([
    0, 0, 1, 0, 0, 1, 1, 1, 0, 2, 1, 2, 0, 3, 1, 3, 0, 4, 1, 4,
  ]),
  segAttr: Int32Array.from([
    0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 3, 0, 0, 0, 0,
  ]),
} as unknown as CpGeometryTransport;

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

function variantOf(steps: PrecreaseStep[]): ReferencesPlanVariant {
  return {
    sequence: { steps, sheet: { width: 1, height: 1 } } as unknown as PrecreaseSequence,
    model: { steps: [], points: [], edges: {}, findings: [] } as unknown as
      ReferencesPlanVariant['model'],
  };
}

const flat = (steps: PrecreaseStep[]): ReferencesFlatStep[] =>
  steps.map((_, index) => ({ component: 0, step: index }));

describe('stepDirection', () => {
  it('reads mountain, valley and neither from the pattern', () => {
    expect(stepDirection(GEOMETRY, step(1, [2]))).toBe('mountain');
    expect(stepDirection(GEOMETRY, step(1, [3]))).toBe('valley');
    expect(stepDirection(GEOMETRY, step(1, [1]))).toBe('none');
    expect(stepDirection(GEOMETRY, step(1, [5]))).toBe('none');
    expect(stepDirection(GEOMETRY, step(1, []))).toBe('none');
  });

  // The case the whole design turns on: one chord, both directions along it.
  // Measured at 57 of iguana-c0's 91 steps.
  it('calls a chord that is both mixed', () => {
    expect(stepDirection(GEOMETRY, step(1, [2, 3]))).toBe('mixed');
  });

  it('reads a whole sequence in order', () => {
    const steps = [step(1, [2]), step(2, [3]), step(3, [])];
    expect(sequenceDirections(GEOMETRY, { steps } as unknown as PrecreaseSequence)).toEqual([
      'mountain',
      'valley',
      'none',
    ]);
  });
});

describe('mountainLineIds', () => {
  it('lists the creases to reverse, once each, in step order', () => {
    const steps = [step(1, [2, 3]), step(2, [4]), step(3, [2])];
    expect(mountainLineIds(GEOMETRY, { steps } as unknown as PrecreaseSequence)).toEqual([2, 4]);
  });

  it('is empty for a pattern with no mountains', () => {
    const steps = [step(1, [3]), step(2, [1])];
    expect(mountainLineIds(GEOMETRY, { steps } as unknown as PrecreaseSequence)).toEqual([]);
  });
});

describe('referencesViewSteps', () => {
  it('adds turn over, reverse and the finished pattern when there are mountains', () => {
    const steps = [step(1, [3]), step(2, [2])];
    const view = referencesViewSteps(GEOMETRY, [variantOf(steps)], flat(steps));
    expect(view.map((s) => s.kind)).toEqual(['fold', 'fold', 'turn-over', 'reverse', 'done']);
  });

  it('reads the reverse step from the back and ends on the front', () => {
    const steps = [step(1, [2])];
    const view = referencesViewSteps(GEOMETRY, [variantOf(steps)], flat(steps));
    expect(view.map((s) => s.side)).toEqual(['front', 'front', 'back', 'front']);
    expect(sideAt(view, 2)).toBe('back');
    expect(view[view.length - 1].side).toBe('front');
  });

  it('names the creases the reverse step turns over', () => {
    const steps = [step(1, [2, 3])];
    const view = referencesViewSteps(GEOMETRY, [variantOf(steps)], flat(steps));
    const reverse = view.find((s) => s.kind === 'reverse');
    expect(reverse?.kind === 'reverse' && reverse.lineIds).toEqual([2]);
  });

  // A pattern of valleys is already finished when the last fold is made.
  it('adds nothing when the pattern has no mountains', () => {
    const steps = [step(1, [3])];
    const view = referencesViewSteps(GEOMETRY, [variantOf(steps)], flat(steps));
    expect(view.map((s) => s.kind)).toEqual(['fold']);
  });

  it('adds nothing without geometry to read the directions from', () => {
    const steps = [step(1, [2])];
    expect(referencesViewSteps(null, [variantOf(steps)], flat(steps)).map((s) => s.kind)).toEqual([
      'fold',
    ]);
  });

  it('is empty for a plan with no steps', () => {
    expect(referencesViewSteps(GEOMETRY, [], [])).toEqual([]);
  });
});
