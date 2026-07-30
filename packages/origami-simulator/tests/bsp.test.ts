import { describe, expect, it } from 'vitest';
import { renderMeshToSvg } from '../src/svgRenderer.js';
import { buildBsp, traverseBsp, type BspItem } from '../src/bsp.js';
import { cameraUniforms } from '../src/webgl/camera.js';
import type { RenderSettings } from '../src/webgl/meshRenderer.js';

const SETTINGS: RenderSettings = {
  frontColor: [1, 0, 0],
  backColor: [0, 0, 1],
  mountainColor: [1, 1, 0],
  valleyColor: [0, 1, 1],
  borderColor: [1, 0, 1],
  lightDir: [0, 0, 1],
  background: [0, 0, 0],
  showFaces: true,
  showEdges: false,
  lighting: false,
  creaseWidthPx: 2,
  faceAlpha: 1,
};

/**
 * Two triangles that pass through each other: one in the plane z = 0, one in the
 * plane x = 0, crossing along a line. Each is partly in front of the other, so no
 * ordering of the two whole triangles is correct — the case a depth sort cannot
 * express at any precision.
 */
const CROSSING = new Float32Array([
  -1, -1, 0, 1, -1, 0, 0, 1, 0,
  0, -1, -1, 0, -1, 1, 0, 1, 0,
]);

const CAMERA = cameraUniforms({ yaw: 0.6, pitch: -0.5, zoom: 1 }, [0, 0, 0], 1.5, 400, 400);

function render(positions: Float32Array, faceIndices: Uint32Array) {
  return renderMeshToSvg(
    positions,
    { faceIndices, edgeIndices: new Uint32Array(), edgeAssignments: new Uint8Array() },
    CAMERA,
    SETTINGS,
    { background: false }
  );
}

describe('ordering interpenetrating geometry', () => {
  it('cuts the mesh rather than trying to sort it', () => {
    const page = render(CROSSING, new Uint32Array([0, 1, 2, 3, 4, 5]))!;
    const polygons = page.svg.match(/<polygon/gu) ?? [];
    // Two input triangles; a correct result needs more pieces than that.
    expect(polygons.length).toBeGreaterThan(2);
  });

  it('interleaves the two triangles, which no sort of whole triangles can do', () => {
    // The heart of it. Sorting emits every piece of one triangle before every
    // piece of the other; correctness here requires alternating between them.
    const items: BspItem[] = [
      { kind: 0, ref: 0, points: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]] },
      { kind: 0, ref: 1, points: [[0, -1, -1], [0, -1, 1], [0, 1, 0]] },
    ];
    const ordered = traverseBsp(buildBsp(items), [0, 0, 10]);
    const refs = ordered.map((item) => item.ref);
    expect(refs.length).toBeGreaterThan(2);

    let alternations = 0;
    for (let i = 1; i < refs.length; i += 1) if (refs[i] !== refs[i - 1]) alternations += 1;
    expect(alternations).toBeGreaterThan(1);
  });

  it('orders far to near, so the eye position decides the direction', () => {
    const items: BspItem[] = [
      { kind: 0, ref: 0, points: [[-1, -1, -1], [1, -1, -1], [0, 1, -1]] },
      { kind: 0, ref: 1, points: [[-1, -1, 1], [1, -1, 1], [0, 1, 1]] },
    ];
    const tree = buildBsp(items);
    // Eye on the +depth side: the depth = +1 triangle is nearer, so it is last.
    expect(traverseBsp(tree, [0, 0, 10]).map((i) => i.ref)).toEqual([0, 1]);
    // From the other side the order reverses, with no rebuild.
    expect(traverseBsp(tree, [0, 0, -10]).map((i) => i.ref)).toEqual([1, 0]);
  });

  it('keeps a piece drawn with its parent’s appearance', () => {
    // A cut piece is coplanar with its parent, so it shows the same side of the
    // paper; recomputing from a sliver would be both wasteful and less stable.
    const page = render(CROSSING, new Uint32Array([0, 1, 2, 3, 4, 5]))!;
    const fills = new Set(page.svg.match(/fill="#[0-9a-f]{6}"/gu) ?? []);
    // Two source triangles, so at most two paper colours regardless of the
    // number of pieces.
    expect(fills.size).toBeLessThanOrEqual(2);
  });

  it('leaves non-overlapping geometry uncut', () => {
    // The tree must not split for its own sake: two separated triangles need no
    // cutting, and growth is the whole cost of this approach.
    const apart = new Float32Array([-1, -1, 0, -0.6, -1, 0, -0.8, 1, 0, 0.6, -1, 0, 1, -1, 0, 0.8, 1, 0]);
    const page = render(apart, new Uint32Array([0, 1, 2, 3, 4, 5]))!;
    expect((page.svg.match(/<polygon/gu) ?? []).length).toBe(2);
  });

  it('handles an empty tree and a tree of edges alone', () => {
    expect(traverseBsp(buildBsp([]), [0, 0, 1])).toEqual([]);
    const edges: BspItem[] = [
      { kind: 1, ref: 0, points: [[-1, 0, 0], [1, 0, 0]] },
      { kind: 1, ref: 1, points: [[0, -1, 0], [0, 1, 0]] },
    ];
    // No face means no splitting plane; both edges still come out.
    expect(traverseBsp(buildBsp(edges), [0, 0, 1])).toHaveLength(2);
  });

  it('draws a crease over the face it lies in', () => {
    // Coplanar items share a node, and a crease must land after its face there —
    // the vector counterpart of the edge shader's depth bias.
    const items: BspItem[] = [
      { kind: 1, ref: 0, points: [[-1, -1, 0], [1, -1, 0]] },
      { kind: 0, ref: 0, points: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]] },
    ];
    const ordered = traverseBsp(buildBsp(items), [0, 0, 10]);
    expect(ordered.map((i) => i.kind)).toEqual([0, 1]);
  });
});
