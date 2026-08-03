import { describe, expect, it } from 'vitest';
import { candidatePreviewGroups } from './candidatePreviewGroups';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
import type { Rgba } from '../renderer/types';
import type { ToolPreviewSegment } from '../tools/types';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];
const ANCHOR: Rgba = [1, 0, 1, 1];
const TOOL: Rgba = [0.5, 0.5, 0.5, 1];

const appearanceFor = (color: string) => ({
  color: color === 'Red1' ? RED : BLUE,
  dashSlot: 0,
});

function segment(index: number, crease?: ToolPreviewSegment['crease']): ToolPreviewSegment {
  return { a: { x: 0, y: 0 }, b: { x: index + 1, y: 0 }, ...(crease ? { crease } : {}) };
}

describe('candidatePreviewGroups', () => {
  it('leaves the common path as one group in the tool colour', () => {
    const groups = candidatePreviewGroups(
      [segment(0), segment(1)],
      TOOL,
      appearanceFor,
      ANCHOR
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].color).toEqual(TOOL);
    expect(groups[0].segments).toHaveLength(2);
  });

  it('has nothing to draw for no candidates', () => {
    expect(candidatePreviewGroups([], TOOL, appearanceFor, ANCHOR)).toEqual([]);
  });

  it('strokes a candidate in the crease it would commit', () => {
    const groups = candidatePreviewGroups(
      [segment(0, { color: 'Red1' })],
      TOOL,
      appearanceFor,
      ANCHOR
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].color).toEqual(RED);
  });

  it('ramps a partial fold angle toward the anchor, as the document does', () => {
    const half = 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE;
    const groups = candidatePreviewGroups(
      [segment(0, { color: 'Red1', foldMagnitude: half })],
      TOOL,
      appearanceFor,
      ANCHOR
    );
    // Halfway between the ink and the anchor: the green channel is untouched by
    // both, and the blue channel is what moves.
    expect(groups[0].color[2]).toBeCloseTo(0.5, 6);
    expect(groups[0].color).not.toEqual(RED);
  });

  it('separates candidates that would commit different creases', () => {
    const groups = candidatePreviewGroups(
      [segment(0, { color: 'Red1' }), segment(1, { color: 'Blue2' }), segment(2, { color: 'Red1' })],
      TOOL,
      appearanceFor,
      ANCHOR
    );
    expect(groups).toHaveLength(2);
    const red = groups.find((group) => group.color === RED || group.color[0] === 1);
    expect(red?.segments).toHaveLength(2);
  });

  it('keeps a plain candidate in the tool colour when it sits beside solved ones', () => {
    const groups = candidatePreviewGroups(
      [segment(0, { color: 'Red1' }), segment(1)],
      TOOL,
      appearanceFor,
      ANCHOR
    );
    expect(groups.map((group) => group.color)).toContainEqual(TOOL);
  });
});

describe('candidatePreviewGroups arming', () => {
  it('dashes the proposals and leaves the armed one solid', () => {
    const groups = candidatePreviewGroups(
      [segment(0, { color: 'Red1' }), segment(1, { color: 'Red1' })],
      TOOL,
      appearanceFor,
      ANCHOR,
      1
    );
    // Same colour, so without the armed split these would be one group.
    expect(groups).toHaveLength(2);
    const armed = groups.find((group) => group.dashed === false);
    expect(armed?.segments).toHaveLength(1);
    expect(armed?.segments[0].b.x).toBe(2);
    expect(groups.filter((group) => group.dashed).flatMap((g) => g.segments)).toHaveLength(1);
  });

  it('dashes everything when nothing is armed', () => {
    const groups = candidatePreviewGroups(
      [segment(0, { color: 'Red1' }), segment(1, { color: 'Blue2' })],
      TOOL,
      appearanceFor,
      ANCHOR,
      null
    );
    expect(groups.every((group) => group.dashed)).toBe(true);
  });

  it('leaves other tools alone: one group, no dash opinion', () => {
    // Arming is the completion tool's affordance; every other tool passes no
    // index and must keep the single undashed group it had before.
    const groups = candidatePreviewGroups([segment(0), segment(1)], TOOL, appearanceFor, ANCHOR);
    expect(groups).toHaveLength(1);
    expect(groups[0].dashed).toBeUndefined();
  });
});
