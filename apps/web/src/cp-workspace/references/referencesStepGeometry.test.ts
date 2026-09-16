import { describe, expect, it } from 'vitest';
import type { ExtractedSolution, ExtractedStep } from './referenceFinder/extractor';
import type { ReferencesModelStep, ReferencesOriginals } from './referencesResults';
import { clampStepIndex, referencesStepOverlay } from './referencesStepGeometry';

function step(overrides: Partial<ExtractedStep>): ExtractedStep {
  return { axiom: 1, inputs: [], label: '', pinch: false, diagramIndex: null, ...overrides };
}

function solution(steps: ExtractedStep[]): ExtractedSolution {
  return {
    exact: true,
    err: 0,
    rank: steps.length,
    foldCount: steps.filter((s) => s.axiom > 0).length,
    steps,
    freeDiagonals: [],
    target: { kind: 'point', point: [0, 0] },
  };
}

const ORIGINALS: ReferencesOriginals = {
  lines: {
    s: { a: { x: 0, y: 100 }, b: { x: 100, y: 100 } },
    n: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    sw_ne: { a: { x: 0, y: 100 }, b: { x: 100, y: 0 } },
  },
  marks: { sw: { x: 0, y: 100 }, se: { x: 100, y: 100 } },
};

// A: fold se onto ne (a line); P: mark A ∩ w; B: O6 through se/n and P/s; Q: mark.
const STEPS: ExtractedStep[] = [
  step({ axiom: 2, inputs: ['se', 'ne'], label: 'A', pinch: true, diagramIndex: 0 }),
  step({ axiom: 0, inputs: ['w', 'A'], label: 'P' }),
  step({ axiom: 6, inputs: ['se', 'P', 'n', 's'], label: 'B', pinch: true, diagramIndex: 1 }),
  step({ axiom: 0, inputs: ['sw_ne', 'B'], label: 'Q' }),
];
const MODEL: ReferencesModelStep[] = [
  { line: { a: { x: 100, y: 50 }, b: { x: 0, y: 50 } } },
  { point: { x: 0, y: 50 } },
  { line: { a: { x: 0, y: 78 }, b: { x: 100, y: 44 } } },
  { point: { x: 33, y: 67 } },
];

describe('clampStepIndex', () => {
  it('keeps a stale index inside the candidate', () => {
    const s = solution(STEPS);
    expect(clampStepIndex(s, 9)).toBe(3);
    expect(clampStepIndex(s, -2)).toBe(0);
    expect(clampStepIndex(s, 2.7)).toBe(2);
    expect(clampStepIndex(null, 4)).toBe(0);
    expect(clampStepIndex(solution([]), 4)).toBe(0);
  });
});

describe('referencesStepOverlay', () => {
  it('draws the first step as new with its original inputs as marks', () => {
    const overlay = referencesStepOverlay(solution(STEPS), MODEL, ORIGINALS, 0);
    expect(overlay.ghosts).toEqual([{ ...MODEL[0].line, kind: 'new' }]);
    // `se` is a known corner, `ne` is not in these originals and is skipped.
    expect(overlay.markers).toEqual([{ at: ORIGINALS.marks.se, kind: 'input' }]);
    expect(overlay.bounds).toEqual({ minX: 0, minY: 50, maxX: 100, maxY: 100 });
  });

  it('shows an earlier line as an input when the active step names it', () => {
    const overlay = referencesStepOverlay(solution(STEPS), MODEL, ORIGINALS, 1);
    expect(overlay.ghosts).toEqual([{ ...MODEL[0].line, kind: 'input' }]);
    expect(overlay.markers).toEqual([{ at: MODEL[1].point, kind: 'new' }]);
  });

  it('draws unused earlier lines folded, named edges as inputs, and earlier marks only as inputs', () => {
    const overlay = referencesStepOverlay(solution(STEPS), MODEL, ORIGINALS, 2);
    expect(overlay.ghosts).toEqual([
      { ...MODEL[0].line, kind: 'folded' },
      { ...ORIGINALS.lines.n, kind: 'input' },
      { ...ORIGINALS.lines.s, kind: 'input' },
      { ...MODEL[2].line, kind: 'new' },
    ]);
    expect(overlay.markers).toEqual([
      { at: ORIGINALS.marks.se, kind: 'input' },
      { at: MODEL[1].point, kind: 'input' },
    ]);
  });

  it('never draws steps after the active one', () => {
    const overlay = referencesStepOverlay(solution(STEPS), MODEL, ORIGINALS, 1);
    expect(overlay.ghosts.some((g) => g.a.y === 78)).toBe(false);
    expect(overlay.markers.some((m) => m.kind === 'new' && m.at.x === 33)).toBe(false);
  });

  it('uses a free diagonal as an input line on the final mark', () => {
    const overlay = referencesStepOverlay(solution(STEPS), MODEL, ORIGINALS, 3);
    expect(overlay.ghosts).toContainEqual({ ...ORIGINALS.lines.sw_ne, kind: 'input' });
    expect(overlay.ghosts).toContainEqual({ ...MODEL[2].line, kind: 'input' });
    expect(overlay.ghosts).toContainEqual({ ...MODEL[0].line, kind: 'folded' });
    expect(overlay.markers).toEqual([{ at: MODEL[3].point, kind: 'new' }]);
  });

  it('is empty for a construction with no steps', () => {
    expect(referencesStepOverlay(solution([]), [], ORIGINALS, 0)).toEqual({
      ghosts: [],
      markers: [],
      bounds: null,
      // No step, so no motion to draw — and O1 and O4 carry none either.
      arc: null,
    });
  });

  it('tolerates model steps that have not been mapped yet', () => {
    const overlay = referencesStepOverlay(solution(STEPS), [], ORIGINALS, 2);
    expect(overlay.ghosts.every((g) => g.kind === 'input')).toBe(true);
    expect(overlay.markers).toEqual([{ at: ORIGINALS.marks.se, kind: 'input' }]);
  });
});
