import { describe, expect, it } from 'vitest';
import markFixture from './referenceFinder/__fixtures__/mark.json';
import lineFixture from './referenceFinder/__fixtures__/line-exact.json';
import { extractSolution } from './referenceFinder/extractor';
import type { ReferenceFinderReplayFixture } from './referenceFinder/replayClient';
import type { Diagram } from './referenceFinder/solution';
import {
  candidateDiagram,
  referenceFinderDiagramToPrimitives,
  StepDiagramAdapterError,
  stepDiagram,
} from './referenceFinderDiagramToPrimitives';

const mark = markFixture as unknown as ReferenceFinderReplayFixture;
const line = lineFixture as unknown as ReferenceFinderReplayFixture;
const sheet = { width: mark.database.width, height: mark.database.height };

describe('referenceFinderDiagramToPrimitives', () => {
  it('maps every element type and style of a captured diagram', () => {
    const model = referenceFinderDiagramToPrimitives(mark.solutions[0].diagrams[0]);
    expect(model.sheet).toEqual({ width: 1, height: 1 });
    expect(model.primitives[0]).toEqual({ kind: 'sheet', width: 1, height: 1 });
    const kinds = new Set(model.primitives.map((p) => p.kind));
    expect(kinds).toEqual(new Set(['sheet', 'line', 'point', 'arc', 'label']));
    // The pinch element the extractor reads as the new crease keeps its name.
    expect(model.primitives).toContainEqual({
      kind: 'line',
      from: [0, 0.5],
      to: [0.1, 0.5],
      style: 'pinch',
    });
    // Points and labels share the three-value style enum.
    expect(model.primitives).toContainEqual({ kind: 'point', at: [1, 1], style: 'highlight' });
    expect(model.primitives).toContainEqual({ kind: 'point', at: [0, 0.5], style: 'action' });
    expect(model.primitives).toContainEqual({
      kind: 'label',
      at: [0, 0.5],
      text: 'P',
      style: 'action',
    });
  });

  it('reads the arrow arc with its 0/1 flag as a boolean', () => {
    const model = referenceFinderDiagramToPrimitives(mark.solutions[0].diagrams[0]);
    const arc = model.primitives.find((p) => p.kind === 'arc');
    expect(arc).toMatchObject({ kind: 'arc', style: 'arrow', ccw: false, radius: 1 });
  });

  it('names every line style by its code', () => {
    const styles = [0, 1, 2, 3, 4, 5, 6, 7].map((style) => {
      const diagram = [
        { type: 3, width: 1, height: 1 },
        { type: 1, from: [0, 0], to: [1, 1], style },
      ] as unknown as Diagram;
      const [, primitive] = referenceFinderDiagramToPrimitives(diagram).primitives;
      return primitive.kind === 'line' ? primitive.style : null;
    });
    expect(styles).toEqual([
      'crease',
      'edge',
      'highlight',
      'valley',
      'mountain',
      'arrow',
      'dotted',
      'pinch',
    ]);
  });

  it('refuses a diagram that does not start with its sheet', () => {
    const diagram = [{ type: 1, from: [0, 0], to: [1, 1], style: 0 }] as unknown as Diagram;
    expect(() => referenceFinderDiagramToPrimitives(diagram)).toThrow(StepDiagramAdapterError);
    expect(() => referenceFinderDiagramToPrimitives([] as Diagram)).toThrow(
      expect.objectContaining({ reason: 'missing_sheet' })
    );
  });

  it('refuses unknown element types and style codes rather than drawing a guess', () => {
    const unknownType = [
      { type: 3, width: 1, height: 1 },
      { type: 9, pt: [0, 0] },
    ] as unknown as Diagram;
    expect(() => referenceFinderDiagramToPrimitives(unknownType)).toThrow(
      expect.objectContaining({ reason: 'unknown_element' })
    );
    const unknownStyle = [
      { type: 3, width: 1, height: 1 },
      { type: 1, from: [0, 0], to: [1, 1], style: 8 },
    ] as unknown as Diagram;
    expect(() => referenceFinderDiagramToPrimitives(unknownStyle)).toThrow(
      expect.objectContaining({ reason: 'unknown_line_style' })
    );
    const badPoint = [
      { type: 3, width: 1, height: 1 },
      { type: 0, pt: [0], style: 0 },
    ] as unknown as Diagram;
    expect(() => referenceFinderDiagramToPrimitives(badPoint)).toThrow(
      expect.objectContaining({ reason: 'malformed_element' })
    );
  });
});

describe('stepDiagram / candidateDiagram', () => {
  const raw = mark.solutions[0];
  const solution = extractSolution(raw, mark.query, sheet);

  it('gives a line step its own diagram', () => {
    expect(solution.steps[0].diagramIndex).toBe(0);
    expect(stepDiagram(raw, solution, 0)).toBe(raw.diagrams[0]);
    expect(stepDiagram(raw, solution, 2)).toBe(raw.diagrams[1]);
  });

  it("lends a mark step the next line step's diagram, and the trailing one to the final mark", () => {
    // Steps: A (line), P (mark), B (line), Q (final mark).
    expect(stepDiagram(raw, solution, 1)).toBe(raw.diagrams[1]);
    expect(stepDiagram(raw, solution, 3)).toBe(raw.diagrams[2]);
    expect(raw.diagrams).toHaveLength(3);
  });

  it('is null past the last step', () => {
    expect(stepDiagram(raw, solution, 4)).toBeNull();
  });

  it("uses the trailing mark diagram for a point query's card and the last line diagram for a line's", () => {
    expect(candidateDiagram(raw, solution)).toBe(raw.diagrams[2]);
    const lineRaw = line.solutions[0];
    const lineSolution = extractSolution(lineRaw, line.query, {
      width: line.database.width,
      height: line.database.height,
    });
    const lines = lineSolution.steps.filter((s) => s.diagramIndex !== null).length;
    expect(lines).toBeGreaterThan(0);
    expect(candidateDiagram(lineRaw, lineSolution)).toBe(lineRaw.diagrams[lines - 1]);
  });
});
