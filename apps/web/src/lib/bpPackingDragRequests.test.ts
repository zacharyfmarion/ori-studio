import { describe, expect, it } from 'vitest';
import {
  sameBpDeviceUpdate,
  sameBpDragUpdate,
  type BpPackingDeviceBackendUpdate,
  type BpPackingDragBackendUpdate,
} from './bpPackingDragRequests';

const flapAt = (x: number, y: number, ids = [7]): BpPackingDragBackendUpdate => ({
  ids,
  loc: { x, y },
});
const deviceAt = (x: number, y: number, index = 0): BpPackingDeviceBackendUpdate => ({
  stretchId: '2,3',
  index,
  loc: { x, y },
});

describe('BP packing drag requests — asking the engine the same thing twice', () => {
  it('treats a repeat of the last request as a repeat', () => {
    expect(sameBpDragUpdate(flapAt(4, 9), flapAt(4, 9))).toBe(true);
    expect(sameBpDeviceUpdate(deviceAt(4, 9), deviceAt(4, 9))).toBe(true);
  });

  it('does not treat a move to a different cell as a repeat', () => {
    expect(sameBpDragUpdate(flapAt(4, 9), flapAt(5, 9))).toBe(false);
    expect(sameBpDragUpdate(flapAt(4, 9), flapAt(4, 10))).toBe(false);
    expect(sameBpDeviceUpdate(deviceAt(4, 9), deviceAt(4, 10))).toBe(false);
  });

  it('does not treat a different set of flaps at the same place as a repeat', () => {
    // Multi-select drags send every selected flap, so the ids are part of what
    // was asked, not incidental.
    expect(sameBpDragUpdate(flapAt(4, 9, [7]), flapAt(4, 9, [7, 8]))).toBe(false);
    expect(sameBpDragUpdate(flapAt(4, 9, [7, 8]), flapAt(4, 9, [8, 7]))).toBe(false);
    expect(sameBpDeviceUpdate(deviceAt(4, 9, 0), deviceAt(4, 9, 1))).toBe(false);
  });

  it('never calls the first request of a gesture a repeat', () => {
    expect(sameBpDragUpdate(null, flapAt(4, 9))).toBe(false);
    expect(sameBpDeviceUpdate(null, deviceAt(4, 9))).toBe(false);
  });
});
