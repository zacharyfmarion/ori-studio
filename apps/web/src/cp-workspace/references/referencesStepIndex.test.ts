import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';
import type { ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import { creasesAtVertices, stepIndexOfLine, stepIndexOfVertex } from './referencesStepIndex';

function step(id: number, cpLineIds: number[], grid?: PrecreaseStep['grid']): PrecreaseStep {
  return {
    id,
    kind: grid ? 'grid' : 'cp',
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
    impractical: false,
    hoisted: false,
    card: id,
    ...(grid ? { grid } : {}),
  } as PrecreaseStep;
}

function variant(steps: PrecreaseStep[]): ReferencesPlanVariant {
  return {
    sequence: { steps } as unknown as PrecreaseSequence,
    model: { steps: [], points: [], edges: {}, findings: [] } as unknown as
      ReferencesPlanVariant['model'],
  };
}

const fold = (at: number, twin?: number): ReferencesViewStep => ({
  kind: 'fold',
  side: 'front',
  component: 0,
  step: at,
  ...(twin === undefined ? {} : { twin }),
});

describe('stepIndexOfLine', () => {
  // Steps 0 and 1 are twins on one card; step 2 is a grid pleat of two lines;
  // a turn-over sits between, so view indices and planner indices differ.
  const variants = [
    variant([
      step(1, [10]),
      step(2, [11]),
      step(3, [], { family: 0, lines: [{ cp_line_ids: [12, 13] }] } as never),
      step(4, [14]),
    ]),
  ];
  const views: ReferencesViewStep[] = [
    fold(0, 1),
    { kind: 'turn-over', side: 'front', component: 0, after: 1 },
    fold(2),
    fold(3),
    { kind: 'done', side: 'front', component: 0 },
  ];

  it('finds the card that makes a crease, twins and pleats included', () => {
    expect(stepIndexOfLine(variants, views, 10)).toBe(0);
    expect(stepIndexOfLine(variants, views, 11)).toBe(0);
    expect(stepIndexOfLine(variants, views, 13)).toBe(2);
    expect(stepIndexOfLine(variants, views, 14)).toBe(3);
  });

  it('answers null for a crease no step makes', () => {
    expect(stepIndexOfLine(variants, views, 99)).toBeNull();
  });

  it('completes a vertex at the last of the creases meeting there', () => {
    // Crease 10 runs (0,0)-(1,0); crease 14 runs (1,0)-(1,1): they meet at (1,0).
    const geometry = {
      segEndpoints: Float64Array.from([0, 0, 1, 0, 1, 0, 1, 1]),
    } as unknown as CpGeometryTransport;
    // Segment ids follow the transport's order: 1 is crease 10's, 2 is 14's.
    const plan = [variant([step(1, [1]), step(2, [2])])];
    const strip: ReferencesViewStep[] = [fold(0), fold(1)];
    const at = creasesAtVertices(geometry);
    expect(stepIndexOfVertex(plan, strip, at, { x: 1, y: 0 })).toBe(1);
    expect(stepIndexOfVertex(plan, strip, at, { x: 0, y: 0 })).toBe(0);
    expect(stepIndexOfVertex(plan, strip, at, { x: 5, y: 5 })).toBeNull();
  });
});
