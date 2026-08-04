import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { OristudioCpSelection } from '../../lib/creasePatternViewport';
import { hasFoldableCpSelection } from './useFoldAngleSelection';

function segment(color: string): OristudioCpLineSegment {
  return {
    a: { x: 0, y: 0 },
    b: { x: 1, y: 0 },
    active: 'Inactive0',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  };
}

/** Line ids are 1-based, so index 0 is line 1. */
function document(...colors: string[]): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: { line_segments: colors.map(segment) },
  } as unknown as OristudioCpDocumentSnapshot;
}

function selection(...lines: number[]): OristudioCpSelection {
  return { lines, points: [], circles: [] } as unknown as OristudioCpSelection;
}

describe('hasFoldableCpSelection', () => {
  it('is true for a selected mountain or valley crease', () => {
    expect(hasFoldableCpSelection(document('Red1'), selection(1))).toBe(true);
    expect(hasFoldableCpSelection(document('Blue2'), selection(1))).toBe(true);
  });

  it('is false for a selection of only paper border', () => {
    // The regression this guards: the tool hint window now opens for the resting
    // tool *only* when the fold-angle control has something to offer. Border
    // lines cannot carry a fold angle, so selecting them must not reopen it.
    expect(hasFoldableCpSelection(document('Black0', 'Black0'), selection(1, 2))).toBe(false);
  });

  it('is true when a crease is mixed in with unfoldable lines', () => {
    expect(hasFoldableCpSelection(document('Black0', 'Blue2'), selection(1, 2))).toBe(true);
  });

  it('is false for an empty selection or a missing document', () => {
    expect(hasFoldableCpSelection(document('Red1'), selection())).toBe(false);
    expect(hasFoldableCpSelection(null, selection(1))).toBe(false);
  });

  it('ignores selected ids with no line behind them', () => {
    expect(hasFoldableCpSelection(document('Red1'), selection(9))).toBe(false);
  });
});
