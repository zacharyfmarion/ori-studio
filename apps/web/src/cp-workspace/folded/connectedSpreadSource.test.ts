import { describe, expect, it } from 'vitest';
import { halfFoldOnSheetKernelScene } from '../../diagram/capture/capture.fixtures';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import { connectedSpreadSource, scenePoint, sourcePoint } from './connectedSpreadSource';

function placed(scene: OristudioCpFoldedPaperScene, map: (p: Point) => Point, back = false) {
  return {
    ...scene,
    flipped: back,
    faces: scene.faces.map((f) => ({
      ...f,
      front_up: back ? !f.front_up : f.front_up,
      outline: f.outline.map(map),
      edges: f.edges.map((e) => ({ ...e, from: map(e.from), to: map(e.to) })),
    })),
    subfaces: scene.subfaces.map((c) => ({
      ...c,
      polygon: c.polygon.map(map),
      faces_top_to_bottom: back ? [...c.faces_top_to_bottom].reverse() : c.faces_top_to_bottom,
    })),
  };
}
describe('canonical connected-spread source', () => {
  it('uses the same solve for turns, placement, unit scale and the other side', () => {
    const scene = halfFoldOnSheetKernelScene(),
      canonical = connectedSpreadSource(scene);
    for (const angle of [0, 0.4, 1.7])
      for (const scale of [0.01, 1, 400])
        for (const back of [false, true]) {
          const map = ({ x, y }: Point) => {
            const u = back ? -x : x;
            return {
              x: 17 + scale * (u * Math.cos(angle) - y * Math.sin(angle)),
              y: -34 + scale * (u * Math.sin(angle) + y * Math.cos(angle)),
            };
          };
          const source = connectedSpreadSource(placed(scene, map, back));
          expect(source.input).toEqual(canonical.input);
          expect(source.back).toBe(back);
          for (const face of scene.faces)
            for (const p of face.outline) {
              const q = map(p),
                round = scenePoint(source, sourcePoint(source, q));
              expect(round.x).toBeCloseTo(q.x, 7);
              expect(round.y).toBeCloseTo(q.y, 7);
            }
        }
  });
  it('adapts Fold Y-up without changing topology, orders or the solve', () => {
    const scene = halfFoldOnSheetKernelScene();
    expect(
      connectedSpreadSource(
        placed(scene, (p) => ({ x: p.x, y: -p.y })),
        true,
      ).input,
    ).toEqual(connectedSpreadSource(scene).input);
  });
  it('keeps coincident material corners distinct and shares actual crease endpoints', () => {
    const source = connectedSpreadSource(halfFoldOnSheetKernelScene());
    expect(source.vertices).toHaveLength(6);
    expect(source.input.xy[0]).toEqual(source.input.xy[4]);
    expect(source.input.faces[0]!.slice(2)).toEqual(source.input.faces[1]!.slice(2));
  });
  it('rejects disconnected shared vertices rather than welding unrelated geometry', () => {
    const scene = halfFoldOnSheetKernelScene();
    scene.faces[1]!.outline = scene.faces[1]!.outline.map((p, i) => ({ ...p, x: p.x + (i === 2 ? 2 : 0) }));
    expect(() => connectedSpreadSource(scene)).toThrow('Disconnected material crease');
  });
});
