import { describe, expect, it } from 'vitest';
import type { ReferencesSettings, ReferencesView } from '../../store/workspaceStore/types';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import type { PrecreasePlanResult } from './precreasePlan';
import type { PrecreaseSequence } from './precreaseSequence';
import type { ReferencesPlanModel } from './referencesPlanGeometry';
import {
  cardLocatorAt,
  locateCard,
  locateSheet,
  planStrip,
  referencesReaderStateFor,
  revisionIsOfLoad,
  type ReferencesReaderStateSource,
} from './referencesReaderState';
import type { ReferencesPlanRecord } from './referencesResults';
import type { PrecreaseComponent, SheetAnalysis } from './sheetFrames';

const SETTINGS: ReferencesSettings = {
  candidateCount: 5,
  includeApproximate: false,
  precreaseGrid: true,
  gridWhereNeeded: true,
  allowDanglingFolds: true,
  mergeSymmetricSteps: true,
};

const VIEW: ReferencesView = {
  mode: 'find',
  activeStep: 0,
  activeCandidate: 0,
  landmarksFirst: false,
  activeFinding: null,
  planWays: {},
};

function record(sequence: PrecreaseSequence, revision = '4:abc', component = 2): ReferencesPlanRecord {
  const variant = { sequence, model: {} as ReferencesPlanModel };
  return {
    revision,
    components: [
      {
        component,
        result: { sequence } as PrecreasePlanResult,
        frame: { origin: [0, 0], x_axis: [1, 0], y_axis: [0, 1], width: 1, height: 1 },
        plain: variant,
        hoisted: variant,
        cacheKey: null,
      },
    ],
    refused: [],
    durationMs: 0,
    precreaseGrid: true,
    gridWhereNeeded: true,
    allowDanglingFolds: true,
    mergeSymmetricSteps: true,
  };
}

function component(id: number, outline: [number, number][]): PrecreaseComponent {
  return { id, outline } as PrecreaseComponent;
}

const FRAMES: SheetAnalysis = {
  components: [
    component(0, [
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
    ]),
    component(2, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]),
  ],
} as SheetAnalysis;

describe('the card locator', () => {
  const strip = planStrip(record(plannerSequenceFixture()), VIEW);

  it('finds every card of the same plan where it was', () => {
    strip.viewSteps.forEach((_, index) => {
      const locator = cardLocatorAt(strip.variants, strip.viewSteps, index);
      expect(locator).not.toBeNull();
      expect(locateCard(strip.variants, strip.viewSteps, locator!)).toBe(index);
    });
  });

  it('names a fold by its line, and a card with none by its place alone', () => {
    const fold = strip.viewSteps.findIndex((view) => view.kind === 'fold');
    const done = strip.viewSteps.length - 1;
    expect(cardLocatorAt(strip.variants, strip.viewSteps, fold)?.line).toEqual(
      plannerSequenceFixture().steps[0].line
    );
    expect(cardLocatorAt(strip.variants, strip.viewSteps, done)).toEqual({ index: done, line: null });
  });

  // A replan may put the same fold elsewhere: the line finds it.
  it('follows the fold to wherever a different plan put it', () => {
    const sequence = plannerSequenceFixture();
    const last = sequence.steps.length - 1;
    const locator = cardLocatorAt(strip.variants, strip.viewSteps, last);
    const reordered = { ...sequence, steps: [sequence.steps[last], ...sequence.steps.slice(0, last)] };
    const other = planStrip(record(reordered), VIEW);
    const found = locateCard(other.variants, other.viewSteps, locator!);
    const view = other.viewSteps[found];
    expect(view.kind === 'fold' && other.variants[0].sequence.steps[view.step].line).toEqual(
      sequence.steps[last].line
    );
  });

  it('takes the card nearest the hint when two fold the same line', () => {
    const sequence = plannerSequenceFixture();
    const line = sequence.steps[0].line;
    const twice = {
      ...sequence,
      steps: sequence.steps.map((step, index) => (index === 3 ? { ...step, line } : step)),
    };
    const other = planStrip(record(twice), VIEW);
    const at = other.viewSteps.findIndex(
      (view) => view.kind === 'fold' && view.step === 3
    );
    expect(locateCard(other.variants, other.viewSteps, { index: at, line })).toBe(at);
    expect(locateCard(other.variants, other.viewSteps, { index: 0, line })).not.toBe(at);
  });

  // The planner states a line as `n · p = d`; `-n · p = -d` is the same line,
  // and a replan may state it either way.
  it('finds a fold whose line is stated the other way round', () => {
    const fold = strip.viewSteps.findIndex((view) => view.kind === 'fold');
    const locator = cardLocatorAt(strip.variants, strip.viewSteps, fold)!;
    const flipped = {
      index: locator.index,
      line: { n: [-locator.line!.n[0], -locator.line!.n[1]] as [number, number], d: -locator.line!.d },
    };
    expect(locateCard(strip.variants, strip.viewSteps, flipped)).toBe(fold);
  });

  it('falls back to the first card when the fold is not in the plan', () => {
    expect(
      locateCard(strip.variants, strip.viewSteps, { index: 3, line: { n: [0.6, 0.8], d: 0.123 } })
    ).toBe(0);
    // A lineless card whose place now holds a fold is not found either.
    const fold = strip.viewSteps.findIndex((view) => view.kind === 'fold');
    expect(locateCard(strip.variants, strip.viewSteps, { index: fold, line: null })).toBe(0);
  });
});

describe('locateSheet', () => {
  it('finds the sheet by its bounds, whatever its id now', () => {
    expect(locateSheet(FRAMES, { bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } })).toBe(2);
    expect(locateSheet(FRAMES, { bounds: { minX: 0, minY: 0, maxX: 11, maxY: 10 } })).toBeNull();
  });

  // Read back by a build whose analysis finds the corners a hair differently.
  it('finds it when its corners moved by less than the planner’s snap radius', () => {
    expect(locateSheet(FRAMES, { bounds: { minX: 0.01, minY: 0, maxX: 10, maxY: 10.005 } })).toBe(2);
  });

  // A square and the diamond on its edge midpoints share a box.
  it('tells apart two sheets with one box by the frame it was saved with', () => {
    const square = { origin: [0, 10] as [number, number], x_axis: [1, 0] as [number, number], y_axis: [0, -1] as [number, number], width: 10, height: 10 };
    const diamond = { origin: [5, 10] as [number, number], x_axis: [0.6, -0.8] as [number, number], y_axis: [-0.8, -0.6] as [number, number], width: 7, height: 7 };
    const outline: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const both = {
      components: [
        { ...component(1, outline), frame: square },
        { ...component(5, outline), frame: diamond },
      ],
    } as SheetAnalysis;
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(locateSheet(both, { bounds, frame: diamond })).toBe(5);
    expect(locateSheet(both, { bounds, frame: square })).toBe(1);
    expect(locateSheet(both, { bounds })).toBe(1);
  });
});

function source(overrides: Partial<ReferencesReaderStateSource> = {}): ReferencesReaderStateSource {
  return {
    settings: SETTINGS,
    defaults: SETTINGS,
    view: VIEW,
    selectedSheet: null,
    target: null,
    restore: null,
    loadSerial: 4,
    frames: null,
    plan: null,
    ...overrides,
  };
}

describe('referencesReaderStateFor', () => {
  it('says nothing for a workspace as any document opens it', () => {
    expect(referencesReaderStateFor(source())).toBeNull();
    expect(
      referencesReaderStateFor(source({ settings: { ...SETTINGS, precreaseGrid: false } }))?.settings
    ).toEqual({ ...SETTINGS, precreaseGrid: false });
  });

  it('describes the sheet by its bounds and the open card by its fold', () => {
    const plan = record(plannerSequenceFixture());
    const state = referencesReaderStateFor(
      source({
        view: { ...VIEW, mode: 'sequence', activeStep: 2, landmarksFirst: true },
        selectedSheet: 2,
        frames: { revision: '4:abc', analysis: FRAMES },
        plan,
      })
    );
    const strip = planStrip(plan, { landmarksFirst: true, planWays: {} });
    expect(state).toEqual({
      v: 1,
      settings: SETTINGS,
      mode: 'sequence',
      sheet: { bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
      landmarksFirst: true,
      activeCard: cardLocatorAt(strip.variants, strip.viewSteps, 2),
    });
  });

  it('describes the workspace from an earlier revision of the same document, never another’s', () => {
    const plan = record(plannerSequenceFixture(), '4:old');
    const edited = referencesReaderStateFor(
      source({ selectedSheet: 2, frames: { revision: '4:old', analysis: FRAMES }, plan })
    );
    expect(edited?.sheet).not.toBeNull();
    expect(edited?.activeCard).not.toBeNull();
    const other = referencesReaderStateFor(
      source({
        view: { ...VIEW, mode: 'sequence' },
        selectedSheet: 2,
        frames: { revision: '3:abc', analysis: FRAMES },
        plan: record(plannerSequenceFixture(), '3:abc'),
      })
    );
    expect(other?.sheet).toBeNull();
    expect(other?.activeCard).toBeNull();
  });

  // Saving a project must never fail over where the reader was in References.
  it('forgets the card, rather than failing the save, for a plan it cannot read', () => {
    const broken = plannerSequenceFixture();
    (broken as unknown as Record<string, unknown>).steps = null;
    const state = referencesReaderStateFor(
      source({
        view: { ...VIEW, mode: 'sequence', activeStep: 1 },
        plan: record(broken),
      })
    );
    expect(state?.mode).toBe('sequence');
    expect(state?.activeCard).toBeNull();
  });

  it('keeps no card while a vertex or crease is picked: the strip is the pick’s', () => {
    const state = referencesReaderStateFor(
      source({
        view: { ...VIEW, activeStep: 1 },
        target: { kind: 'crease', component: 2, lineId: 3 },
        plan: record(plannerSequenceFixture()),
      })
    );
    expect(state).toBeNull();
  });

  // Reopened and saved again without a visit to References: what was read
  // and never placed is written back as it was.
  it('writes back what an open restored and nothing has placed yet', () => {
    const restore = {
      loadSerial: 4,
      sheet: { bounds: { minX: 20, minY: 0, maxX: 30, maxY: 10 } },
      card: { index: 7, line: { n: [1, 0] as [number, number], d: 0.25 } },
    };
    const state = referencesReaderStateFor(source({ view: { ...VIEW, mode: 'sequence' }, restore }));
    expect(state?.sheet).toEqual(restore.sheet);
    expect(state?.activeCard).toEqual(restore.card);
    // Another document's restore says nothing about this one.
    expect(referencesReaderStateFor(source({ restore: { ...restore, loadSerial: 3 } }))).toBeNull();
  });
});

describe('revisionIsOfLoad', () => {
  it('reads the load serial off a revision key', () => {
    expect(revisionIsOfLoad('12:345:6', 12)).toBe(true);
    expect(revisionIsOfLoad('12:345:6', 1)).toBe(false);
    expect(revisionIsOfLoad('none', 1)).toBe(false);
  });
});
