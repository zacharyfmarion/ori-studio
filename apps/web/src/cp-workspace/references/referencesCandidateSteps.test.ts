import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import consecutiveFixture from './referenceFinder/__fixtures__/consecutive-marks.json';
import lineAxiom7Fixture from './referenceFinder/__fixtures__/line-axiom7.json';
import lineExactFixture from './referenceFinder/__fixtures__/line-exact.json';
import linePinchFixture from './referenceFinder/__fixtures__/line-pinch.json';
import markAxiom4Fixture from './referenceFinder/__fixtures__/mark-axiom4.json';
import markCentreFixture from './referenceFinder/__fixtures__/mark-centre.json';
import markFixture from './referenceFinder/__fixtures__/mark.json';
import {
  extractSolution,
  type ExtractedSolution,
  type ExtractedStep,
} from './referenceFinder/extractor';
import type { ReferenceFinderReplayFixture } from './referenceFinder/replayClient';
import type { Diagram } from './referenceFinder/solution';
import { referenceFinderDiagramToPrimitives } from './referenceFinderDiagramToPrimitives';
import {
  candidateStepCount,
  candidateStepDiagram,
  candidateViewSteps,
  clampCandidateStep,
  describeCandidateStep,
  describeDiagonalStep,
  diagonalStepDiagram,
  type ReferencesCandidateRfStep,
} from './referencesCandidateSteps';

function step(overrides: Partial<ExtractedStep>): ExtractedStep {
  return { axiom: 1, inputs: [], label: '', pinch: false, diagramIndex: null, ...overrides };
}

/** A line step, with the diagram index a fold gets. */
function line(
  label: string,
  diagramIndex: number,
  overrides: Partial<ExtractedStep> = {}
): ExtractedStep {
  return step({ axiom: 2, inputs: ['sw', 'ne'], label, diagramIndex, ...overrides });
}

/** A mark step: no diagram of its own. */
function mark(label: string, inputs: string[] = ['e', 'A']): ExtractedStep {
  return step({ axiom: 0, inputs, label, point: [1, 0.5] });
}

function solution(
  steps: ExtractedStep[],
  freeDiagonals: ExtractedSolution['freeDiagonals'] = [],
  target: ExtractedSolution['target'] = { kind: 'point', point: [0, 0] }
): ExtractedSolution {
  return {
    exact: true,
    err: 0,
    rank: steps.length,
    foldCount: steps.length + freeDiagonals.length,
    steps,
    freeDiagonals,
    target,
  };
}

/** The English default, with its placeholders filled. */
const t = ((key: string, defaultValue: string, options?: Record<string, string>) =>
  defaultValue.replace(
    /\{\{(\w+)\}\}/g,
    (_, name) => options?.[name] ?? ''
  )) as unknown as TFunction;

const fixtures: Record<string, ReferenceFinderReplayFixture> = {
  'mark.json': markFixture as unknown as ReferenceFinderReplayFixture,
  'mark-centre.json': markCentreFixture as unknown as ReferenceFinderReplayFixture,
  'mark-axiom4.json': markAxiom4Fixture as unknown as ReferenceFinderReplayFixture,
  'line-exact.json': lineExactFixture as unknown as ReferenceFinderReplayFixture,
  'line-pinch.json': linePinchFixture as unknown as ReferenceFinderReplayFixture,
  'line-axiom7.json': lineAxiom7Fixture as unknown as ReferenceFinderReplayFixture,
  'consecutive-marks.json': consecutiveFixture as unknown as ReferenceFinderReplayFixture,
};

function extractAll(fixture: ReferenceFinderReplayFixture) {
  const sheet = { width: fixture.database.width, height: fixture.database.height };
  return fixture.solutions.map((raw) => ({
    raw,
    solution: extractSolution(raw, fixture.query, sheet),
  }));
}

function rfSteps(steps: ReturnType<typeof candidateViewSteps>): ReferencesCandidateRfStep[] {
  return steps.filter((s): s is ReferencesCandidateRfStep => s.kind === 'rf');
}

describe('candidateViewSteps', () => {
  it('reads the diagonals the answer leans on first, then a card per fold', () => {
    const two = solution([line('A', 0), line('B', 1)], ['sw_ne', 'nw_se']);
    expect(candidateViewSteps(two)).toEqual([
      { kind: 'diagonal', diagonal: 'sw_ne' },
      { kind: 'diagonal', diagonal: 'nw_se' },
      { kind: 'rf', steps: [0], diagramIndex: 0 },
      { kind: 'rf', steps: [1], diagramIndex: 1 },
    ]);
    expect(candidateStepCount(two)).toBe(4);
    expect(candidateStepCount(null)).toBe(0);
  });

  it('is only the diagonal when the diagonal is the answer', () => {
    const only = solution([], ['nw_se']);
    expect(candidateViewSteps(only)).toEqual([{ kind: 'diagonal', diagonal: 'nw_se' }]);
    expect(clampCandidateStep(only, 5)).toBe(0);
  });

  it('reads a fold and the mark it is for as one card — the core draws them in one diagram', () => {
    // A, then P on it; B, then Q on it; C. Three diagrams, three cards.
    const marks = solution(
      [line('A', 0), mark('P'), line('B', 1), mark('Q', ['e', 'B']), line('C', 2)],
      [],
      { kind: 'line', line: { a: [0, 0], b: [1, 1] } }
    );
    expect(candidateViewSteps(marks)).toEqual([
      { kind: 'rf', steps: [0, 1], diagramIndex: 0 },
      { kind: 'rf', steps: [2, 3], diagramIndex: 1 },
      { kind: 'rf', steps: [4], diagramIndex: 2 },
    ]);
  });

  it("gives a point query's final mark a card of its own, on the trailing diagram", () => {
    // A, P; B, then the final mark Q — refBase.cpp draws the last step standalone.
    const point = solution([line('A', 0), mark('P'), line('B', 1), mark('Q', ['A', 'B'])]);
    expect(candidateViewSteps(point)).toEqual([
      { kind: 'rf', steps: [0, 1], diagramIndex: 0 },
      { kind: 'rf', steps: [2], diagramIndex: 1 },
      { kind: 'rf', steps: [3], diagramIndex: null },
    ]);
  });

  it('reads a mark made before any fold, or the second of two in a row, with the next fold', () => {
    // The centre from the diagonals, then a fold through it: the mark is an
    // input the first diagram highlights, so it is read there.
    const leading = solution([mark('P', ['sw_ne', 'nw_se']), line('A', 0)], ['sw_ne', 'nw_se'], {
      kind: 'line',
      line: { a: [0, 0], b: [1, 1] },
    });
    expect(rfSteps(candidateViewSteps(leading))).toEqual([
      { kind: 'rf', steps: [0, 1], diagramIndex: 0 },
    ]);
    // A, P, Q, B: A's diagram draws P; Q is first drawn in B's.
    const consecutive = solution(
      [line('A', 0), mark('P'), mark('Q', ['n', 'A']), line('B', 1)],
      [],
      { kind: 'line', line: { a: [0, 0], b: [1, 1] } }
    );
    expect(candidateViewSteps(consecutive)).toEqual([
      { kind: 'rf', steps: [0, 1], diagramIndex: 0 },
      { kind: 'rf', steps: [2, 3], diagramIndex: 1 },
    ]);
  });

  it('is one card for a mark made only of the sheet’s own lines', () => {
    const centre = solution([mark('P', ['sw_ne', 'nw_se'])], ['sw_ne', 'nw_se']);
    expect(candidateViewSteps(centre)).toEqual([
      { kind: 'diagonal', diagonal: 'sw_ne' },
      { kind: 'diagonal', diagonal: 'nw_se' },
      { kind: 'rf', steps: [0], diagramIndex: null },
    ]);
  });

  it('clamps a stale step index into the reading order', () => {
    const two = solution([line('A', 0)], ['sw_ne']);
    expect(clampCandidateStep(two, 9)).toBe(1);
    expect(clampCandidateStep(two, -3)).toBe(0);
    expect(clampCandidateStep(two, 1.7)).toBe(1);
    expect(clampCandidateStep(null, 4)).toBe(0);
  });

  it('covers every step of every captured solution exactly once, one card per diagram', () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      for (const [index, { raw, solution: extracted }] of extractAll(fixture).entries()) {
        const cards = rfSteps(candidateViewSteps(extracted));
        const covered = cards.flatMap((card) => card.steps);
        expect(covered, `${name} solution ${index}`).toEqual(extracted.steps.map((_, i) => i));
        const lineSteps = extracted.steps.filter((s) => s.diagramIndex !== null).length;
        // The core prints one diagram per fold plus the standalone final mark
        // of a point query; a mark made only of originals has a placeholder
        // ahead of its one real diagram instead (refBase.cpp:172).
        if (lineSteps > 0)
          expect(cards, `${name} solution ${index}`).toHaveLength(raw.diagrams.length);
        const diagrams = cards.map((card) => candidateStepDiagram(raw, card));
        expect(
          diagrams.every((d) => d !== null),
          `${name} solution ${index}`
        ).toBe(true);
        expect(new Set(diagrams).size, `${name} solution ${index}: cards share a picture`).toBe(
          diagrams.length
        );
      }
    }
  });

  it("gives the sheet centre's runner-up six distinct cards, not ten with pairs alike", () => {
    // Zach, on this answer: "steps 2 and 3 are exactly the same. Same with 4
    // and 5, 6 and 7, and 8 and 9."
    const [, second] = extractAll(fixtures['mark-centre.json']);
    expect(second.solution.steps).toHaveLength(10);
    const cards = candidateViewSteps(second.solution);
    expect(cards).toEqual([
      { kind: 'rf', steps: [0, 1], diagramIndex: 0 },
      { kind: 'rf', steps: [2, 3], diagramIndex: 1 },
      { kind: 'rf', steps: [4, 5], diagramIndex: 2 },
      { kind: 'rf', steps: [6, 7], diagramIndex: 3 },
      { kind: 'rf', steps: [8], diagramIndex: 4 },
      { kind: 'rf', steps: [9], diagramIndex: null },
    ]);
    expect(describeCandidateStep(t, second.solution, cards[1])).toBe(
      'Fold B, bringing the bottom-right corner onto point P. Mark Q where the right edge meets line B. Pinch only — just the mark is needed.'
    );
    expect(describeCandidateStep(t, second.solution, cards[5])).toBe(
      'Mark T where line A meets line E.'
    );
  });
});

describe('candidateStepDiagram', () => {
  it('draws a fold from its own diagram and a final mark from the trailing one', () => {
    const { raw, solution: extracted } = extractAll(fixtures['mark.json'])[0];
    const cards = rfSteps(candidateViewSteps(extracted));
    expect(raw.diagrams).toHaveLength(3);
    expect(candidateStepDiagram(raw, cards[0])).toBe(raw.diagrams[0]);
    expect(candidateStepDiagram(raw, cards[1])).toBe(raw.diagrams[1]);
    expect(candidateStepDiagram(raw, cards[2])).toBe(raw.diagrams[2]);
  });

  it('skips the action-free placeholder for a mark made only of originals', () => {
    // The sheet centre: one O0 step over the two diagonals, no action line, so
    // `BuildDiagrams` (refBase.cpp:172) emits a `(0, 0)` placeholder ahead of
    // the final-mark diagram. Assert on the drawn mark, not on an index, so a
    // change to the upstream placeholder rule still trips this.
    const { raw, solution: centre } = extractAll(fixtures['mark-centre.json'])[0];
    const [card] = rfSteps(candidateViewSteps(centre));
    const diagram = candidateStepDiagram(raw, card);
    expect(diagram).not.toBeNull();
    const model = referenceFinderDiagramToPrimitives(diagram as Diagram);
    expect(model.primitives).toContainEqual({ kind: 'point', at: [0.5, 0.5], style: 'action' });
    expect(model.primitives).toContainEqual({
      kind: 'label',
      at: [0.5, 0.5],
      text: 'P',
      style: 'action',
    });
  });

  it('is null for a fold whose diagram the core did not print', () => {
    expect(
      candidateStepDiagram(
        { diagrams: [] } as unknown as Parameters<typeof candidateStepDiagram>[0],
        {
          kind: 'rf',
          steps: [0],
          diagramIndex: 0,
        }
      )
    ).toBeNull();
  });
});

describe('describeCandidateStep', () => {
  it('reads a fold, then the mark it makes, then how much of it to press', () => {
    const pinched = solution([
      line('A', 0, { pinch: true }),
      mark('P', ['e', 'A']),
      mark('Q', ['A', 'A']),
    ]);
    const [first] = candidateViewSteps(pinched);
    expect(describeCandidateStep(t, pinched, first)).toBe(
      'Fold A, bringing the bottom-left corner onto the top-right corner. Mark P where the right edge meets line A. Pinch only — just the mark is needed.'
    );
  });

  it('reads a leading mark before the fold that uses it', () => {
    const leading = solution([mark('P', ['sw_ne', 'nw_se']), line('A', 0)], ['sw_ne', 'nw_se'], {
      kind: 'line',
      line: { a: [0, 0], b: [1, 1] },
    });
    const [, , card] = candidateViewSteps(leading);
    expect(describeCandidateStep(t, leading, card)).toBe(
      'Mark P where the bottom-left to top-right diagonal meets the top-left to bottom-right diagonal. Fold A, bringing the bottom-left corner onto the top-right corner.'
    );
  });

  it('describes a diagonal step as the diagonal', () => {
    expect(describeCandidateStep(t, solution([]), { kind: 'diagonal', diagonal: 'sw_ne' })).toBe(
      describeDiagonalStep(t, 'sw_ne')
    );
  });
});

describe('diagonalStepDiagram', () => {
  it('folds corner onto corner along the diagonal, as a valley, with the motion drawn', () => {
    const model = diagonalStepDiagram('sw_ne', { width: 1, height: 0.75 });
    expect(model.sheet).toEqual({ width: 1, height: 0.75 });
    expect(model.primitives).toContainEqual({
      kind: 'line',
      from: [0, 0],
      to: [1, 0.75],
      style: 'valley',
    });
    expect(model.primitives.filter((p) => p.kind === 'point')).toHaveLength(2);
    expect(model.primitives.some((p) => p.kind === 'fold-arrow')).toBe(true);
    const other = diagonalStepDiagram('nw_se', { width: 1, height: 1 });
    expect(other.primitives).toContainEqual({
      kind: 'line',
      from: [0, 1],
      to: [1, 0],
      style: 'valley',
    });
  });
});

describe('describeDiagonalStep', () => {
  it('names the two corners', () => {
    expect(describeDiagonalStep(t, 'sw_ne')).toBe(
      'Fold the bottom-left corner onto the top-right corner, creasing the diagonal.'
    );
    expect(describeDiagonalStep(t, 'nw_se')).toBe(
      'Fold the top-left corner onto the bottom-right corner, creasing the diagonal.'
    );
  });
});
