import { describe, expect, it, vi } from 'vitest';
import { cpSnapshotToScene } from './cpSnapshotToScene';
import type { Rgba } from '../renderer/types';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

describe('cpSnapshotToScene', () => {
  it('packs endpoints and per-segment colours', () => {
    const segments = [
      { a: { x: 0, y: 0 }, b: { x: 10, y: 20 }, color: 'Red1' },
      { a: { x: 5, y: 6 }, b: { x: 7, y: 8 }, color: 'Blue2' },
    ];
    const scene = cpSnapshotToScene(segments, (c) => (c === 'Red1' ? RED : BLUE));
    expect(scene.strokes.count).toBe(2);
    expect(Array.from(scene.strokes.a)).toEqual([0, 0, 5, 6]);
    expect(Array.from(scene.strokes.b)).toEqual([10, 20, 7, 8]);
    expect(Array.from(scene.strokes.color)).toEqual([1, 0, 0, 1, 0, 0, 1, 1]);
  });

  it('memoises colour resolution per distinct assignment', () => {
    const colorFor = vi.fn((): Rgba => RED);
    const segments = Array.from({ length: 5 }, () => ({
      a: { x: 0, y: 0 },
      b: { x: 1, y: 1 },
      color: 'Red1',
    }));
    cpSnapshotToScene(segments, colorFor);
    expect(colorFor).toHaveBeenCalledTimes(1);
  });

  it('handles an empty document', () => {
    const scene = cpSnapshotToScene([], () => RED);
    expect(scene.strokes.count).toBe(0);
    expect(scene.strokes.a).toHaveLength(0);
  });
});
