import { describe, expect, it } from 'vitest';
import { applyIsometry, lineThrough, transformLine } from '../../canvas/foldCanvasGeometry';
import type { FoldIsometry, FoldLineSpan } from '../../engine/foldEngineWire';
import { squareScene } from '../../sequence/foldScene.fixtures';
import { pleatArrow, pleatValleySpans } from './pleatActionGeometry';

const first = { n: [0, 1] as const, d: 0.6 };
const second = { n: [0, 1] as const, d: 0.4 };
const line = (y: number): FoldLineSpan => ({ from: { x: 0.2, y }, to: { x: 0.8, y }, hidden: false });

describe('pleat instruction geometry', () => {
  it('draws toward the valley and crosses both parallel lines', () => {
    const arrow = pleatArrow(first, second, [line(0.4)])!;
    expect(arrow.from.x).toBeCloseTo(arrow.to.x);
    expect(arrow.from.y).toBeGreaterThan(0.6);
    expect(arrow.to.y).toBeLessThan(0.4);
  });

  it('uses the local angle bisector, also after translating, rotating and reflecting the model', () => {
    const tilted = lineThrough({ x: 0.2, y: 0.38 }, { x: 0.8, y: 0.42 })!;
    const span = { ...line(0.4), from: { x: 0.2, y: 0.38 }, to: { x: 0.8, y: 0.42 } };
    const original = pleatArrow(first, tilted, [span])!;
    const normal = [first.n[0] + tilted.n[0], first.n[1] + tilted.n[1]];
    const dx = original.to.x - original.from.x, dy = original.to.y - original.from.y;
    expect(dx * normal[1]! - dy * normal[0]!).toBeCloseTo(0, 10);
    for (const pose of [[0, -1, 3, 1, 0, -2], [-1, 0, 3, 0, 1, -2]] satisfies FoldIsometry[]) {
      const posed = pleatArrow(transformLine(pose, first), transformLine(pose, tilted), [{
        ...span, from: applyIsometry(pose, span.from), to: applyIsometry(pose, span.to),
      }])!;
      for (const end of ['from', 'to'] as const) {
        const expected = applyIsometry(pose, original[end]);
        expect(posed[end].x).toBeCloseTo(expected.x, 10);
        expect(posed[end].y).toBeCloseTo(expected.y, 10);
      }
    }
    const reversed = { n: [-tilted.n[0], -tilted.n[1]] as const, d: -tilted.d };
    expect(pleatArrow(first, reversed, [span])).toEqual(original);
  });

  it('clips the valley to moving material and marks covered stretches as hidden', () => {
    const scene = squareScene();
    scene.faces.push({ ...scene.faces[0]! });
    scene.lineage.push({ id: 9, parent: null, born: 0 });
    const rect = (lo: number, hi: number) => [{ x: lo, y: 0 }, { x: hi, y: 0 }, { x: hi, y: 1 }, { x: lo, y: 1 }];
    scene.subfaces = [
      { polygon: rect(0, 0.3), faces_top_to_bottom: [1] },
      { polygon: rect(0.3, 0.5), faces_top_to_bottom: [1, 0] },
      { polygon: rect(0.5, 0.8), faces_top_to_bottom: [0, 1] },
      { polygon: rect(0.8, 1), faces_top_to_bottom: [0] },
    ];
    expect(pleatValleySpans(scene, [0], first, second, -1)).toEqual([
      { from: { x: 0.3, y: 0.4 }, to: { x: 0.5, y: 0.4 }, hidden: true, direction: 'valley' },
      { from: { x: 0.5, y: 0.4 }, to: { x: 1, y: 0.4 }, hidden: false, direction: 'valley' },
    ]);
    expect(pleatValleySpans(scene, [0], first, second, 1)).toEqual([]);
  });
});
