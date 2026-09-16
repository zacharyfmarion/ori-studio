/**
 * `useReferencesHighlights` on an answer with steps: the target is drawn on
 * the last step only. Before that the sheet is the outline and the step —
 * the thing being constructed is not on the paper until the last fold makes
 * it, and drawn on every step in its own colour it read as part of each.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { ExtractedSolution, ExtractedStep } from './referenceFinder/extractor';
import type { RawSolution } from './referenceFinder/solution';
import type {
  ReferencesCandidateResult,
  ReferencesResults,
  ReferencesTargetRecord,
} from './referencesResults';
import { useReferencesHighlights, type ReferencesHighlights } from './useReferencesView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Two creases round a corner; the second is the picked one. */
const GEOMETRY = {
  segEndpoints: Float64Array.from([0, 0, 100, 0, 0, 0, 0, 100]),
  segAttr: new Int32Array(10),
} as unknown as CpGeometryTransport;

function step(overrides: Partial<ExtractedStep>): ExtractedStep {
  return { axiom: 1, inputs: [], label: '', pinch: false, diagramIndex: null, ...overrides };
}

/** A two-fold construction: A, then the crease itself. */
const SOLUTION: ExtractedSolution = {
  exact: true,
  err: 0,
  rank: 2,
  foldCount: 2,
  steps: [
    step({ axiom: 2, inputs: ['sw', 'ne'], label: 'A', diagramIndex: 0 }),
    step({ axiom: 1, inputs: ['A', 'sw'], label: 'B', diagramIndex: 1 }),
  ],
  freeDiagonals: [],
  target: { kind: 'line', line: { a: [0, 0], b: [0, 1] } },
};

/** ReferenceFinder's own picture of each step: the sheet and the fold line. */
const RAW = {
  diagrams: [
    [
      { type: 3, width: 1, height: 1 },
      { type: 1, from: [0, 0.5], to: [1, 0.5], style: 3 },
    ],
    [
      { type: 3, width: 1, height: 1 },
      { type: 1, from: [0, 0.5], to: [1, 0.5], style: 0 },
      { type: 1, from: [0, 0], to: [0, 1], style: 3 },
    ],
  ],
} as unknown as RawSolution;

const CANDIDATE: ReferencesCandidateResult = {
  solution: SOLUTION,
  raw: RAW,
  modelSteps: [
    { line: { a: { x: 100, y: 50 }, b: { x: 0, y: 50 } } },
    { line: { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } } },
  ],
};

const TARGET: ReferencesTargetRecord = {
  kind: 'crease',
  component: 0,
  lineId: 2,
  a: { x: 0, y: 0 },
  b: { x: 0, y: 100 },
  cpLineIds: [2],
  rf: [
    [0, 0],
    [0, 1],
  ],
};

const RESULTS: ReferencesResults = {
  revision: 'r1',
  target: TARGET,
  frame: { origin: [0, 100], x_axis: [1, 0], y_axis: [0, -1], width: 100, height: 100 },
  originals: {
    lines: {
      s: { a: { x: 0, y: 100 }, b: { x: 100, y: 100 } },
      n: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    },
    marks: { sw: { x: 0, y: 100 }, ne: { x: 100, y: 0 } },
  },
  candidates: [CANDIDATE],
  durationMs: 1,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let highlights: ReferencesHighlights | null = null;

function Probe({ results, activeStep }: { results: ReferencesResults | null; activeStep: number }) {
  const drawn = useReferencesHighlights(GEOMETRY, results, true, TARGET, 0, activeStep);
  useEffect(() => {
    highlights = drawn;
  });
  return null;
}

function render(results: ReferencesResults | null, activeStep: number): void {
  act(() => root?.render(<Probe results={results} activeStep={activeStep} />));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  highlights = null;
});

describe('useReferencesHighlights', () => {
  it('marks the pick while there is no answer yet', () => {
    render(null, 0);
    expect(highlights?.selected).toEqual({ kind: 'line', id: 2 });
  });

  it('keeps the target off the sheet until the last step makes it', () => {
    render(RESULTS, 0);
    expect(highlights?.selected).toBeNull();
    expect(highlights?.highlightLineIds.size).toBe(0);
    // The step itself is still drawn — the card's own picture, on the pattern.
    expect(highlights?.diagram?.primitives).toEqual([
      expect.objectContaining({ kind: 'line', style: 'valley', from: [0, 50], to: [100, 50] }),
    ]);

    render(RESULTS, 1);
    expect(highlights?.selected).toEqual({ kind: 'line', id: 2 });
    expect([...(highlights?.highlightLineIds ?? [])]).toEqual([2]);
  });
});
