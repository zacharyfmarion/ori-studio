import { describe, expect, it } from 'vitest';
import { renderMeshToSvg } from '../src/svgRenderer.js';
import { buildBsp, traverseBsp, type BspItem, type Vec3 } from '../src/bsp.js';
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

  it('keeps a split crease straight', () => {
    // The regression this pins. Cutting in view space and projecting each piece
    // separately bends a crease at every cut, because the vertex shader's
    // perspective is a per-vertex warp of x and y rather than a projective
    // divide — a straight segment in view space is not a straight line on
    // screen. Cutting in screen space makes the projection an identity, so
    // pieces stay collinear and match what the GPU rasterizes.
    const positions = new Float32Array([
      // Two faces crossing in an X.
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
      0, -1, -1, 0, -1, 1, 0, 1, 0,
      // A crease that lies in neither, so whichever plane is chosen cuts it.
      -1, 0.2, -1, 1, 0.2, 1,
    ]);
    const page = renderMeshToSvg(
      positions,
      {
        faceIndices: new Uint32Array([0, 1, 2, 3, 4, 5]),
        edgeIndices: new Uint32Array([6, 7]),
        edgeAssignments: new Uint8Array([1]),
      },
      CAMERA,
      { ...SETTINGS, showEdges: true, creaseWidthPx: 1 }
    )!;

    const lines = [...page.svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/gu)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const);
    expect(lines.length).toBeGreaterThan(1); // the crease really was cut

    // Every piece must lie on the line through the two extreme endpoints.
    const points = lines.flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]] as [number, number][]);
    let a = points[0]!;
    let b = points[0]!;
    for (const q of points) {
      if (q[0] < a[0]) a = q;
      if (q[0] > b[0]) b = q;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    expect(length).toBeGreaterThan(1);
    for (const [px, py] of points) {
      const deviation = Math.abs((px - a[0]) * dy - (py - a[1]) * dx) / length;
      expect(deviation).toBeLessThan(0.05);
    }
  });

  describe('ink narrower than the tolerance', () => {
    // A plane tilted enough to have both a screen and a depth component, so the
    // near side is decided rather than degenerate. The crease straddles it, but
    // by less than the ink it is drawn with.
    const face: BspItem = { kind: 0, ref: 0, points: [[0, 0, 0], [0, 10, 0], [1, 0, 10]] };
    const grazing: BspItem = { kind: 1, ref: 0, points: [[-0.5, 2, 1], [0.5, 5, 3]] };

    it('is not split by a plane it only grazes', () => {
      // Splitting here is what chopped creases into sub-pixel confetti: 48 pieces
      // under 2px on a real model, each drawn as a blob the width of the stroke.
      const split = traverseBsp(buildBsp([face, grazing]), [0, 0, 10]);
      expect(split.filter((item) => item.kind === 1)).toHaveLength(2);

      const whole = traverseBsp(buildBsp([face, grazing], { edgeInk: 1.1 }), [0, 0, 10]);
      expect(whole.filter((item) => item.kind === 1)).toHaveLength(1);
    });

    it('is drawn after the surface it lies on', () => {
      // The other half of the same rule. A crease lies on the edge two faces
      // share, so it lies in both planes; left to a strict classification it
      // lands before the nearer one, which then paints over half its width.
      const eye: Vec3 = [0, 0, Number.MAX_SAFE_INTEGER];
      const ordered = traverseBsp(buildBsp([face, grazing], { edgeInk: 1.1, eye }), eye);
      expect(ordered.map((item) => item.kind)).toEqual([0, 1]);
    });

    it('leaves faces alone, however thin the ink', () => {
      // The tolerance is a property of the ink, not of the tree. A face has area
      // and must still be cut, or stacked layers stop ordering against it.
      const crossing: BspItem = { kind: 0, ref: 1, points: [[-2, 2, 1], [2, 5, 3], [0, 8, 2]] };
      const ordered = traverseBsp(buildBsp([face, crossing], { edgeInk: 1.1 }), [0, 0, 10]);
      expect(ordered.filter((item) => item.kind === 0 && item.ref === 1).length).toBeGreaterThan(1);
    });
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

  describe('a caller-supplied draw order among coplanar items', () => {
    // A coplanar stack pushed bottom-first, buried among faces that every
    // candidate plane cuts. `chooseSplitter` samples every floor(faces/5)-th
    // face, so with twenty of them it lands on the middle member of the stack
    // and `subdivide` promotes that one to the head of its own coplanar list.
    const stack = (ref: number): BspItem => ({
      kind: 0,
      ref,
      order: ref,
      points: [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
    });
    // Straddle z = 0 so a z = 0 splitter cuts them, and each other so their own
    // planes cut plenty — which is what makes the sampled splitter interesting.
    const decoy = (i: number): BspItem => ({
      kind: 0,
      ref: 100 + i,
      points: [[1 + i * 0.1, 1, -5], [9, 1 + i * 0.1, 5], [9, 9, 5 - i * 0.1]],
    });
    const scene = (withOrder: boolean): BspItem[] => {
      const items: BspItem[] = [];
      for (let i = 0; i < 3; i += 1) items.push(decoy(i));
      for (let ref = 0; ref < 3; ref += 1) {
        const item = stack(ref);
        items.push(withOrder ? item : { kind: item.kind, ref: item.ref, points: item.points });
      }
      for (let i = 3; i < 20; i += 1) items.push(decoy(i));
      return items;
    };
    const stackOrder = (items: BspItem[]): number[] => {
      const refs = traverseBsp(buildBsp(items), [0, 0, Number.MAX_SAFE_INTEGER])
        .map((item) => item.ref)
        .filter((ref) => ref < 100);
      return [...new Set(refs)];
    };

    it('survives the splitter being promoted to the head of its own list', () => {
      expect(stackOrder(scene(true))).toEqual([0, 1, 2]);
    });

    it('is what the array order alone does not give', () => {
      // The measurement the option exists for: without it the same three faces
      // come back with the sampled one first. Not a claim about which sequence
      // is "right" — only that array order is not preserved, so a caller whose
      // order is a fact about the model has to say so.
      expect(stackOrder(scene(false))).not.toEqual([0, 1, 2]);
    });

    it('still puts faces before edges', () => {
      // `order` is the tie-break under `kind`, never over it: a crease with a
      // lower order must not jump ahead of the face it lies in.
      const items: BspItem[] = [
        { kind: 1, ref: 0, order: 0, points: [[-1, -1, 0], [1, -1, 0]] },
        { kind: 0, ref: 0, order: 5, points: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]] },
      ];
      expect(traverseBsp(buildBsp(items), [0, 0, 10]).map((i) => i.kind)).toEqual([0, 1]);
    });
  });

  describe('a caller-supplied coplanarity tolerance', () => {
    // Two faces a thousandth of a unit apart: one plane as far as the caller is
    // concerned, two planes at the default epsilon.
    const lower: BspItem = { kind: 0, ref: 0, order: 0, points: [[0, 0, 0], [10, 0, 0], [10, 10, 0]] };
    const upper: BspItem = {
      kind: 0,
      ref: 1,
      order: 1,
      points: [[0, 0, 1e-3], [10, 0, 1e-3], [10, 10, 1e-3]],
    };

    it('keeps items inside it in one coplanar list, ordered by the caller', () => {
      const eye: Vec3 = [0, 0, Number.MAX_SAFE_INTEGER];
      const ordered = traverseBsp(buildBsp([upper, lower], { coplanarEps: 1e-2 }), eye);
      expect(ordered.map((item) => item.ref)).toEqual([0, 1]);
    });

    it('does not take them for ink and push them to the children', () => {
      // The trap this replaced: the near-side rule used to be spelled
      // `eps > EPS`, which a raised coplanar tolerance also satisfies. Under it
      // both faces leave the coplanar list and the caller's order is lost.
      const eye: Vec3 = [0, 0, -Number.MAX_SAFE_INTEGER];
      const ordered = traverseBsp(buildBsp([upper, lower], { coplanarEps: 1e-2 }), eye);
      // Same list whichever side the eye is on, because they share a node.
      expect(ordered.map((item) => item.ref)).toEqual([0, 1]);
    });

    it('leaves the default alone, so they separate without one', () => {
      const eye: Vec3 = [0, 0, Number.MAX_SAFE_INTEGER];
      expect(traverseBsp(buildBsp([upper, lower]), eye).map((item) => item.ref)).toEqual([0, 1]);
      expect(
        traverseBsp(buildBsp([upper, lower]), [0, 0, -Number.MAX_SAFE_INTEGER]).map((i) => i.ref)
      ).toEqual([1, 0]);
    });
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
