import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import axiom7Fixture from './referenceFinder/__fixtures__/line-axiom7.json';
import { extractSolution, type ExtractedStep } from './referenceFinder/extractor';
import type { ReferenceFinderReplayFixture } from './referenceFinder/replayClient';
import { unitFrame } from './diagram/diagramFrames';
import { plannerStepDiagram } from './diagram/plannerDiagram';
import type {
  PrecreaseGridStep,
  PrecreaseGridStepLine,
  PrecreaseStep,
} from './precreaseSequence';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  describePlannerStep,
  describeStep,
  isLineLabel,
  referenceName,
  splitStepInputs,
} from './referencesStepSentences';

/**
 * Returns the English default with `{{name}}` interpolations applied. A plural
 * call passes its defaults in the options object, one per CLDR category —
 * cardinal (`defaultValue_one` / `_other`) or, with `ordinal: true`, ordinal
 * (`_ordinal_one` / `_two` / `_few` / `_other`) — and gets the form English
 * selects for `count`.
 */
function render(_key: string, second?: unknown, third?: unknown): string {
  const options = (typeof second === 'object' && second !== null ? second : third) as
    | Record<string, unknown>
    | undefined;
  let fallback = typeof second === 'string' ? second : '';
  if (typeof options?.count === 'number') {
    const type = options.ordinal === true ? 'ordinal' : 'cardinal';
    const category = new Intl.PluralRules('en', { type }).select(options.count);
    const suffix = type === 'ordinal' ? `_ordinal_${category}` : `_${category}`;
    fallback = String(options[`defaultValue${suffix}`] ?? options.defaultValue ?? fallback);
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? `{{${name}}}`)
  );
}
const t = render as unknown as TFunction;

function step(overrides: Partial<ExtractedStep>): ExtractedStep {
  return { axiom: 1, inputs: [], label: 'A', pinch: false, diagramIndex: 0, ...overrides };
}

describe('splitStepInputs', () => {
  it('splits points-first inputs by the axiom arity', () => {
    expect(splitStepInputs({ axiom: 5, inputs: ['P', 'se', 'n'] })).toEqual({
      points: ['P', 'se'],
      lines: ['n'],
    });
    expect(splitStepInputs({ axiom: 7, inputs: ['P', 'A', 'B'] })).toEqual({
      points: ['P'],
      lines: ['A', 'B'],
    });
    expect(splitStepInputs({ axiom: 0, inputs: ['w', 'A'] })).toEqual({
      points: [],
      lines: ['w', 'A'],
    });
  });

  it('gives an unknown axiom no slots', () => {
    expect(splitStepInputs({ axiom: 9, inputs: ['P'] })).toEqual({ points: [], lines: [] });
  });
});

describe('isLineLabel', () => {
  it('knows the sheet lines, the corners, and the letter ranges', () => {
    expect(isLineLabel('sw_ne')).toBe(true);
    expect(isLineLabel('e')).toBe(true);
    expect(isLineLabel('ne')).toBe(false);
    expect(isLineLabel('A')).toBe(true);
    expect(isLineLabel('J')).toBe(true);
    expect(isLineLabel('P')).toBe(false);
    expect(isLineLabel('Z')).toBe(false);
  });
});

describe('referenceName', () => {
  it('describes the sheet references and letters the rest', () => {
    expect(referenceName(t, 'nw_se')).toBe('the top-left to bottom-right diagonal');
    expect(referenceName(t, 'sw')).toBe('the bottom-left corner');
    expect(referenceName(t, 'B')).toBe('line B');
    expect(referenceName(t, 'Q')).toBe('point Q');
  });
});

describe('describeStep', () => {
  it('reads a mark as the meeting of its two lines', () => {
    expect(describeStep(t, step({ axiom: 0, inputs: ['w', 'A'], label: 'P' }))).toBe(
      'Mark P where the left edge meets line A.'
    );
  });

  it("follows the core's slot meaning for O5: p0 lands on l0, the crease passes through p1", () => {
    expect(describeStep(t, step({ axiom: 5, inputs: ['P', 'se', 'n'], label: 'B' }))).toBe(
      'Fold B through the bottom-right corner, bringing point P onto the top edge.'
    );
  });

  it("follows the core's slot meaning for O7: l1 onto itself, p0 lands on l0", () => {
    // `RefLine_L2L_P2L_Logic::Serialize` emits `rl2` (the line folded onto
    // itself) as `l1` and `rl1` (the line the mark lands on) as `l0` —
    // the reverse of every other axiom. refLineL2LP2L.cpp:146-148.
    expect(describeStep(t, step({ axiom: 7, inputs: ['P', 'A', 's'], label: 'C' }))).toBe(
      'Fold C, folding the bottom edge onto itself so that point P lands on line A.'
    );
  });

  it('names the O7 sheet edges the way the constructible unit-sheet case folds', () => {
    // {axiom:7, p0:'se', l0:'w', l1:'n'} is a real O7: self-fold the top edge
    // (crease vertical), bringing the bottom-right corner onto the left edge.
    expect(describeStep(t, step({ axiom: 7, inputs: ['se', 'w', 'n'], label: 'A' }))).toBe(
      'Fold A, folding the top edge onto itself so that the bottom-right corner lands on the left edge.'
    );
  });

  it('describes O6 with both point-line pairs in order', () => {
    expect(describeStep(t, step({ axiom: 6, inputs: ['se', 'P', 'n', 's'], label: 'B' }))).toBe(
      'Fold B, bringing the bottom-right corner onto the top edge and point P onto the bottom edge.'
    );
  });

  it('appends the pinch note for a pinched line', () => {
    expect(describeStep(t, step({ axiom: 2, inputs: ['se', 'ne'], label: 'A', pinch: true }))).toBe(
      'Fold A, bringing the bottom-right corner onto the top-right corner. Pinch only — just the mark is needed.'
    );
  });

  it('names the inputs rather than guessing an axiom it does not know', () => {
    expect(describeStep(t, step({ axiom: 8, inputs: ['P', 'A'], label: 'D' }))).toBe(
      'Fold D using point P, line A.'
    );
  });
});

describe("O7's slots, against a captured solution", () => {
  const fixture = axiom7Fixture as unknown as ReferenceFinderReplayFixture;
  const sheet = { width: fixture.database.width, height: fixture.database.height };

  /**
   * The sentence's claim is geometric — "folding X onto itself" means the crease
   * is *perpendicular* to X — so it can be checked against the crease the core
   * actually drew, rather than only against the C++ that names the slots.
   */
  it('names the line the crease is perpendicular to, not the one the mark lands on', () => {
    const index = fixture.solutions.findIndex((raw) =>
      raw.steps.some((step) => step.axiom === 7)
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const solution = extractSolution(fixture.solutions[index], fixture.query, sheet);
    const step = solution.steps.find((s) => s.axiom === 7);
    expect(step?.line).toBeDefined();

    const { lines } = splitStepInputs(step!);
    const direction = (segment: { a: readonly [number, number]; b: readonly [number, number] }) => {
      const dx = segment.b[0] - segment.a[0];
      const dy = segment.b[1] - segment.a[1];
      const length = Math.hypot(dx, dy);
      return [dx / length, dy / length] as const;
    };
    // The sheet's own east edge is one of the two inputs; the other is an
    // earlier step of the same solution.
    const lineOf = (label: string) => {
      if (label === 'e')
        return { a: [sheet.width, 0] as const, b: [sheet.width, sheet.height] as const };
      const earlier = solution.steps.find((s) => s.label === label);
      expect(earlier?.line).toBeDefined();
      return earlier!.line!;
    };
    const crease = direction(step!.line!);
    const dot = (label: string) => {
      const u = direction(lineOf(label));
      return Math.abs(crease[0] * u[0] + crease[1] * u[1]);
    };

    // `l1` (lines[1]) is the self-folded one: perpendicular to the crease.
    expect(dot(lines[1])).toBeCloseTo(0, 6);
    // `l0` (lines[0]) is the landing line, and is nowhere near perpendicular —
    // so the swap is observable, not a distinction without a difference.
    expect(dot(lines[0])).toBeGreaterThan(0.2);

    // And the sentence says so.
    const sentence = describeStep(t, step!);
    expect(sentence).toContain(`${referenceName(t, lines[1])} onto itself`);
    expect(sentence).toContain(`lands on ${referenceName(t, lines[0])}`);
  });
});

// The planner's sentence names every reference by the letter the card gives
// it, from the same function — so what the sentence calls P is the ring
// labelled P, and there is nothing to remember from an earlier step.
describe('a planner step', () => {
  const sequence = plannerSequenceFixture();

  it('names its references by the card’s letters, in the axiom’s input order', () => {
    // Step 2 (index 1) is O2 on the SW corner and a mark: P onto Q.
    expect(describePlannerStep(t, sequence, 1)).toBe('Fold P onto Q.');
    // Step 5 (index 4) is O3 on the bottom edge and the landmark's crease.
    expect(describePlannerStep(t, sequence, 4)).toContain('Fold A onto B.');
  });

  // axolotl (busi12341) step 26: `[P, m1, m2]` with P on the top edge, m1 the
  // horizontal midline and m2 the diagonal. The crease is perpendicular to the
  // diagonal and carries P onto the midline — so it is the diagonal (B) that
  // is folded onto itself and the midline (A) that P lands on. The sentence
  // had the two lines the other way round, and the card's arrow, which is
  // drawn from the geometry, disagreed with its caption.
  it('folds the O7’s perpendicular reference onto itself, and lands P on the other line', () => {
    const o7 = {
      ...sequence.steps[4]!,
      witnesses: [
        {
          ...sequence.steps[4]!.witnesses[0]!,
          axiom: 7,
          inputs: [
            { kind: 'corner' as const, id: 2, corner: 'nw' as const },
            { kind: 'edge' as const, id: 2, side: 'bottom' as const },
            { kind: 'line' as const, id: 4 },
          ],
          who_moves: [0],
        },
      ],
      chosen: 0,
    };
    const seq = { ...sequence, steps: sequence.steps.map((s, i) => (i === 4 ? o7 : s)) };
    expect(describePlannerStep(t, seq, 4)).toContain('Fold B onto itself so that P lands on A.');
  });

  it('uses exactly the letters the card draws', () => {
    for (let i = 0; i < sequence.steps.length; i += 1) {
      const sentence = describePlannerStep(t, sequence, i);
      const card = plannerStepDiagram(sequence, unitFrame(sequence), i);
      const drawn = (card?.primitives ?? [])
        .filter((p) => p.kind === 'label')
        .map((l) => (l.kind === 'label' ? l.text : ''));
      for (const letter of drawn) {
        expect(sentence, `step ${i + 1}: ${sentence}`).toMatch(new RegExp(`\\b${letter}\\b`));
      }
    }
  });

  it('says the same thing on the back as on the front — letters do not mirror', () => {
    const steps = sequence.steps.map((s) => ({ ...s, side: 'back' as const }));
    const flipped = { ...sequence, steps };
    for (let i = 0; i < sequence.steps.length; i += 1) {
      expect(describePlannerStep(t, flipped, i)).toBe(describePlannerStep(t, sequence, i));
    }
  });
});

describe('a press step', () => {
  // A press on the fixture's second step's line (line id 5, made at step 2 by
  // O2 folding P onto Q). It carries that step's witness, so it reads as that
  // fold does — and then says how much of it to press.
  const sequence = plannerSequenceFixture();
  const made = sequence.steps[1]!;
  const press = {
    ...made,
    id: 99,
    kind: 'press' as const,
    cp_line_ids: [],
    cp_spans: [],
    extent: { kind: 'pinches' as const, spans: [[[0.47, 0.5], [0.53, 0.5]] as [[number, number], [number, number]]] },
    press: { at: [0.5, 0.5] as [number, number], point: 4, sighted_from: 6 },
  };
  const withPress = { ...sequence, steps: [...sequence.steps, press] };

  it('reads as the fold that made its line, pinch only', () => {
    const sentence = describePlannerStep(t, withPress, withPress.steps.length - 1);
    expect(sentence).toBe(`${describePlannerStep(t, sequence, 1)} Pinch only — just the mark is needed.`);
    expect(sentence).not.toMatch(/refold/i);
  });

  it('says to crease the part shown when it runs out to an end', () => {
    const out = { ...press, press: { ...press.press, sighted_from: null } };
    const seq = { ...sequence, steps: [...sequence.steps, out] };
    const sentence = describePlannerStep(t, seq, seq.steps.length - 1);
    expect(sentence).toBe(`${describePlannerStep(t, sequence, 1)} Crease only the part shown.`);
  });
});

describe('a step that cannot be sighted', () => {
  const sequence = plannerSequenceFixture();
  const flagged = (missing: [number, number][]) => {
    const step = { ...sequence.steps[4]!, marks_exist: false, missing_marks: missing };
    return { ...sequence, steps: sequence.steps.map((s, i) => (i === 4 ? step : s)) };
  };

  it('asks for the mark first when one is missing', () => {
    expect(describePlannerStep(t, flagged([[0.5, 0.5]]), 4)).toContain('pinch it in first');
  });

  it('says nothing lines up when the marks are there but no crease does', () => {
    const sentence = describePlannerStep(t, flagged([]), 4);
    expect(sentence).toContain('Nothing on the paper lines up with this fold yet');
    expect(sentence).not.toContain('pinch it in first');
  });
});

describe('a step that creases on past the pattern', () => {
  it('says so, and why', () => {
    const sequence = plannerSequenceFixture();
    const on = {
      ...sequence,
      steps: sequence.steps.map((s, i) =>
        i === 1
          ? { ...s, pressed_on: [[[0.5, 0.5], [0.5, 0.2]] as [[number, number], [number, number]]] }
          : s
      ),
    };
    expect(describePlannerStep(t, on, 1)).toBe(
      `${describePlannerStep(t, sequence, 1)} Crease on past the pattern’s line as far as shown — a later step lines up against it there.`
    );
  });
});

describe('a step that is not exact', () => {
  const sequence = plannerSequenceFixture();
  const withStep = (overrides: Partial<PrecreaseStep>) => ({
    ...sequence,
    steps: sequence.steps.map((s, i) => (i === 1 ? { ...s, ...overrides } : s)),
  });

  it('says how far off the closest construction is, in the sheet’s own terms', () => {
    const seq = withStep({ exact: false, approximation: 0.00748 });
    expect(describePlannerStep(t, seq, 1)).toBe(
      `${describePlannerStep(t, sequence, 1)} Approximate — this construction is off by 0.75% of the sheet.`
    );
    const tiny = withStep({ exact: false, approximation: 0.000056 });
    expect(describePlannerStep(t, tiny, 1)).toContain('off by 0.0056% of the sheet');
    const large = withStep({ exact: false, approximation: 0.045 });
    expect(describePlannerStep(t, large, 1)).toContain('off by 4.5% of the sheet');
  });

  it('says a fold sighted from an approximate crease is only as exact as that', () => {
    const seq = withStep({ exact: false });
    expect(describePlannerStep(t, seq, 1)).toBe(
      `${describePlannerStep(t, sequence, 1)} Sighted from an approximate crease, so only as exact as that is.`
    );
  });
});

describe('a step whose creases line up over less than a pinch', () => {
  const sequence = plannerSequenceFixture();

  it('says to align with care', () => {
    const short = { ...sequence.steps[4]!, alignment: 0.04 };
    const seq = { ...sequence, steps: sequence.steps.map((s, i) => (i === 4 ? short : s)) };
    expect(describePlannerStep(t, seq, 4)).toBe(
      `${describePlannerStep(t, sequence, 4)} The creases line up only briefly here — align with care.`
    );
  });

  it('says nothing when they line up a pinch or more, or when nothing lines up', () => {
    const long = { ...sequence.steps[4]!, alignment: 0.06 };
    const seq = { ...sequence, steps: sequence.steps.map((s, i) => (i === 4 ? long : s)) };
    expect(describePlannerStep(t, seq, 4)).toBe(describePlannerStep(t, sequence, 4));
    expect(describePlannerStep(t, sequence, 1)).not.toMatch(/briefly/);
  });
});

// A grid step is one family of the precrease grid, and reads as the pleat a
// folder makes rather than as fifteen sighted folds.
describe('a grid step', () => {
  const sequence = plannerSequenceFixture();

  /** A family of `n − 1` interior lines, alternating from `first` by index. */
  function family(
    overrides: Partial<PrecreaseGridStep> & { first?: 'mountain' | 'valley' } = {}
  ): PrecreaseGridStep {
    const { first = 'mountain', ...rest } = overrides;
    const n = rest.n ?? 16;
    const normal = rest.normal ?? ([1, 0] as [number, number]);
    const lines: PrecreaseGridStepLine[] = [];
    for (let index = 1; index < n; index += 1) {
      const even = (index - 1) % 2 === 0;
      const direction = even === (first === 'mountain') ? 'mountain' : 'valley';
      lines.push({
        line_id: 10 + index,
        line: { n: normal, d: index / n },
        segment: [
          [index / n, 0],
          [index / n, 1],
        ],
        spans: [],
        index,
        direction,
        pattern_direction: 'unassigned',
        pattern_share: 0,
        cp_line_ids: [],
        cp_spans: [],
      });
    }
    // An axis family cuts the sheet into `n` strips; an oblique one into no
    // whole number of anything, as the crate reports it.
    const oblique = normal[0] !== 0 && normal[1] !== 0;
    return {
      kind: 'box',
      family: 0,
      n,
      normal,
      spacing: 1 / n,
      cells: oblique ? null : n,
      level: oblique ? 0 : n,
      pleat: true,
      regions: [],
      lines,
      in_pattern: 0,
      reversed: 0,
      ...rest,
    };
  }

  function withGrid(grid: PrecreaseGridStep, side: 'front' | 'back' = 'front') {
    const first = grid.lines[0]!;
    const step: PrecreaseStep = {
      ...sequence.steps[1]!,
      id: 1,
      kind: 'grid',
      tag: 'grid',
      line: first.line,
      line_id: first.line_id,
      segment: first.segment,
      witnesses: [],
      chosen: null,
      direction: 'unassigned',
      direction_share: 0,
      side,
      cp_line_ids: [],
      cp_spans: [],
      exact: true,
      grid,
    };
    return { ...sequence, steps: [step, ...sequence.steps] };
  }

  it('says which way, into how many, how many lines, and the alternation’s phase', () => {
    expect(describePlannerStep(t, withGrid(family()), 0)).toBe(
      'Pleat the sheet into 16ths vertically: 15 lines, alternating mountain and valley, mountain first.'
    );
    expect(describePlannerStep(t, withGrid(family({ normal: [0, 1], first: 'valley' })), 0)).toBe(
      'Pleat the sheet into 16ths horizontally: 15 lines, alternating valley and mountain, valley first.'
    );
  });

  it('writes the fraction as English does — 32nds, 8ths, 23rds — not 32ths', () => {
    expect(describePlannerStep(t, withGrid(family({ n: 32 })), 0)).toContain('into 32nds');
    expect(describePlannerStep(t, withGrid(family({ n: 8 })), 0)).toContain('into 8ths');
    expect(describePlannerStep(t, withGrid(family({ n: 23 })), 0)).toContain('into 23rds');
    expect(describePlannerStep(t, withGrid(family({ n: 21 })), 0)).toContain('into 21sts');
  });

  it('names an oblique hex family by its angle, from the normal, and by its spacing', () => {
    // A normal at 120° is a line at 30°: the family reads by the line's own
    // direction, as the sidebar's rows do, and never by its normal. It cuts
    // the sheet into no whole number of strips, so it is said by the grid's
    // cell instead of "into 16ths".
    const theta = (2 * Math.PI) / 3;
    const hex = family({ kind: 'hex', normal: [Math.cos(theta), Math.sin(theta)] });
    expect(describePlannerStep(t, withGrid(hex), 0)).toBe(
      'Pleat the sheet at 30°, one 16th of the sheet apart: 15 lines, alternating mountain and valley, mountain first.'
    );
  });

  it('counts the strips of the family itself, not the grid’s, on a rectangle', () => {
    // A 2:1 sheet on 16ths of its width: the horizontal family has 7 lines
    // and cuts the height into 8ths, whatever `n` the grid is named by.
    const horizontal = family({ n: 16, normal: [0, 1], cells: 8 });
    horizontal.lines = horizontal.lines.slice(0, 7);
    expect(describePlannerStep(t, withGrid(horizontal), 0)).toContain(
      'Pleat the sheet into 8ths horizontally: 7 lines'
    );
  });

  it('says how many lines the pattern wants the other way, only when there are any', () => {
    expect(describePlannerStep(t, withGrid(family({ in_pattern: 9 })), 0)).not.toMatch(/other way/);
    expect(describePlannerStep(t, withGrid(family({ in_pattern: 9, reversed: 3 })), 0)).toBe(
      'Pleat the sheet into 16ths vertically: 15 lines, alternating mountain and valley, mountain first. The pattern wants 3 of them the other way; they reverse as the model collapses.'
    );
    expect(describePlannerStep(t, withGrid(family({ in_pattern: 9, reversed: 1 })), 0)).toContain(
      'The pattern wants 1 of them the other way; it reverses as the model collapses.'
    );
  });

  it('is a pleat, not a free line or a sighted fold', () => {
    // No witness — but that is because nothing is sighted, not because the
    // line is already there.
    const sentence = describePlannerStep(t, withGrid(family()), 0);
    expect(sentence).not.toMatch(/already on the sheet/);
    expect(sentence).not.toMatch(/Fold /);
    expect(describePlannerStep(t, withGrid(family(), 'back'), 0)).toBe(sentence);
  });

  // A step that is not a pleat makes one level's lines in the bands the
  // pattern needs them in, each the way the pattern wants it: no alternation
  // to state, and the band named by the lines the folder can see.
  describe('made in bands', () => {
    /** The 32nds of a 32-family between the ¼ and ¾ lines: the odd indices 9–23. */
    function bands(overrides: Partial<PrecreaseGridStep> = {}): PrecreaseGridStep {
      const all = family({ n: 32 });
      const lines = all.lines.filter((line) => line.index % 2 === 1 && line.index >= 9 && line.index <= 23);
      return {
        ...all,
        level: 32,
        pleat: false,
        regions: [
          {
            bounds: [
              { index: 8, fraction: 0.25, edge: null, line_id: 4 },
              { index: 24, fraction: 0.75, edge: null, line_id: 12 },
            ],
            lines: lines.length,
          },
        ],
        lines,
        reversed: 0,
        ...overrides,
      };
    }

    it('names the level, the band by its bounding lines, and the count', () => {
      expect(describePlannerStep(t, withGrid(bands()), 0)).toBe(
        'Add the 32nds vertically between the 1/4 line and the 3/4 line: 8 lines, creased as shown.'
      );
    });

    it('names the sheet’s edge as a bound, by which edge it is', () => {
      const edge = bands({
        regions: [
          {
            bounds: [
              { index: 0, fraction: 0, edge: 'left', line_id: null },
              { index: 8, fraction: 0.25, edge: null, line_id: 4 },
            ],
            lines: 4,
          },
        ],
      });
      expect(describePlannerStep(t, withGrid(edge), 0)).toContain(
        'between the left edge and the 1/4 line'
      );
      const horizontal = bands({
        normal: [0, 1],
        regions: [
          {
            bounds: [
              { index: 24, fraction: 0.75, edge: null, line_id: 12 },
              { index: 32, fraction: 1, edge: 'top', line_id: null },
            ],
            lines: 4,
          },
        ],
      });
      expect(describePlannerStep(t, withGrid(horizontal), 0)).toContain(
        'horizontally between the 3/4 line and the top edge'
      );
    });

    it('lists several bands', () => {
      const two = bands({
        regions: [
          {
            bounds: [
              { index: 0, fraction: 0, edge: 'left', line_id: null },
              { index: 4, fraction: 0.125, edge: null, line_id: 2 },
            ],
            lines: 2,
          },
          {
            bounds: [
              { index: 28, fraction: 0.875, edge: null, line_id: 14 },
              { index: 32, fraction: 1, edge: 'right', line_id: null },
            ],
            lines: 2,
          },
        ],
      });
      expect(describePlannerStep(t, withGrid(two), 0)).toContain(
        'between the left edge and the 1/8 line, and between the 7/8 line and the right edge'
      );
    });

    // A band creased only part way along its lines says how far, by the
    // lines of the other family its extent ends on.
    it('says how far along the lines the band is creased', () => {
      const cut = bands({
        regions: [
          {
            bounds: [
              { index: 8, fraction: 0.25, edge: null, line_id: 4 },
              { index: 24, fraction: 0.75, edge: null, line_id: 12 },
            ],
            lines: 8,
            extent: [0.375, 0.625],
            along: [
              { index: 6, fraction: 0.375, edge: null, line_id: 30 },
              { index: 10, fraction: 0.625, edge: null, line_id: 34 },
            ],
          },
        ],
      });
      expect(describePlannerStep(t, withGrid(cut), 0)).toBe(
        'Add the 32nds vertically between the 1/4 line and the 3/4 line, from the 3/8 line to the 5/8 line: 8 lines, creased as shown.'
      );
      const toEdge = bands({
        regions: [
          {
            bounds: [
              { index: 8, fraction: 0.25, edge: null, line_id: 4 },
              { index: 24, fraction: 0.75, edge: null, line_id: 12 },
            ],
            lines: 8,
            extent: [0, 0.625],
            along: [
              { index: 0, fraction: 0, edge: 'bottom', line_id: null },
              { index: 10, fraction: 0.625, edge: null, line_id: 34 },
            ],
          },
        ],
      });
      expect(describePlannerStep(t, withGrid(toEdge), 0)).toContain(
        'from the bottom edge to the 5/8 line'
      );
    });

    // An odd base's band (13ths, 25ths) is bounded by nothing a halving
    // made, so its bounds are positions across the sheet.
    it('names a bound with no line on it as a position', () => {
      const odd = bands({
        n: 13,
        cells: 13,
        level: 13,
        regions: [
          {
            bounds: [
              { index: 0, fraction: 0, edge: 'left', line_id: null },
              { index: 9, fraction: 9 / 13, edge: null, line_id: null },
            ],
            lines: 8,
          },
        ],
      });
      expect(describePlannerStep(t, withGrid(odd), 0)).toContain(
        'Add the 13ths vertically between the left edge and 9/13 of the way across'
      );
    });
  });
});
