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
