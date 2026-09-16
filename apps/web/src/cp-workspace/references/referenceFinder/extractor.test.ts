/**
 * The extractor against real module output. Every fixture in `__fixtures__/` was
 * captured from the core by `capture.mjs`; the assertions below are the rules in
 * `extractor.ts`, each checked on the case that motivated it.
 */
import { describe, expect, it } from 'vitest';
import {
  EXTRACT_TOLERANCE,
  ReferenceFinderExtractError,
  extendToSheet,
  extractSolution,
  intersectSegments,
  type ExtractedSolution,
  type ReferenceFinderQuery,
  type SheetSegment,
} from './extractor';
import { LINE_STYLE, type RawLineSolution, type RawPointSolution, type RawSolution, type RfPoint } from './solution';
import type { ReferenceFinderReplayFixture } from './replayClient';
import lineExactJson from './__fixtures__/line-exact.json';
import markJson from './__fixtures__/mark.json';
import lineDiagonalJson from './__fixtures__/line-diagonal.json';
import markCentreJson from './__fixtures__/mark-centre.json';
import linePinchJson from './__fixtures__/line-pinch.json';
import lineApproximateJson from './__fixtures__/line-approximate.json';
import consecutiveMarksJson from './__fixtures__/consecutive-marks.json';
import lineAxiom7Json from './__fixtures__/line-axiom7.json';
import markAxiom4Json from './__fixtures__/mark-axiom4.json';

const fixtures = {
  lineExact: lineExactJson as unknown as ReferenceFinderReplayFixture,
  mark: markJson as unknown as ReferenceFinderReplayFixture,
  lineDiagonal: lineDiagonalJson as unknown as ReferenceFinderReplayFixture,
  markCentre: markCentreJson as unknown as ReferenceFinderReplayFixture,
  linePinch: linePinchJson as unknown as ReferenceFinderReplayFixture,
  lineApproximate: lineApproximateJson as unknown as ReferenceFinderReplayFixture,
  consecutiveMarks: consecutiveMarksJson as unknown as ReferenceFinderReplayFixture,
  lineAxiom7: lineAxiom7Json as unknown as ReferenceFinderReplayFixture,
  markAxiom4: markAxiom4Json as unknown as ReferenceFinderReplayFixture,
};

const sheet = { width: 1, height: 1 };

function extractAll(fixture: ReferenceFinderReplayFixture): ExtractedSolution[] {
  return fixture.solutions.map((solution) => extractSolution(solution, fixture.query, sheet));
}

function pointOnLine(p: RfPoint, line: SheetSegment): number {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  return Math.abs(dx * (p[1] - line.a[1]) - dy * (p[0] - line.a[0])) / Math.hypot(dx, dy);
}

function lineStepCount(solution: RawSolution): number {
  return solution.steps.filter((step) => step.axiom > 0).length;
}

describe('extractSolution on captured module output', () => {
  it('extracts every solution of every fixture without refusing one', () => {
    for (const fixture of Object.values(fixtures)) {
      expect(extractAll(fixture)).toHaveLength(fixture.solutions.length);
    }
  });

  it('advances the diagram index only on line steps, keeping every mark', () => {
    for (const fixture of Object.values(fixtures)) {
      fixture.solutions.forEach((raw) => {
        const extracted = extractSolution(raw, fixture.query, sheet);
        expect(extracted.steps).toHaveLength(raw.steps.length);
        const lineIndices = extracted.steps
          .filter((step) => step.axiom > 0)
          .map((step) => step.diagramIndex);
        expect(lineIndices).toEqual(lineIndices.map((_, i) => i));
        for (const step of extracted.steps) {
          if (step.axiom === 0) {
            expect(step.diagramIndex).toBeNull();
            expect(step.point).toBeDefined();
            expect(step.line).toBeUndefined();
          } else {
            expect(step.line).toBeDefined();
          }
        }
      });
    }
  });

  it('ignores the trailing standalone diagram of a mark query', () => {
    // A point target ends with a diagram that draws the final mark alone; it
    // has no valley/pinch element and belongs to no line step.
    for (const raw of fixtures.mark.solutions) {
      expect(raw.diagrams).toHaveLength(lineStepCount(raw) + 1);
      const trailing = raw.diagrams[raw.diagrams.length - 1];
      expect(
        trailing.filter((e) => e.type === 1 && (e.style === LINE_STYLE.valley || e.style === LINE_STYLE.pinch))
      ).toHaveLength(0);
      expect(() => extractSolution(raw, fixtures.mark.query, sheet)).not.toThrow();
    }
    const [best] = extractAll(fixtures.mark);
    expect(best.exact).toBe(true);
    expect(best.target).toEqual({ kind: 'point', point: expect.any(Array) });
    if (best.target.kind === 'point') {
      expect(best.target.point[0]).toBeCloseTo(1 / 3, 9);
      expect(best.target.point[1]).toBeCloseTo(1 / 3, 9);
    }
  });

  it('treats the diagonal as an original: no steps, one free diagonal, one fold', () => {
    const [diagonal, ...rest] = extractAll(fixtures.lineDiagonal);
    expect(fixtures.lineDiagonal.solutions[0].steps).toEqual([]);
    expect(diagonal.exact).toBe(true);
    expect(diagonal.steps).toEqual([]);
    expect(diagonal.freeDiagonals).toEqual(['sw_ne']);
    expect(diagonal.foldCount).toBe(1);
    expect(diagonal.target).toEqual({ kind: 'line', line: { a: [0, 0], b: [1, 1] } });
    // The approximations to the diagonal are ordinary constructions.
    for (const solution of rest) {
      expect(solution.exact).toBe(false);
      expect(solution.foldCount).toBe(solution.steps.filter((s) => s.axiom > 0).length + solution.freeDiagonals.length);
    }
  });

  it('treats an edge as a free original with no fold', () => {
    const raw: RawLineSolution = { solution: [0, [0, 1]], err: 0, rank: 0, steps: [], diagrams: [[{ type: 3, width: 1, height: 1 }]] };
    const extracted = extractSolution(raw, { kind: 'line', a: [0, 0], b: [1, 0] }, sheet);
    expect(extracted.foldCount).toBe(0);
    expect(extracted.freeDiagonals).toEqual([]);
    expect(extracted.target).toEqual({ kind: 'line', line: { a: [0, 0], b: [1, 0] } });
  });

  it('treats a corner as a free original point', () => {
    const raw: RawPointSolution = { solution: [1, 0], err: 0, rank: 0, steps: [], diagrams: [[{ type: 3, width: 1, height: 1 }]] };
    const extracted = extractSolution(raw, { kind: 'point', point: [1, 0] }, sheet);
    expect(extracted.foldCount).toBe(0);
    expect(extracted.target).toEqual({ kind: 'point', point: [1, 0] });
  });

  it('names both diagonals for the centre and charges them as folds', () => {
    const [centre] = extractAll(fixtures.markCentre);
    expect(fixtures.markCentre.solutions[0].steps).toEqual([
      { axiom: 0, l0: 'sw_ne', l1: 'nw_se', x: 'P' },
    ]);
    // An all-original mark carries two extra diagrams, not one.
    expect(fixtures.markCentre.solutions[0].diagrams).toHaveLength(2);
    expect(centre.exact).toBe(true);
    expect(centre.steps).toHaveLength(1);
    expect(centre.steps[0].point?.[0]).toBeCloseTo(0.5, 12);
    expect(centre.steps[0].point?.[1]).toBeCloseTo(0.5, 12);
    expect(centre.freeDiagonals).toEqual(['sw_ne', 'nw_se']);
    expect(centre.foldCount).toBe(2);
  });

  it('keeps consecutive marks and their diagrams in step', () => {
    const fixture = fixtures.consecutiveMarks;
    const raw = fixture.solutions[1];
    const adjacent = raw.steps.findIndex((step, i) => i > 0 && step.axiom === 0 && raw.steps[i - 1].axiom === 0);
    expect(adjacent).toBeGreaterThan(0);
    const extracted = extractSolution(raw, fixture.query, sheet);
    expect(extracted.steps.filter((s) => s.axiom === 0)).toHaveLength(
      raw.steps.filter((s) => s.axiom === 0).length
    );
    // With the marks kept, every later line lands where the core says it does:
    // the final crease reproduces the solution line (asserted inside extract).
    const last = extracted.steps[extracted.steps.length - 1];
    const [d, u] = raw.solution as [number, RfPoint];
    for (const p of [last.line!.a, last.line!.b]) {
      expect(Math.abs(p[0] * u[0] + p[1] * u[1] - d)).toBeLessThanOrEqual(EXTRACT_TOLERANCE);
    }
  });

  it('extends a pinch to the full chord of the sheet', () => {
    const fixture = fixtures.linePinch;
    const raw = fixture.solutions[0];
    const extracted = extractSolution(raw, fixture.query, sheet);
    expect(extracted.exact).toBe(true);
    const pinches = extracted.steps.filter((s) => s.pinch);
    expect(pinches.length).toBeGreaterThan(0);
    for (const step of pinches) {
      const diagram = raw.diagrams[step.diagramIndex!];
      const drawn = diagram.find((e) => e.type === 1 && e.style === LINE_STYLE.pinch);
      expect(drawn && drawn.type === 1).toBe(true);
      if (!drawn || drawn.type !== 1) continue;
      const drawnLength = Math.hypot(drawn.to[0] - drawn.from[0], drawn.to[1] - drawn.from[1]);
      const chord = Math.hypot(step.line!.b[0] - step.line!.a[0], step.line!.b[1] - step.line!.a[1]);
      // The core draws a tenth of the sheet around the mark; the chord is longer.
      expect(drawnLength).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(chord).toBeGreaterThan(drawnLength * 2);
      // Collinear with what was drawn, and ending on the sheet outline.
      expect(pointOnLine(drawn.from, step.line!)).toBeLessThanOrEqual(1e-9);
      expect(pointOnLine(drawn.to, step.line!)).toBeLessThanOrEqual(1e-9);
      for (const p of [step.line!.a, step.line!.b]) {
        const onOutline = [p[0], p[1], 1 - p[0], 1 - p[1]].some((v) => Math.abs(v) <= 1e-9);
        expect(onOutline).toBe(true);
      }
    }
  });

  it('reports the extracted target of an exact line as the query line', () => {
    const fixture = fixtures.lineExact;
    const [best] = extractAll(fixture);
    expect(best.exact).toBe(true);
    expect(best.err).toBe(0);
    expect(best.rank).toBe(2);
    expect(best.foldCount).toBe(2);
    expect(best.steps.map((s) => s.axiom)).toEqual([2, 0, 2]);
    expect(best.steps[0].pinch).toBe(true);
    expect(best.steps[0].inputs).toEqual(['se', 'ne']);
    expect(best.steps[1].inputs).toEqual(['e', 'A']);
    expect(best.target.kind).toBe('line');
    if (best.target.kind === 'line' && fixture.query.kind === 'line') {
      expect(pointOnLine(fixture.query.a, best.target.line)).toBeLessThanOrEqual(EXTRACT_TOLERANCE);
      expect(pointOnLine(fixture.query.b, best.target.line)).toBeLessThanOrEqual(EXTRACT_TOLERANCE);
    }
  });

  it('marks approximate solutions inexact and does not demand they hit the target', () => {
    const solutions = extractAll(fixtures.lineApproximate);
    expect(solutions.every((s) => !s.exact)).toBe(true);
    expect(solutions[0].err).toBeGreaterThan(1e-9);
    // But each one's final crease is still the line the core says it built.
    const [d, u] = fixtures.lineApproximate.solutions[0].solution as [number, RfPoint];
    const target = solutions[0].target;
    if (target.kind === 'line') {
      expect(Math.abs(target.line.a[0] * u[0] + target.line.a[1] * u[1] - d)).toBeLessThanOrEqual(EXTRACT_TOLERANCE);
    }
  });

  it('carries the O3 bisector hint and the O5-O7 order through', () => {
    const solutions = extractAll(fixtures.mark);
    const o6 = solutions[0].steps.find((s) => s.axiom === 6);
    expect(o6?.order).toBe('p0,l0,l1,p1');
    const o3 = solutions[1].steps.find((s) => s.axiom === 3);
    expect(o3?.bisectorHint).toEqual([0, 0.377319402557146]);
    expect(o3?.inputs).toEqual(['s', 'D']);
  });

  // O4 and O7 appear in no other fixture, and O7 is the one axiom whose
  // serialised line slots run the other way (`refLineL2LP2L.cpp:146-148`), so
  // the flattening order is worth pinning on real output rather than only on a
  // synthetic step.
  it('flattens an O7 step as p0, l0, l1 in the wire order', () => {
    const solutions = extractAll(fixtures.lineAxiom7);
    const o7 = solutions.flatMap((s) => s.steps).find((s) => s.axiom === 7);
    expect(o7).toBeDefined();
    expect(o7!.inputs).toEqual(['P', 'e', 'C']);
    expect(o7!.order).toBe('l0,p0');
    expect(o7!.line).toBeDefined();
  });

  it('flattens an O4 step as p0, l0', () => {
    const solutions = extractAll(fixtures.markAxiom4);
    const o4 = solutions.flatMap((s) => s.steps).find((s) => s.axiom === 4);
    expect(o4).toBeDefined();
    expect(o4!.inputs).toEqual(['Q', 'e']);
    expect(o4!.pinch).toBe(true);
    expect(o4!.line).toBeDefined();
  });
});

describe('extractSolution refusals', () => {
  const fixture = fixtures.lineExact;
  const good = fixture.solutions[0] as RawLineSolution;
  const query = fixture.query as ReferenceFinderQuery;

  function expectRefusal(raw: RawSolution, reason: string, q: ReferenceFinderQuery = query) {
    let caught: unknown;
    try {
      extractSolution(raw, q, sheet);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReferenceFinderExtractError);
    expect((caught as ReferenceFinderExtractError).reason).toBe(reason);
    expect((caught as ReferenceFinderExtractError).code).toBe('reference_finder_extract');
  }

  it('refuses a line diagram with no valley or pinch element', () => {
    const raw = structuredClone(good);
    raw.diagrams[1] = raw.diagrams[1].filter((e) => !(e.type === 1 && e.style === LINE_STYLE.valley));
    expectRefusal(raw, 'action_element_count');
  });

  it('refuses a line diagram with two action elements', () => {
    const raw = structuredClone(good);
    const valley = raw.diagrams[1].find((e) => e.type === 1 && e.style === LINE_STYLE.valley)!;
    raw.diagrams[1].push(structuredClone(valley));
    expectRefusal(raw, 'action_element_count');
  });

  it('refuses a pinch step drawn as a valley (and vice versa)', () => {
    const raw = structuredClone(good);
    delete raw.steps[0].pinch;
    expectRefusal(raw, 'pinch_style_mismatch');
  });

  it('refuses a solution with fewer diagrams than line steps', () => {
    const raw = structuredClone(good);
    raw.diagrams.pop();
    expectRefusal(raw, 'missing_diagram');
  });

  it('refuses a final crease that is not the solution line', () => {
    const raw = structuredClone(good);
    raw.solution = [0.3, [0, 1]];
    expectRefusal(raw, 'target_mismatch');
  });

  it('refuses an exact solution whose crease misses the queried line', () => {
    // The core says it built y = 0.25 exactly; asking for y = 0.3 and being
    // handed that is a wiring error, not a near miss to display.
    expectRefusal(good, 'target_mismatch', { kind: 'line', a: [0, 0.3], b: [1, 0.3] });
  });

  it('refuses an unknown reference label', () => {
    const raw = structuredClone(good);
    raw.steps[1].l1 = 'Z';
    expectRefusal(raw, 'unknown_reference');
  });

  it('refuses a mark of parallel lines', () => {
    const raw = structuredClone(good);
    raw.steps[1].l0 = 'w';
    raw.steps[1].l1 = 'e';
    expectRefusal(raw, 'degenerate_geometry');
  });

  it('refuses a no-step line that is not an edge or diagonal', () => {
    const raw: RawLineSolution = { ...structuredClone(good), solution: [0.3, [0, 1]], steps: [], diagrams: [[]] };
    expectRefusal(raw, 'unexpected_original');
  });

  it('refuses a solution of the wrong kind for the query', () => {
    expectRefusal(good, 'malformed_solution', { kind: 'point', point: [0.5, 0.25] });
    expectRefusal(fixtures.mark.solutions[0], 'malformed_solution', query);
  });

  it('refuses an axiom outside 0-7', () => {
    const raw = structuredClone(good);
    raw.steps[0].axiom = 9;
    expectRefusal(raw, 'malformed_solution');
  });
});

describe('geometry helpers', () => {
  it('extends a short segment to the sheet chord and clamps overshoot', () => {
    expect(extendToSheet([0.9, 0.5], [1, 0.5], sheet)).toEqual({ a: [0, 0.5], b: [1, 0.5] });
    const diagonal = extendToSheet([0.4, 0.4], [0.5, 0.5], sheet)!;
    expect(diagonal.a).toEqual([0, 0]);
    expect(diagonal.b).toEqual([1, 1]);
    // A chord the core printed with -2.8e-17 overshoot is clamped onto the sheet.
    const clamped = extendToSheet([1, 1], [0.625, -2.77555756156289e-17], sheet)!;
    expect(clamped.b[1]).toBe(0);
    expect(clamped.b[0]).toBeCloseTo(0.625, 12);
  });

  it('refuses a degenerate or off-sheet segment', () => {
    expect(extendToSheet([0.5, 0.5], [0.5, 0.5], sheet)).toBeNull();
    expect(extendToSheet([2, 0], [2, 1], sheet)).toBeNull();
    // y = x - 2 runs below the sheet for every x in it.
    expect(extendToSheet([2, 0], [3, 1], sheet)).toBeNull();
  });

  it('honours a rectangular sheet', () => {
    expect(extendToSheet([1, 0.25], [1.1, 0.25], { width: 2, height: 0.5 })).toEqual({
      a: [0, 0.25],
      b: [2, 0.25],
    });
  });

  it('intersects two lines and reports parallels as null', () => {
    const p = intersectSegments({ a: [0, 0], b: [1, 1] }, { a: [0, 1], b: [1, 0] })!;
    expect(p[0]).toBeCloseTo(0.5, 12);
    expect(p[1]).toBeCloseTo(0.5, 12);
    expect(intersectSegments({ a: [0, 0], b: [1, 0] }, { a: [0, 1], b: [1, 1] })).toBeNull();
  });
});
