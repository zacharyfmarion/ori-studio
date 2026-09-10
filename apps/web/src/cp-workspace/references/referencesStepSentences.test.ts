import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import axiom7Fixture from './referenceFinder/__fixtures__/line-axiom7.json';
import { extractSolution, type ExtractedStep } from './referenceFinder/extractor';
import type { ReferenceFinderReplayFixture } from './referenceFinder/replayClient';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  describePlannerStep,
  describeStep,
  isLineLabel,
  plannerRefIndex,
  referenceName,
  splitStepInputs,
} from './referencesStepSentences';

/** Returns the English default with `{{name}}` interpolations applied. */
const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(values?.[name] ?? `{{${name}}}`)
  )) as unknown as TFunction;

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

describe('a step made on the back', () => {
  const sequence = plannerSequenceFixture();
  const index = plannerRefIndex(sequence);
  const onSide = (side: 'front' | 'back', stepIndex: number) => {
    const steps = sequence.steps.map((s, i) => (i === stepIndex ? { ...s, side } : s));
    return describePlannerStep(t, { ...sequence, steps }, index, stepIndex);
  };
  // Find a step whose sentence names a side of the sheet at all.
  const at = sequence.steps.findIndex((_, i) => /left|right/i.test(onSide('front', i)));

  it('names the sheet as the reader sees it, not as the pattern states it', () => {
    expect(at, 'the fixture should have a step naming an edge or corner').toBeGreaterThanOrEqual(0);
    const front = onSide('front', at);
    const back = onSide('back', at);
    // The card and the canvas are both mirrored on the back, so every left
    // becomes a right and the sentence has to follow.
    expect(back).not.toBe(front);
    expect(back).toBe(front.replace(/left|right/g, (word) => (word === 'left' ? 'right' : 'left')));
  });

  it('leaves top and bottom alone — only handedness turns over', () => {
    const withTop = sequence.steps.findIndex((_, i) => /top|bottom/i.test(onSide('front', i)));
    if (withTop < 0) return;
    const front = onSide('front', withTop);
    const back = onSide('back', withTop);
    const strip = (s: string) => s.replace(/left|right/g, '·');
    expect(strip(back)).toBe(strip(front));
  });
});

describe('a press step', () => {
  // A press on the fixture's second step's line (line id 5, made at step 2),
  // located by the crease from step 3 (line id 6).
  const sequence = plannerSequenceFixture();
  const made = sequence.steps[1]!;
  const press = {
    ...made,
    id: 99,
    kind: 'press' as const,
    witnesses: [],
    chosen: null,
    cp_line_ids: [],
    cp_spans: [],
    extent: { kind: 'pinches' as const, spans: [[[0.47, 0.5], [0.53, 0.5]] as [[number, number], [number, number]]] },
    press: { at: [0.5, 0.5] as [number, number], point: 4, sighted_from: 6 },
  };
  const withPress = { ...sequence, steps: [...sequence.steps, press] };
  const index = plannerRefIndex(withPress);

  it('says which crease to refold and which crossing to pinch at', () => {
    const sentence = describePlannerStep(t, withPress, index, withPress.steps.length - 1);
    expect(sentence).toBe(
      'Refold the crease from step 2 and pinch it where the crease from step 3 crosses it.'
    );
  });

  it('says to run the crease out when nothing sights it yet', () => {
    const out = { ...press, press: { ...press.press, sighted_from: null } };
    const seq = { ...sequence, steps: [...sequence.steps, out] };
    const sentence = describePlannerStep(t, seq, plannerRefIndex(seq), seq.steps.length - 1);
    expect(sentence).toContain('Refold the crease from step 2 and crease it further');
    expect(sentence).toContain('the edge');
  });
});
