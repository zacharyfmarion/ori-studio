import { describe, expect, it } from 'vitest';
import {
  clampLength,
  createQuantizeState,
  CONTINUOUS_LENGTHS,
  nudgeLength,
  SNAPPED_LENGTHS,
  SNAP_HYSTERESIS,
  snapToInteger,
} from './lengths';
import type { EditableTreeEdge } from './model';

const edge = (overrides: Partial<EditableTreeEdge> = {}): EditableTreeEdge => ({
  id: 1,
  vertices: [0, 1],
  length: 1,
  isLeafEdge: true,
  maxLength: null,
  ...overrides,
});

describe('length rules', () => {
  it('keeps box-pleat lengths whole and at least one', () => {
    expect(clampLength(SNAPPED_LENGTHS, edge(), 0)).toBe(1);
    expect(clampLength(SNAPPED_LENGTHS, edge(), -4)).toBe(1);
    expect(SNAPPED_LENGTHS.quantize(2.6)).toBe(3);
    expect(SNAPPED_LENGTHS.step).toBe(1);
  });

  it('lets a search surface hold a length no grid could express', () => {
    expect(clampLength(CONTINUOUS_LENGTHS, edge(), 1.37)).toBe(1.37);
    expect(CONTINUOUS_LENGTHS.quantize(2.6)).toBe(2.6);
    expect(CONTINUOUS_LENGTHS.step).toBeNull();
  });

  it('applies the ceiling without ever needing to show it', () => {
    expect(clampLength(SNAPPED_LENGTHS, edge({ maxLength: 4 }), 9)).toBe(4);
    // A rule with no ceiling means unbounded, not zero — the difference between
    // `null` and a falsy number, and the bug it would be.
    expect(clampLength(CONTINUOUS_LENGTHS, edge({ maxLength: 4 }), 9)).toBe(9);
  });

  it('nudges by a ratio when there is no step to take', () => {
    expect(nudgeLength(SNAPPED_LENGTHS, 3.4, 1)).toBe(4);
    expect(nudgeLength(SNAPPED_LENGTHS, 3.4, -1)).toBe(2);
    expect(nudgeLength(CONTINUOUS_LENGTHS, 2, 1)).toBeCloseTo(2.2, 10);
    expect(nudgeLength(CONTINUOUS_LENGTHS, 2, -1)).toBeCloseTo(1.818, 3);
  });
});

describe('snap hysteresis', () => {
  it('holds the current length until the cursor clears the deadband', () => {
    const state = createQuantizeState();
    expect(snapToInteger(1.0, state)).toBe(1);
    // Past the midpoint but inside the deadband: still 1.
    expect(snapToInteger(1.5 + SNAP_HYSTERESIS / 2, state)).toBe(1);
    expect(snapToInteger(1.5 + SNAP_HYSTERESIS * 2, state)).toBe(2);
    // And symmetric on the way back down.
    expect(snapToInteger(1.5 - SNAP_HYSTERESIS / 2, state)).toBe(2);
    expect(snapToInteger(1.5 - SNAP_HYSTERESIS * 2, state)).toBe(1);
  });

  it('flips once per crossing rather than once per sample', () => {
    const state = createQuantizeState();
    snapToInteger(1, state);
    let flips = 0;
    let previous = 1;
    // A hand hovering on the boundary: without hysteresis this alternates on
    // every sample, which is the flicker the deadband exists to stop.
    for (const distance of [1.49, 1.51, 1.49, 1.52, 1.48, 1.5]) {
      const answer = snapToInteger(distance, state);
      if (answer !== previous) flips += 1;
      previous = answer;
    }
    expect(flips).toBe(0);
  });

  it('jumps straight to a distant length rather than walking there', () => {
    const state = createQuantizeState();
    snapToInteger(1, state);
    expect(snapToInteger(7.2, state)).toBe(7);
  });

  it('is a plain round with no state to remember', () => {
    expect(snapToInteger(1.51)).toBe(2);
    expect(snapToInteger(1.49)).toBe(1);
  });
});
