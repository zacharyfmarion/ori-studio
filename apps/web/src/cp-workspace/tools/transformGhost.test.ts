import { describe, expect, it } from 'vitest';
import { translationMatrix } from '../adapters/cpSnapshotToScene';
import type { Rgba } from '../renderer/types';
import {
  createTransformGhost,
  ghostBaseFromSegments,
  type CpGhostStyle,
} from './transformGhost';

const RED: Rgba = [1, 0, 0, 1];
const STYLE: CpGhostStyle = { alpha: 0.5, widthMul: 2 };

const segments = [
  { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, color: 'Red1' },
  { a: { x: 0, y: 5 }, b: { x: 0, y: 15 }, color: 'Blue2' },
  { a: { x: 20, y: 20 }, b: { x: 30, y: 30 }, color: 'Red1' },
];

describe('ghostBaseFromSegments', () => {
  it('snapshots only the selected creases, compacted', () => {
    const base = ghostBaseFromSegments(segments, new Set([1, 3]), () => RED, STYLE);
    expect(base.count).toBe(2);
    expect(Array.from(base.a)).toEqual([0, 0, 20, 20]);
    expect(Array.from(base.b)).toEqual([10, 0, 30, 30]);
  });

  it('scales each segment alpha by the ghost style, keeping its own colour', () => {
    const base = ghostBaseFromSegments(segments, new Set([1]), () => RED, STYLE);
    expect(Array.from(base.color)).toEqual([1, 0, 0, 0.5]);
  });

  it('is empty for an empty selection', () => {
    expect(ghostBaseFromSegments(segments, new Set(), () => RED, STYLE).count).toBe(0);
  });
});

describe('createTransformGhost', () => {
  it('is null when there is nothing selected to ghost', () => {
    const base = ghostBaseFromSegments(segments, new Set(), () => RED, STYLE);
    expect(createTransformGhost(base, STYLE)).toBeNull();
  });

  it('transforms the snapshot without mutating it', () => {
    const base = ghostBaseFromSegments(segments, new Set([1]), () => RED, STYLE);
    const ghost = createTransformGhost(base, STYLE);
    const strokes = ghost?.update(translationMatrix({ x: 3, y: -4 }));
    expect(Array.from(strokes!.a)).toEqual([3, -4]);
    expect(Array.from(strokes!.b)).toEqual([13, -4]);
    // The source snapshot is still the original geometry, so the next move
    // transforms from the same base rather than compounding.
    expect(Array.from(base.a)).toEqual([0, 0]);
  });

  it('does not compound across successive updates', () => {
    const base = ghostBaseFromSegments(segments, new Set([1]), () => RED, STYLE);
    const ghost = createTransformGhost(base, STYLE);
    ghost?.update(translationMatrix({ x: 3, y: -4 }));
    const strokes = ghost?.update(translationMatrix({ x: 1, y: 1 }));
    expect(Array.from(strokes!.a)).toEqual([1, 1]);
  });

  it('applies rotation and scale, not just translation', () => {
    const base = ghostBaseFromSegments(segments, new Set([1]), () => RED, STYLE);
    const ghost = createTransformGhost(base, STYLE);
    // Quarter turn about the origin, doubled.
    const strokes = ghost?.update([0, -2, 2, 0, 0, 0]);
    expect(Array.from(strokes!.a)).toEqual([0, 0]);
    expect(Array.from(strokes!.b)).toEqual([0, 20]);
  });

  it('carries the style width and reuses one buffer object', () => {
    const base = ghostBaseFromSegments(segments, new Set([1, 3]), () => RED, STYLE);
    const ghost = createTransformGhost(base, STYLE);
    const first = ghost?.update(translationMatrix({ x: 0, y: 0 }));
    const second = ghost?.update(translationMatrix({ x: 1, y: 0 }));
    expect(first).toBe(second);
    expect(Array.from(first!.widthMul)).toEqual([2, 2]);
    expect(first!.count).toBe(2);
  });
});
