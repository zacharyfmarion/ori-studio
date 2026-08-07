import { describe, expect, it } from 'vitest';
import type {
  OristudioBpFlap,
  OristudioBpSheet,
  OristudioBpSheetKind,
} from '../engine/oristudioBpTypes';
import {
  BP_MAX_SHEET_SIZE,
  bpCanSubdivideSheet,
  bpCanUnsubdivideSheet,
  bpSteppedSheetSize,
} from './bpSheetSize';

function sheet(kind: OristudioBpSheetKind, width: number, height = width): OristudioBpSheet {
  return {
    kind,
    width,
    height,
    grid: { kind, interval: 1, snap: true },
  };
}

function flap(x: number, y: number, width = 0, height = 0): OristudioBpFlap {
  return {
    id: 1,
    vertexId: 1,
    name: 'a',
    anchor: { x, y },
    width,
    height,
    radius: 1,
    constrained: false,
  };
}

describe('bpSteppedSheetSize', () => {
  it('adds one unit to each dimension', () => {
    expect(bpSteppedSheetSize(sheet('rectangular', 8, 12), [flap(1, 1, 2, 2)], true)).toEqual({
      width: 9,
      height: 13,
    });
  });

  it('removes one unit from each dimension', () => {
    expect(bpSteppedSheetSize(sheet('rectangular', 8, 12), [flap(1, 1, 2, 2)], false)).toEqual({
      width: 7,
      height: 11,
    });
  });

  it('refuses to grow past the engine maximum', () => {
    expect(bpSteppedSheetSize(sheet('rectangular', BP_MAX_SHEET_SIZE - 1), [], true)).toEqual({
      width: BP_MAX_SHEET_SIZE,
      height: BP_MAX_SHEET_SIZE,
    });
    expect(bpSteppedSheetSize(sheet('rectangular', BP_MAX_SHEET_SIZE), [], true)).toBeNull();
  });

  it('refuses to shrink below the engine minimum for the grid kind', () => {
    expect(bpSteppedSheetSize(sheet('rectangular', 5), [], false)).toEqual({
      width: 4,
      height: 4,
    });
    expect(bpSteppedSheetSize(sheet('rectangular', 4), [], false)).toBeNull();
    expect(bpSteppedSheetSize(sheet('diagonal', 7), [], false)).toEqual({ width: 6, height: 6 });
    expect(bpSteppedSheetSize(sheet('diagonal', 6), [], false)).toBeNull();
  });

  it('refuses a step only one dimension could take, rather than going lopsided', () => {
    // The height is already at the minimum, so the width does not shrink alone.
    expect(bpSteppedSheetSize(sheet('rectangular', 10, 4), [], false)).toBeNull();
  });

  it('refuses to shrink when a flap spans the whole sheet', () => {
    expect(bpSteppedSheetSize(sheet('rectangular', 8), [flap(0, 1, 8, 2)], false)).toBeNull();
    // The same flap turned upright fails on the height instead.
    expect(bpSteppedSheetSize(sheet('rectangular', 8), [flap(1, 0, 2, 8)], false)).toBeNull();
  });

  it('shrinks when the flaps only need shifting back onto the smaller sheet', () => {
    // Flush against the far edge, but one unit narrower than the new sheet.
    expect(bpSteppedSheetSize(sheet('rectangular', 8), [flap(1, 1, 7, 7)], false)).toEqual({
      width: 7,
      height: 7,
    });
  });

  it('never blocks growing, however the flaps sit', () => {
    expect(bpSteppedSheetSize(sheet('rectangular', 8), [flap(0, 0, 8, 8)], true)).toEqual({
      width: 9,
      height: 9,
    });
  });

  it('measures a diagonal sheet along its diagonals', () => {
    // A diamond of size 7 admits a 7-unit span along each diagonal...
    expect(bpSteppedSheetSize(sheet('diagonal', 8), [flap(0, 0, 3.5, 3.5)], false)).toEqual({
      width: 7,
      height: 7,
    });
    // ...but not an 8-unit one, even though it is only 4 units wide in x.
    expect(bpSteppedSheetSize(sheet('diagonal', 8), [flap(0, 0, 4, 4)], false)).toBeNull();
  });
});

describe('bpCanSubdivideSheet', () => {
  it('is limited only by the size ceiling', () => {
    expect(bpCanSubdivideSheet(sheet('rectangular', 16))).toBe(true);
    expect(bpCanSubdivideSheet(sheet('rectangular', BP_MAX_SHEET_SIZE / 2))).toBe(true);
    expect(bpCanSubdivideSheet(sheet('rectangular', BP_MAX_SHEET_SIZE / 2 + 1))).toBe(false);
  });

  it('refuses when only one dimension would clear the ceiling', () => {
    expect(bpCanSubdivideSheet(sheet('rectangular', 16, BP_MAX_SHEET_SIZE))).toBe(false);
  });
});

describe('bpCanUnsubdivideSheet', () => {
  it('halves when the dimensions and every flap dot are even', () => {
    expect(bpCanUnsubdivideSheet(sheet('rectangular', 16), [flap(4, 8)])).toBe(true);
  });

  it('refuses a dot the coarser grid could not represent', () => {
    // A flap on an odd line would land between grid lines after halving, which
    // is why the engine silently declines rather than moving it.
    expect(bpCanUnsubdivideSheet(sheet('rectangular', 16), [flap(5, 8)])).toBe(false);
    // Its far corner counts too, not just its anchor.
    expect(bpCanUnsubdivideSheet(sheet('rectangular', 16), [flap(4, 8, 3, 2)])).toBe(false);
  });

  it('refuses dimensions that do not halve cleanly or would go under the minimum', () => {
    expect(bpCanUnsubdivideSheet(sheet('rectangular', 15), [])).toBe(false);
    expect(bpCanUnsubdivideSheet(sheet('rectangular', 6), [])).toBe(false);
    expect(bpCanUnsubdivideSheet(sheet('rectangular', 8), [])).toBe(true);
  });

  it('checks only the one size a diagonal sheet has', () => {
    expect(bpCanUnsubdivideSheet(sheet('diagonal', 16), [flap(4, 8)])).toBe(true);
    expect(bpCanUnsubdivideSheet(sheet('diagonal', 10), [])).toBe(false);
  });
});
