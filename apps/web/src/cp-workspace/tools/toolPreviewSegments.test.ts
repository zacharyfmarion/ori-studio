import { describe, expect, it } from 'vitest';
import { toolPreviewSegments } from './toolPreviewSegments';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';

function segment(color: string, foldMagnitude?: number): OristudioCpLineSegment {
  return {
    a: { x: 0, y: 0 },
    b: { x: 10, y: 0 },
    color,
    active: 'Inactive0',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...(foldMagnitude === undefined ? {} : { fold_magnitude: foldMagnitude }),
  };
}

describe('toolPreviewSegments', () => {
  it('keeps geometry only, for a tool that draws in the active line type', () => {
    const [only] = toolPreviewSegments([segment('Red1')], 'DrawCreaseFree');
    expect(only).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    expect(only.crease).toBeUndefined();
  });

  it('carries the crease for a tool whose candidates the kernel decided', () => {
    const [only] = toolPreviewSegments([segment('Red1', 900000000)], 'VertexMakeAngularlyFlatFoldable');
    expect(only.crease).toEqual({ color: 'Red1', foldMagnitude: 900000000 });
  });

  it('carries a classic crease as a crease with no magnitude', () => {
    const [only] = toolPreviewSegments([segment('Blue2')], 'VertexMakeAngularlyFlatFoldable');
    expect(only.crease).toEqual({ color: 'Blue2', foldMagnitude: undefined });
  });

  it('leaves indicator geometry alone even on a crease-carrying tool', () => {
    // A preview also carries things drawn *about* the pattern — fan rays, circle
    // rings, the port's `Purple8` candidate indicators. Stroking those in a
    // crease colour would claim they are creases.
    const previews = toolPreviewSegments(
      [segment('Orange4'), segment('Green6'), segment('Purple8'), segment('Cyan3')],
      'VertexMakeAngularlyFlatFoldable'
    );
    expect(previews.every((preview) => preview.crease === undefined)).toBe(true);
  });

  it('handles an absent preview and an unknown tool', () => {
    expect(toolPreviewSegments(undefined, 'VertexMakeAngularlyFlatFoldable')).toEqual([]);
    expect(toolPreviewSegments([segment('Red1')], undefined)[0].crease).toBeUndefined();
  });

  it('never mutates the kernel segments it is given', () => {
    const source = segment('Red1', 900000000);
    const before = JSON.stringify(source);
    toolPreviewSegments([source], 'VertexMakeAngularlyFlatFoldable');
    expect(JSON.stringify(source)).toBe(before);
  });
});
