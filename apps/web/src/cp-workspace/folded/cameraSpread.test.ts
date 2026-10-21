import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperFace, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PaperScene } from '../../lib/paper/paperScene';
import { cameraSpreadLift, cameraSpreadStrain, liftWeights } from './cameraSpreadLift';
import { cameraSpreadScene, type CameraSpreadOptions } from './cameraSpreadScene';
import { foldedFlatPaperScene } from './foldedFlatScene';

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
  it('reorders the surfaces from the projected geometry and reverses them from below', () => {
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
