import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperFace, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PaperScene } from '../../lib/paper/paperScene';
import { cameraSpreadLift, cameraSpreadStrain, liftWeights } from './cameraSpreadLift';
import { CAMERA_SPREAD_MAX_AMOUNT, cameraSpreadScene, type CameraSpreadOptions } from './cameraSpreadScene';
import { foldedFlatPaperScene } from './foldedFlatScene';
import { cameraPaintPlans, cameraPaintBackFacing } from './cameraSpreadVisibility';
import { cameraSpreadTransform } from './cameraSpreadCamera';

function square(ids: number[], front = true): OristudioCpFoldedPaperFace {
  const outline = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  return {
    outline,
    points: ids,
    front_up: front,
    edges: outline.map((from, i) => ({
      from,
      to: outline[(i + 1) % 4]!,
      kind: 'border',
    })),
  };
}
function stack(joined = false): OristudioCpFoldedPaperScene {
  return {
    schema_version: 3,
    flipped: false,
    sheet: 2,
    faces: [square([0, 1, 2, 3]), square(joined ? [4, 1, 2, 5] : [4, 5, 6, 7], false)],
    subfaces: [{ polygon: square([]).outline, faces_top_to_bottom: [1, 0] }],
    aux_lines: [],
    sheet_points: [],
  };
}
const options: CameraSpreadOptions = {
  amount: 0.06,
  directionDeg: 0,
  inclinationDeg: 45,
  projection: 'diagram',
};
function visibleFace(scene: PaperScene, x: number, y: number): number | null {
  let face: number | null = null;
  for (const item of scene.items) {
    if (item.kind !== 'face') continue;
    for (const ring of item.rings) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
          inside = !inside;
      }
      if (inside) face = item.face;
    }
  }
  return face;
}
function auxAt(scene: PaperScene, x: number, y: number): boolean {
  return scene.items.some((item) => {
    if (item.kind !== 'line' || item.role !== 'aux') return false;
    const dx = item.b[0] - item.a[0],
      dy = item.b[1] - item.a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return false;
    const along = ((x - item.a[0]) * dx + (y - item.a[1]) * dy) / length;
    return (
      along >= 0 && along <= length && Math.abs(dx * (y - item.a[1]) - dy * (x - item.a[0])) / length < 1e-8
    );
  });
}

describe('experimental connected camera lift', () => {
  it('shares paper identities at a hinge, but does not weld coincident layers', () => {
    const mesh = cameraSpreadLift(stack(true));
    expect(mesh.faceVertices[0]![1]).toBe(mesh.faceVertices[1]![1]);
    expect(mesh.faceVertices[0]![2]).toBe(mesh.faceVertices[1]![2]);
    expect(mesh.faceVertices[0]![0]).not.toBe(mesh.faceVertices[1]![0]);
    const left = liftWeights(mesh, 0, { x: 1, y: 0.37 })!;
    const right = liftWeights(mesh, 1, { x: 1, y: 0.37 })!;
    const height = (w: Array<[number, number]>) => w.reduce((s, [v, k]) => s + mesh.heights[v]! * k, 0);
    expect(height(left)).toBeCloseTo(height(right), 12);
  });
  it('fits two independent layers in their known order, including withheld samples', () => {
    const mesh = cameraSpreadLift(stack());
    expect(mesh.diagnostics.probeCount).toBeGreaterThan(0);
    expect(mesh.diagnostics.fitInversions).toBe(0);
    expect(mesh.diagnostics.probeInversions).toBe(0);
    expect(mesh.diagnostics.missedSamples).toBe(0);
    const average = (f: number) => mesh.faceVertices[f]!.reduce((s, v) => s + mesh.heights[v]!, 0) / 4;
    expect(average(1)).toBeGreaterThan(average(0));
  });
  it('opens a shared hinge while keeping ink across each panel nearly straight', () => {
    const mesh = cameraSpreadLift(stack(true));
    const height = (f: number, x: number, y: number) =>
      liftWeights(mesh, f, { x, y })!.reduce((sum, [v, w]) => sum + w * mesh.heights[v]!, 0);
    // A rigidity penalty must allow a tilted plane, not flatten the entire
    // model. Sample lines through triangle centres and across triangulation
    // diagonals so the old centre bulges cannot pass as a straight panel.
    expect(height(1, 0, 0.5) - height(0, 0, 0.5)).toBeGreaterThan(0.5);
    for (const f of [0, 1])
      for (const y of [0.2, 0.5, 0.8]) {
        const a = height(f, 0, y),
          b = height(f, 1, y);
        // At the default 6% amount, bow stays below 0.1% of this unit line.
        for (const t of [0.2, 0.4, 0.6, 0.8])
          expect(options.amount * Math.abs(height(f, t, y) - (a + t * (b - a)))).toBeLessThan(0.001);
      }
  });
  it('caches by scene identity and leaves the original geometry untouched', () => {
    const scene = stack();
    const before = JSON.stringify(scene);
    const mesh = cameraSpreadLift(scene);
    expect(cameraSpreadLift(scene)).toBe(mesh);
    expect(cameraSpreadLift(structuredClone(scene))).not.toBe(mesh);
    expect(JSON.stringify(scene)).toBe(before);
    expect(cameraSpreadStrain(mesh, 0)).toEqual({ p95: 0, max: 0 });
  });
  it('returns the exact original diagram at zero, with independent orbit in 3D', () => {
    const kernel = stack(true);
    const original = foldedFlatPaperScene(kernel, {
      markHidden: true,
      toScenePx: (p) => [p.x, p.y],
      scale: 1,
    });
    expect(cameraSpreadScene(kernel, { ...options, amount: 0, inclinationDeg: 150 })).toEqual(original);
    for (const projection of ['orthographic', 'perspective'] as const)
      for (const visibility of ['layers', 'depth'] as const) {
        const top = cameraSpreadScene(kernel, {
          ...options,
          amount: 0,
          projection,
          visibility,
          inclinationDeg: 0,
        });
        const below = cameraSpreadScene(kernel, {
          ...options,
          amount: 0,
          projection,
          visibility,
          inclinationDeg: 180,
        });
        expect(visibleFace(top, 0.5, 0.5)).toBe(1);
        expect(visibleFace(below, 0.5, 0.5)).toBe(0);
        expect(Object.values(below.bounds).every(Number.isFinite)).toBe(true);
      }
  });
  it('rotates the projected drawing without changing layer coverage when rolled', () => {
    const kernel = stack();
    for (const projection of ['orthographic', 'perspective'] as const) {
      const camera = {
        ...options,
        projection,
        directionDeg: 32,
        inclinationDeg: 120,
      };
      const before = cameraSpreadScene(kernel, camera);
      const after = cameraSpreadScene(kernel, { ...camera, rollDeg: 90 });
      const vertices = (scene: PaperScene) =>
        scene.items.flatMap((item) =>
          item.kind === 'face' ? item.rings.flat() : item.kind === 'line' ? [item.a, item.b] : []
        );
      const original = vertices(before);
      const rotated = vertices(after);
      expect(rotated).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(rotated[i]![0]).toBeCloseTo(1 - original[i]![1], 10);
        expect(rotated[i]![1]).toBeCloseTo(original[i]![0], 10);
      }
      expect(visibleFace(after, 0.5, 0.5)).toBe(0);
    }
  });
  it('keeps the diagram order and reverses it from below', () => {
    const kernel = stack();
    const diagram = cameraSpreadScene(kernel, options);
    expect(visibleFace(diagram, 0.5, 0.5)).toBe(1);
    expect(visibleFace(diagram, 1.03, 0.5)).toBe(0);
    const below = cameraSpreadScene(kernel, {
      ...options,
      projection: 'orthographic',
      inclinationDeg: 180,
    });
    expect(visibleFace(below, 0.5, 0.5)).toBe(0);
  });
  it('hides inverted layers and ink in every camera mode, reversing protection underneath', () => {
    const kernel = stack();
    kernel.aux_lines = [{ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, face: 0 }];
    const mesh = cameraSpreadLift(kernel);
    // Deliberately put the entire lower face above the upper one. This is the
    // failure from the screenshot; back-face culling or depth bias cannot fix it.
    for (const t of mesh.triangles) for (const v of t.vertices) mesh.heights[v] = t.face === 0 ? 1 : -1;
    const view = { ...options, inclinationDeg: 0 };
    const locked = cameraSpreadScene(kernel, view);
    const raw = cameraSpreadScene(kernel, { ...view, visibility: 'depth' });
    expect(visibleFace(locked, 0.4, 0.5)).toBe(1);
    expect(visibleFace(raw, 0.4, 0.5)).toBe(0);
    const lastAux = locked.items.reduce(
      (last, item, i) => (item.kind === 'line' && item.role === 'aux' ? i : last),
      -1
    );
    expect(lastAux).toBe(-1);
    for (const projection of ['orthographic', 'perspective'] as const) {
      const top = cameraSpreadScene(kernel, { ...view, projection });
      expect(visibleFace(top, 0.4, 0.5)).toBe(1);
      expect(auxAt(top, 0.4, 0.5)).toBe(false);
      const below = cameraSpreadScene(kernel, {
        ...view,
        projection,
        inclinationDeg: 180,
      });
      expect(visibleFace(below, 0.4, 0.5)).toBe(0);
      expect(auxAt(below, 0.4, 0.5)).toBe(true);
    }
  });
  it('reverses a tilted stack before the camera crosses the original sheet, regardless of paper colour', () => {
    for (const front of [false, true]) {
      const kernel = stack();
      kernel.faces.forEach((f) => {
        f.front_up = front;
      });
      kernel.aux_lines = [{ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, face: 1 }];
      const mesh = cameraSpreadLift(kernel);
      for (const t of mesh.triangles)
        for (const v of t.vertices) mesh.heights[v] = 2 * mesh.xy[v]!.x + (t.face === 0 ? 0.1 : -0.1);
      for (const projection of ['orthographic', 'perspective'] as const) {
        const view = {
          ...options,
          amount: 0.5,
          projection,
          inclinationDeg: 60,
        };
        const frame = cameraSpreadTransform(view);
        expect(frame[8]).toBeGreaterThan(0);
        const plans = cameraPaintPlans(mesh, kernel);
        for (const piece of plans.front.pieces)
          expect(cameraPaintBackFacing(piece.plane, view, frame, [0.5, 0.5])).toBe(true);
        // Project the middle of the stack, where both faces overlap.
        const w = projection === 'perspective' ? 1 - (0.5 * frame[8]) / 2.5 : 1;
        const x = 0.5 + (0.5 * frame[2]) / w;
        const locked = cameraSpreadScene(kernel, view);
        expect(visibleFace(locked, x, 0.5)).toBe(0);
        expect(visibleFace(cameraSpreadScene(kernel, { ...view, visibility: 'depth' }), x, 0.5)).toBe(1);
        expect(auxAt(locked, x, 0.5)).toBe(false);
      }
    }
  });
  it('protects forward and reversed stacks simultaneously in one camera view', () => {
    const kernel = stack();
    kernel.faces.push(square([8, 9, 10, 11]), square([12, 13, 14, 15]));
    kernel.faces.slice(2).forEach((f) =>
      f.outline.forEach((p) => {
        p.y += 2;
      })
    );
    kernel.subfaces.push({
      polygon: kernel.faces[2]!.outline,
      faces_top_to_bottom: [3, 2],
    });
    const mesh = cameraSpreadLift(kernel);
    for (const t of mesh.triangles)
      for (const v of t.vertices)
        mesh.heights[v] = (t.face < 2 ? 2 : -2) * mesh.xy[v]!.x + (t.face % 2 ? -0.01 : 0.01);
    for (const projection of ['orthographic', 'perspective'] as const) {
      const view = { ...options, amount: 0.5, projection, inclinationDeg: 60 };
      const frame = cameraSpreadTransform(view);
      const scene = cameraSpreadScene(kernel, view);
      for (const [sign, y, expected] of [
        [1, 1 / 6, 0],
        [-1, 5 / 6, 3],
      ]) {
        const z = sign! / 6;
        const w = projection === 'perspective' ? 1 - (frame[8] * z) / 2.5 : 1;
        const x = mesh.size * (1 / 6 + (frame[2] * z) / w);
        const sy = mesh.size * (0.5 + (y! - 0.5) / w);
        expect(visibleFace(scene, x, sy)).toBe(expected);
      }
    }
  });
  it('uses the finite perspective eye for surface facing, independently of camera roll', () => {
    const view = {
      ...options,
      amount: 0.5,
      inclinationDeg: 60,
      projection: 'orthographic' as const,
    };
    for (const rollDeg of [0, 91, 210]) {
      const frame = cameraSpreadTransform({ ...view, rollDeg });
      const plane: [number, number, number, number] = [-1, 0, 1, -0.5];
      expect(cameraPaintBackFacing(plane, view, frame, [0, 0])).toBe(false);
      expect(cameraPaintBackFacing(plane, { ...view, projection: 'perspective' }, frame, [0, 0])).toBe(true);
    }
  });
  it('uses surface depth for new oblique overlaps instead of forcing the flat draw order', () => {
    const kernel = stack();
    kernel.faces[0]!.outline.forEach((p) => {
      p.x += 1.5;
    });
    kernel.subfaces = kernel.faces.map((face, i) => ({
      polygon: face.outline,
      faces_top_to_bottom: [i],
    }));
    const mesh = cameraSpreadLift(kernel);
    // Two disconnected panels, disjoint in XY, become overlapping on screen
    // near a side view. Face 0 is nearer, even though face 1 paints last flat.
    for (const t of mesh.triangles) for (const v of t.vertices) mesh.heights[v] = t.face === 0 ? 0 : -0.24;
    const plan = cameraPaintPlans(mesh, kernel).front;
    expect(plan.pieces.find((p) => p.face === 1)!.rank).toBeGreaterThan(
      plan.pieces.find((p) => p.face === 0)!.rank
    );
    for (const projection of ['diagram', 'orthographic', 'perspective'] as const) {
      const view = {
        ...options,
        amount: 0.5,
        directionDeg: 0,
        inclinationDeg: 80,
        projection,
      };
      const layered = cameraSpreadScene(kernel, view);
      const raw = cameraSpreadScene(kernel, { ...view, visibility: 'depth' });
      const x = projection === 'diagram' ? 2 : 1.4;
      expect(visibleFace(raw, x, 0.5)).toBe(0);
      expect(visibleFace(layered, x, 0.5)).toBe(0);
    }
  });
  it('resolves unrelated tilted surfaces at each overlap instead of sorting their centre depths', () => {
    for (const reverseIds of [false, true]) {
      const kernel = stack();
      kernel.subfaces = [];
      const sloped = reverseIds ? 1 : 0;
      kernel.aux_lines = [{ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, face: sloped }];
      const mesh = cameraSpreadLift(kernel);
      for (const t of mesh.triangles)
        for (const v of t.vertices) mesh.heights[v] = t.face === sloped ? 1.5 * mesh.xy[v]!.x - 0.5 : 0;
      for (const projection of ['diagram', 'orthographic', 'perspective'] as const) {
        const view = { ...options, amount: 0.3, inclinationDeg: 0, projection };
        const scene = cameraSpreadScene(kernel, view);
        expect(visibleFace(scene, 0.2, 0.5)).toBe(1 - sloped);
        expect(visibleFace(scene, 0.8, 0.5)).toBe(sloped);
        // BSP draws unrelated hidden ink underneath the visible face; known
        // buried ink, tested above, is clipped before it reaches the BSP.
        const raw = cameraSpreadScene(kernel, { ...view, visibility: 'depth' });
        expect(visibleFace(raw, 0.2, 0.5)).toBe(visibleFace(scene, 0.2, 0.5));
        expect(visibleFace(raw, 0.8, 0.5)).toBe(visibleFace(scene, 0.8, 0.5));
      }
    }
  });
  it('keeps all four local over/under crossings of a woven cycle', () => {
    const rect = (x: number, y: number, w: number, h: number, f: number) => {
      const face = square([4 * f, 4 * f + 1, 4 * f + 2, 4 * f + 3]);
      face.outline.forEach((p) => {
        p.x = x + w * p.x;
        p.y = y + h * p.y;
      });
      return face;
    };
    const cells: Array<[number, number, number[]]> = [
      [1, 1, [0, 1]],
      [3, 1, [3, 0]],
      [1, 3, [1, 2]],
      [3, 3, [2, 3]],
    ];
    const kernel: OristudioCpFoldedPaperScene = {
      ...stack(),
      sheet: 5,
      faces: [rect(0, 1, 5, 1, 0), rect(1, 0, 1, 5, 1), rect(0, 3, 5, 1, 2), rect(3, 0, 1, 5, 3)],
      subfaces: cells.map(([x, y, order]) => ({
        polygon: rect(x, y, 1, 1, 0).outline,
        faces_top_to_bottom: order,
      })),
    };
    const plans = cameraPaintPlans(cameraSpreadLift(kernel), kernel);
    expect(plans.front.pieces.some((p) => p.patch && p.kind === 'face')).toBe(true);
    for (const angle of [0, 45]) {
      const scene = cameraSpreadScene(kernel, {
        ...options,
        inclinationDeg: angle,
      });
      for (const [x, y, order] of cells) expect(visibleFace(scene, x + 0.5, y + 0.5)).toBe(order[0]);
    }
    // A positive lift must retain the reversed local woven stacks as well.
    const below = cameraSpreadScene(kernel, {
      ...options,
      amount: 0.06,
      projection: 'orthographic',
      inclinationDeg: 180,
    });
    for (const [x, y, order] of cells) expect(visibleFace(below, 5 - (x + 0.5), y + 0.5)).toBe(order[1]);
    expect(cameraPaintPlans(cameraSpreadLift(kernel), kernel)).toBe(plans);
  });
  it('keeps lifted auxiliary ink inside the height range on extremely thin triangles', () => {
    const kernel = stack();
    const face = kernel.faces[0]!;
    const corner = { x: 1 - 1e-13, y: 1 };
    face.outline.splice(3, 0, corner);
    face.points.splice(3, 0, 8);
    face.edges = face.outline.map((from, i) => ({
      from,
      to: face.outline[(i + 1) % 5]!,
      kind: 'border',
    }));
    kernel.aux_lines = [{ face: 0, from: { x: 0, y: 0.1 }, to: { x: 1, y: 0.9 } }];
    const mesh = cameraSpreadLift(kernel);
    const plans = cameraPaintPlans(mesh, kernel);
    const lo = Math.min(...mesh.heights),
      hi = Math.max(...mesh.heights);
    for (const plan of [plans.front, plans.back])
      for (const piece of plan.pieces)
        for (const p of piece.points) {
          expect(p.every(Number.isFinite)).toBe(true);
          expect(p[2]).toBeGreaterThanOrEqual(lo - 1e-6);
          expect(p[2]).toBeLessThanOrEqual(hi + 1e-6);
        }
  });
  it('supports top down, side, underside and full azimuth without nonfinite geometry', () => {
    const kernel = stack(true);
    for (const projection of ['diagram', 'orthographic', 'perspective'] as const)
      for (const directionDeg of [0, 90, 247, 359])
        for (const inclinationDeg of [0, 45, 90, 150])
          for (const amount of [options.amount, CAMERA_SPREAD_MAX_AMOUNT]) {
            const scene = cameraSpreadScene(kernel, {
              ...options,
              amount,
              projection,
              directionDeg,
              inclinationDeg,
            });
            expect(Object.values(scene.bounds).every(Number.isFinite)).toBe(true);
            expect(scene.items.length).toBeGreaterThan(0);
          }
  });
  it('refuses unnamed and inconsistent topology instead of separating independent face copies', () => {
    const old = stack();
    old.faces[0]!.points = [];
    expect(() => cameraSpreadLift(old)).toThrow(/named paper vertices/);
    const torn = stack(true);
    torn.faces[1]!.outline[1]!.x += 0.2;
    expect(() => cameraSpreadLift(torn)).toThrow(/inconsistent folded coordinates/);
    expect(() => cameraSpreadScene(stack(), { ...options, amount: NaN })).toThrow(/finite controls/);
    for (const amount of [-0.01, CAMERA_SPREAD_MAX_AMOUNT + 0.01, Infinity])
      expect(() => cameraSpreadScene(stack(), { ...options, amount })).toThrow(/finite controls/);
  });
});
