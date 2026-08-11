import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
import {
  documentLineIdForKernelLine,
  documentLineIdsForKernelLines,
  kernelLineOrder,
  resolveFoldRoute,
} from './foldRoute';

function segment(
  color: OristudioCpLineSegment['color'],
  foldMagnitude?: number
): OristudioCpLineSegment {
  return {
    a: { x: 0, y: 0 },
    b: { x: 1, y: 0 },
    color,
    selected: false,
    ...(foldMagnitude === undefined ? {} : { fold_magnitude: foldMagnitude }),
  } as unknown as OristudioCpLineSegment;
}

const CLASSIC = segment('Red1');
const SPATIAL = segment('Red1', 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE);
const AUX = segment('Cyan3');

function document(...segments: OristudioCpLineSegment[]): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: { line_segments: segments },
  } as unknown as OristudioCpDocumentSnapshot;
}

describe('resolveFoldRoute', () => {
  it('routes an all-classic selection of an all-classic document flat', () => {
    // Row (a).
    expect(resolveFoldRoute(document(CLASSIC, CLASSIC), [1, 2])).toEqual({
      kind: 'flat',
      lineIds: [1, 2],
    });
  });

  it('routes an all-classic selection flat even when the document is not', () => {
    // Row (b), the one a document-wide predicate gets wrong. The arrangement is
    // built only from the scoped segments, so segment 3 is not in it.
    expect(resolveFoldRoute(document(CLASSIC, CLASSIC, SPATIAL), [1, 2])).toEqual({
      kind: 'flat',
      lineIds: [1, 2],
    });
  });

  it('routes an all-non-classic selection spatial', () => {
    // Row (c).
    expect(resolveFoldRoute(document(SPATIAL, SPATIAL), [1, 2])).toEqual({
      kind: 'spatial',
      lineIds: [1, 2],
      nonClassicCount: 2,
    });
  });

  it('routes a mixed selection spatial', () => {
    // Row (d). The classic creases are ±180 within the same placement walk — a
    // box with flat-folded flaps is an ordinary design.
    expect(resolveFoldRoute(document(CLASSIC, SPATIAL, CLASSIC), [1, 2, 3])).toEqual({
      kind: 'spatial',
      lineIds: [1, 2, 3],
      nonClassicCount: 1,
    });
  });

  it('routes nothing when no scoped line is foldable', () => {
    // Row (e), reached through the colour filter rather than an empty selection.
    expect(resolveFoldRoute(document(AUX, AUX), [1, 2])).toEqual({ kind: 'none' });
    expect(resolveFoldRoute(document(CLASSIC), [])).toEqual({ kind: 'none' });
    expect(resolveFoldRoute(null, [1])).toEqual({ kind: 'none' });
  });

  it('drops aux-coloured lines from the ids it hands the kernel', () => {
    // `selected_folding_segments` applies exactly this colour filter, so a route
    // that kept them would hand the kernel ids it will not resolve.
    expect(resolveFoldRoute(document(AUX, SPATIAL, AUX), [1, 2, 3])).toEqual({
      kind: 'spatial',
      lineIds: [2],
      nonClassicCount: 1,
    });
  });

  it('routes a black crease carrying a fold angle spatial', () => {
    // The kernel's `is_classic_crease` reads `fold_magnitude` and nothing else.
    // The predicate used to also require a folding colour, and the two disagree
    // on exactly this input — which survives an `.osf` and a share link, both of
    // which copy the magnitude without consulting the colour.
    const blackWithAngle = segment('Black0', 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE);
    expect(resolveFoldRoute(document(blackWithAngle), [1])).toEqual({
      kind: 'spatial',
      lineIds: [1],
      nonClassicCount: 1,
    });
  });

  it('treats an absent magnitude as classic, not as zero', () => {
    // A crease with no recorded angle is a full fold, which is what every file
    // format that carries no magnitude means by a mountain or valley.
    expect(resolveFoldRoute(document(segment('Blue2')), [1]).kind).toBe('flat');
    // Zero is a real angle and an unfolded one — still not a full fold.
    expect(resolveFoldRoute(document(segment('Blue2', 0)), [1]).kind).toBe('spatial');
  });
});

describe('kernelLineOrder', () => {
  it('sorts and dedupes, because the kernel walks the document not the ids', () => {
    // `foldOristudioCpDocument` takes caller-supplied ids, `setOristudioCpSelection`
    // writes its argument verbatim, and a kernel-returned selection is copied
    // straight out of the document — any of the three can arrive unsorted.
    expect(kernelLineOrder([9, 2, 5, 2])).toEqual([2, 5, 9]);
  });
});

describe('documentLineIdForKernelLine', () => {
  it('names the document line at that position in the kernel slice', () => {
    const order = kernelLineOrder([9, 2, 5]);
    expect(documentLineIdForKernelLine(order, 0)).toBe(2);
    expect(documentLineIdForKernelLine(order, 2)).toBe(9);
  });

  it('answers null rather than some unrelated crease', () => {
    const order = kernelLineOrder([2, 5]);
    expect(documentLineIdForKernelLine(order, 7)).toBeNull();
    expect(documentLineIdForKernelLine(order, -1)).toBeNull();
    expect(documentLineIdForKernelLine(order, null)).toBeNull();
    expect(documentLineIdForKernelLine(order, 1.5)).toBeNull();
  });

  it('maps a list, dropping what it cannot name and keeping each id once', () => {
    const order = kernelLineOrder([9, 2, 5]);
    expect(documentLineIdsForKernelLines(order, [2, 0, 99, 0])).toEqual([9, 2]);
  });
});
