import { describe, expect, it } from 'vitest';
import { VERTEX_COINCIDENCE } from '../tools/vertexEndpoints';
import {
  heldEndpointKeys,
  isCpVertexPinned,
  pinnedVertexIndices,
  removeCpVertexPinsInBox,
  toggleCpVertexPin,
  type CpVertexPin,
} from './vertexPins';

const AT = (x: number, y: number) => ({ x, y });

describe('pin matching', () => {
  it('matches within the kernel coincidence epsilon and not beyond it', () => {
    const pins: CpVertexPin[] = [AT(10, 20)];
    expect(isCpVertexPinned(pins, AT(10, 20))).toBe(true);
    expect(isCpVertexPinned(pins, AT(10 + VERTEX_COINCIDENCE * 0.5, 20))).toBe(true);
    expect(isCpVertexPinned(pins, AT(10 + VERTEX_COINCIDENCE * 2, 20))).toBe(false);
  });

  it('toggles a pin off when one is already there', () => {
    const first = toggleCpVertexPin([], AT(1, 2));
    expect(first).toEqual([AT(1, 2)]);
    expect(toggleCpVertexPin(first, AT(1, 2))).toEqual([]);
  });

  it('toggles off a pin the click landed near rather than adding a second', () => {
    // The click resolves to the vertex, but the vertex itself can sit an ulp off
    // the stored pin after a round trip through the document.
    const pins = toggleCpVertexPin([], AT(1, 2));
    expect(toggleCpVertexPin(pins, AT(1 + VERTEX_COINCIDENCE * 0.5, 2))).toEqual([]);
  });
});

describe('clearing pins in a box', () => {
  const box = { contains: (p: { x: number; y: number }) => p.x >= 0 && p.x <= 10 };

  it('drops only what is inside', () => {
    expect(removeCpVertexPinsInBox([AT(5, 0), AT(50, 0)], box)).toEqual([AT(50, 0)]);
  });

  it('returns the same array when nothing was inside, so the caller can skip a write', () => {
    const pins = [AT(50, 0)];
    expect(removeCpVertexPinsInBox(pins, box)).toBe(pins);
  });
});

describe('derived sets', () => {
  it('reports pinned vertices by index', () => {
    const vertices = [AT(0, 0), AT(1, 1), AT(2, 2)];
    expect([...pinnedVertexIndices(vertices, [AT(1, 1)])]).toEqual([1]);
  });

  it('is empty with no pins, without scanning', () => {
    expect(pinnedVertexIndices([AT(0, 0)], []).size).toBe(0);
  });

  it('keys held endpoints the way the transform preview keys them', () => {
    const segments = [
      { a: AT(0, 0), b: AT(1, 0) },
      { a: AT(1, 0), b: AT(2, 0) },
    ];
    // The shared junction at (1,0) is segment 0's `b` (key 1) and segment 1's
    // `a` (key 2) — both must be held, or the crease tears at the pin.
    expect([...heldEndpointKeys(segments, [AT(1, 0)])].sort()).toEqual([1, 2]);
  });
});
