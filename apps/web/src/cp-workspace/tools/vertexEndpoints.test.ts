import { describe, expect, it } from 'vitest';
import golden from '../../../../../tests/fixtures/cp/vertex-move-match-golden.json';
import {
  VERTEX_COINCIDENCE,
  endpointKey,
  endpointKeys,
  vertexEndpointsAt,
  type VertexEndpointSegment,
} from './vertexEndpoints';

interface GoldenCase {
  point: [number, number];
  matched: { segment: number; slot: string }[];
}

const segments: VertexEndpointSegment[] = (
  golden.segments as [number, number, number, number][]
).map(([ax, ay, bx, by]) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } }));

describe('vertexEndpoints golden parity with the kernel', () => {
  // The fixture is produced by crates/oristudio-cp/tests/vertex_move_match_golden.rs
  // from `operations::native::vertex::vertex_endpoints_at` — the exact rule the
  // commit runs. A drift on either side fails on the other, because a preview that
  // moves a crease the commit leaves behind is a crease stretched to nowhere.

  it('uses the same tolerance as the kernel', () => {
    expect(VERTEX_COINCIDENCE).toBe(golden.tolerance);
  });

  it.each((golden.cases as GoldenCase[]).map((c, i) => [i, c] as const))(
    'case %i matches the kernel, endpoint for endpoint',
    (_index, testCase) => {
      const matched = vertexEndpointsAt(segments, {
        x: testCase.point[0],
        y: testCase.point[1],
      });
      expect(matched).toEqual(testCase.matched);
    }
  );

  it('covers the cases the rule is easy to get wrong', () => {
    const cases = golden.cases as GoldenCase[];
    // A junction where several creases meet.
    expect(cases.some((c) => c.matched.length >= 4)).toBe(true);
    // A probe with nothing on it.
    expect(cases.some((c) => c.matched.length === 0)).toBe(true);
    // A crease matched on both ends — already-degenerate geometry.
    expect(
      cases.some((c) => c.matched.some((m) => m.slot === 'a') && c.matched.some((m) => m.slot === 'b' && c.matched.some((n) => n.segment === m.segment && n.slot === 'a')))
    ).toBe(true);
  });
});

describe('vertexEndpointsAt', () => {
  it('matches inside the tolerance and not outside it', () => {
    const near: VertexEndpointSegment[] = [
      { a: { x: VERTEX_COINCIDENCE * 0.5, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: VERTEX_COINCIDENCE * 2, y: 0 }, b: { x: 10, y: 10 } },
    ];
    expect(vertexEndpointsAt(near, { x: 0, y: 0 })).toEqual([{ segment: 0, slot: 'a' }]);
  });

  it('measures radially, not per axis', () => {
    // Inside the box of side 2ε but outside the ε circle: (0.8ε, 0.8ε) is
    // 1.13ε from the origin. A per-axis test would wrongly match it.
    const diagonal = VERTEX_COINCIDENCE * 0.8;
    const segments: VertexEndpointSegment[] = [
      { a: { x: diagonal, y: diagonal }, b: { x: 10, y: 0 } },
    ];
    expect(vertexEndpointsAt(segments, { x: 0, y: 0 })).toEqual([]);
  });

  it('reports both ends of an already-degenerate crease', () => {
    const degenerate: VertexEndpointSegment[] = [{ a: { x: 5, y: 5 }, b: { x: 5, y: 5 } }];
    expect(vertexEndpointsAt(degenerate, { x: 5, y: 5 })).toEqual([
      { segment: 0, slot: 'a' },
      { segment: 0, slot: 'b' },
    ]);
  });
});

describe('endpointKey', () => {
  it('packs a segment index and slot into the preview channel key', () => {
    expect(endpointKey(0, 'a')).toBe(0);
    expect(endpointKey(0, 'b')).toBe(1);
    expect(endpointKey(7, 'a')).toBe(14);
    expect(endpointKey(7, 'b')).toBe(15);
  });

  it('collapses duplicate matches into one key each', () => {
    expect(
      endpointKeys([
        { segment: 2, slot: 'a' },
        { segment: 2, slot: 'b' },
        { segment: 2, slot: 'a' },
      ])
    ).toEqual(new Set([4, 5]));
  });
});
