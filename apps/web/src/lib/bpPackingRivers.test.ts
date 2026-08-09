import { describe, expect, it } from 'vitest';
import type { OristudioBpRiver } from '../engine/oristudioBpTypes';
import { bpRiverIdFromGraphicsId } from './bpPackingRivers';

const rivers: OristudioBpRiver[] = [
  { id: 7, edgeId: 7, vertices: [3, 4], width: 2 },
  { id: 9, edgeId: 9, vertices: [4, 12], width: 1 },
];

describe('bpRiverIdFromGraphicsId', () => {
  it('resolves a river from its contour and ridge ids', () => {
    expect(bpRiverIdFromGraphicsId('re3,4:contour:0', rivers)).toBe(7);
    expect(bpRiverIdFromGraphicsId('re3,4:contour:0:inner:1', rivers)).toBe(7);
    expect(bpRiverIdFromGraphicsId('re3,4:ridge:2', rivers)).toBe(7);
    expect(bpRiverIdFromGraphicsId('re4,12:contour:0', rivers)).toBe(9);
  });

  it('matches the vertex pair either way round', () => {
    expect(bpRiverIdFromGraphicsId('re4,3:contour:0', rivers)).toBe(7);
  });

  it('accepts the bare node id', () => {
    expect(bpRiverIdFromGraphicsId('re3,4', rivers)).toBe(7);
  });

  it('rejects flaps, devices, and unknown pairs', () => {
    expect(bpRiverIdFromGraphicsId('f2:contour:0', rivers)).toBeNull();
    expect(bpRiverIdFromGraphicsId('s3,4.0:contour:0', rivers)).toBeNull();
    expect(bpRiverIdFromGraphicsId('re5,6:contour:0', rivers)).toBeNull();
    expect(bpRiverIdFromGraphicsId('', rivers)).toBeNull();
  });

  it('does not match a longer vertex id that merely starts the same', () => {
    expect(bpRiverIdFromGraphicsId('re34,4:contour:0', rivers)).toBeNull();
  });
});
