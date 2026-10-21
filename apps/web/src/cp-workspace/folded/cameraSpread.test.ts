import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperFace, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PaperScene } from '../../lib/paper/paperScene';
import { cameraSpreadLift, cameraSpreadStrain, liftWeights } from './cameraSpreadLift';
import { cameraSpreadScene, type CameraSpreadOptions } from './cameraSpreadScene';
import { foldedFlatPaperScene } from './foldedFlatScene';
import { cameraPaintPlans } from './cameraSpreadVisibility';

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
  it('caches by scene identity and leaves the original geometry untouched', () => {
    const scene = stack();
    const before = JSON.stringify(scene);
    const mesh = cameraSpreadLift(scene);
    expect(cameraSpreadLift(scene)).toBe(mesh);
    expect(cameraSpreadLift(structuredClone(scene))).not.toBe(mesh);
    expect(JSON.stringify(scene)).toBe(before);
    expect(cameraSpreadStrain(mesh, 0)).toEqual({ p95: 0, max: 0 });
  });
  it('returns the exact original drawing at zero for every camera', () => {
    const kernel = stack(true);
    const original = foldedFlatPaperScene(kernel, {
      markHidden: false,
      toScenePx: (p) => [p.x, p.y],
      scale: 1,
    });
    for (const projection of ['diagram', 'orthographic', 'perspective'] as const) {
      expect(
        cameraSpreadScene(kernel, {
          ...options,
          amount: 0,
          projection,
          inclinationDeg: 150,
        })
      ).toEqual(original);
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
  it('hides a physically inverted lower layer and its ink, while raw depth exposes it', () => {
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
    expect(lastAux).toBeGreaterThan(-1);
    expect(visibleFace({ ...locked, items: locked.items.slice(lastAux + 1) }, 0.4, 0.5)).toBe(1);
    expect(
      visibleFace(
        cameraSpreadScene(kernel, { ...view, projection: 'orthographic', inclinationDeg: 180 }),
        0.4,
        0.5
      )
    ).toBe(0);
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
      const scene = cameraSpreadScene(kernel, { ...options, inclinationDeg: angle });
      for (const [x, y, order] of cells) expect(visibleFace(scene, x + 0.5, y + 0.5)).toBe(order[0]);
    }
    const below = cameraSpreadScene(kernel, { ...options, projection: 'orthographic', inclinationDeg: 180 });
    for (const [x, y, order] of cells) expect(visibleFace(below, 5 - (x + 0.5), y + 0.5)).toBe(order[1]);
    expect(cameraPaintPlans(cameraSpreadLift(kernel), kernel)).toBe(plans);
  });
  it('keeps lifted auxiliary ink inside the height range on extremely thin triangles', () => {
    const kernel = stack();
    const face = kernel.faces[0]!;
    const corner = { x: 1 - 1e-13, y: 1 };
    face.outline.splice(3, 0, corner);
    face.points.splice(3, 0, 8);
    face.edges = face.outline.map((from, i) => ({ from, to: face.outline[(i + 1) % 5]!, kind: 'border' }));
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
        for (const inclinationDeg of [0, 45, 90, 150]) {
          const scene = cameraSpreadScene(kernel, {
            ...options,
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
  });
});
