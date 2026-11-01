import { expect, it } from 'vitest';
import { visibility, type SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import { precreasedFlap } from '../cp-workspace/folded/foldedPrecrease.fixtures';
import { foldedFlatPaperScene } from '../cp-workspace/folded/foldedFlatScene';
import { connectedDrawing, type ConnectedPaperScene } from './connectedScene';
import { perspectiveDrawing } from './perspective';

it.each([false, true])('keeps the exposed part of a precreased layer in the same band (back=%s)', (back) => {
  const scene = precreasedFlap();
  const source = connectedSpreadSource(scene, true);
  // The two pieces share an unfolded crease. Only the right piece has a
  // stacking relation with the flap in the original flat projection.
  expect(source.input.planeGroups).toEqual([0, 0, 1]);
  expect(source.input.orders).toEqual([[1, 2]]);
  source.back = back;
  const solution = {
    heights: source.vertices.map(() => 0),
    references: [{ plane: [0, 0, 0] }, { plane: [0, 0, 0] }],
  } as SpreadSolution;
  const prepared = { source, solution };
  const spread = { kind: 'connected' as const, version: 1 as const, amount: 0.5, reveal: [0.8, 0.6] as [number, number] };
  const toScenePx = (p: { x: number; y: number }): [number, number] => [p.x, -p.y];
  const drawing = connectedDrawing(scene, prepared, spread, toScenePx, []);
  expect(drawing.mesh.visibility.ranks).toEqual(back ? [1, 1, 0] : [0, 0, 1]);
  const paper = foldedFlatPaperScene(scene, { connected: prepared, spread, toScenePx, live: true, markHidden: false, scale: 1 }) as ConnectedPaperScene;
  expect(paper.connected.mesh.visibility).toEqual(drawing.mesh.visibility);
  for (const pitch of [0.5, Math.PI - 0.5]) {
    const perspective = perspectiveDrawing(drawing, prepared, {
      kind: 'perspective', camera: { yaw: 0.4, pitch, zoom: 1 }, orderSide: 'front',
    });
    const opposite = (pitch > Math.PI / 2) !== back;
    expect(perspective.mesh.visibility).toEqual(visibility(3, [[0, 2], [1, 2]], opposite));
  }
  // Rendering adds no collision constraints or changes to the solve input.
  expect(source.input.orders).toEqual([[1, 2]]);
});
