import { describe, expect, it } from 'vitest';
import i18n from '../../../i18n';
import type { FoldPointPick } from '../../canvas/foldPicking';
import {
  extentClicks,
  FOLD_EXTENT_MODES,
  foldExtentState,
  foldExtentSteps,
  isFoldExtentMode,
  nextExtentMode,
} from './precreaseExtent';

const t = i18n.t.bind(i18n);

const point = (sheet: [number, number], mark: string | null = null): FoldPointPick => ({
  kind: 'point',
  provenance: mark ? 'mark' : 'crossing',
  sheet,
  mark,
  scene: { x: sheet[0], y: sheet[1] },
});

describe('a precrease’s extent', () => {
  it('lists the whole line first, and steps round the three', () => {
    expect(FOLD_EXTENT_MODES).toEqual(['whole', 'segment', 'pinch']);
    expect(nextExtentMode('whole')).toBe('segment');
    expect(nextExtentMode('segment')).toBe('pinch');
    expect(nextExtentMode('pinch')).toBe('whole');
    expect(isFoldExtentMode('pinch')).toBe(true);
    expect(isFoldExtentMode('arc')).toBe(false);
  });

  it('takes no point for the whole line, two for a segment and one for a pinch', () => {
    expect(extentClicks('whole')).toBe(0);
    expect(extentClicks('segment')).toBe(2);
    expect(extentClicks('pinch')).toBe(1);
    expect(foldExtentSteps(t, 'whole')).toEqual([]);
    expect(foldExtentSteps(t, 'segment')).toHaveLength(2);
    expect(foldExtentSteps(t, 'pinch')).toEqual(['Click where to pinch along the line.']);
  });

  it('is the whole line, incomplete, waiting on the pinch length, or the extent a step stores', () => {
    expect(foldExtentState('whole', [], null)).toEqual({ status: 'whole' });
    expect(foldExtentState('segment', [point([0.5, 0])], null)).toEqual({
      status: 'incomplete',
      mode: 'segment',
      picked: 1,
      needed: 2,
    });
    // A segment needs no length; its ends are point inputs, a Divide-line mark's with its id.
    expect(foldExtentState('segment', [point([0.5, 0]), point([0.5, 0.25], 'fmark-1')], null)).toEqual({
      status: 'ready',
      extent: {
        kind: 'segment',
        from: { kind: 'point', at: [0.5, 0] },
        to: { kind: 'mark', at: [0.5, 0.25], mark: 'fmark-1' },
      },
    });
    // A pinch waits for the engine's length, and stores the one it is given.
    expect(foldExtentState('pinch', [point([0.75, 0.25])], null)).toEqual({ status: 'length' });
    expect(foldExtentState('pinch', [point([0.75, 0.25])], 0.0625)).toEqual({
      status: 'ready',
      extent: { kind: 'pinch', at: { kind: 'point', at: [0.75, 0.25] }, length: 0.0625 },
    });
  });
});
