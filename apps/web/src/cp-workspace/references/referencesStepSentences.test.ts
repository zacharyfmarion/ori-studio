import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { ExtractedStep } from './referenceFinder/extractor';
import {
  describeStep,
  isLineLabel,
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

  it("follows the core's slot meaning for O7: l0 onto itself, p0 lands on l1", () => {
    expect(describeStep(t, step({ axiom: 7, inputs: ['P', 'A', 's'], label: 'C' }))).toBe(
      'Fold C, folding line A onto itself so that point P lands on the bottom edge.'
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
