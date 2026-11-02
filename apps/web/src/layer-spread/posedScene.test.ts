import { expect, it } from 'vitest';
import type { ConnectedSpread, Point3, SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import { foldedFlatPaperScene } from '../cp-workspace/folded/foldedFlatScene';
import { plainBook } from '../cp-workspace/folded/foldedPrecrease.fixtures';
import { connectedPaperScene, type ConnectedDrawing, type ConnectedPaperScene } from './connectedScene';
import { perspectiveDrawing } from './perspective';

it.each([0, 0.5, 2])('doubles Perspective height and ink at amount %s without changing Diagram or the recipe', (amount) => {
  const kernel = plainBook();
  const source = connectedSpreadSource(kernel);
  const reference = { plane: [0, 0, 0] as Point3, center: [0, 0, 0] as Point3, samples: 1, rms: 0 };
  const solution: SpreadSolution = {
    version: 'normalized-50-v1',
    heights: source.vertices.map((id) => id === 2 || id === 5 ? 0.2 : 0),
    references: [reference, reference],
    diagnostics: { status: 'solved', iterations: 1, qp_seconds: 0, variables: 6, constraints: 0,
      overlap_regions: 1, crossing_weight: 50, opening_scale: 1, max_relative_warp: 0,
      max_slope: 0.2, max_crossing: 0, rms_crossing: 0, mean_gap: 0.1 },
  };
  const connected = { source, solution };
  const spread: ConnectedSpread = { kind: 'connected', version: 1, amount, reveal: [0, 0] };
  const options = { connected, spread, live: true, markHidden: false, scale: 1,
    toScenePx: (p: { x: number; y: number }): [number, number] => [p.x, p.y] };
  const diagram = foldedFlatPaperScene(kernel, options) as ConnectedPaperScene;
  const twice = ([x, y, z]: Point3): Point3 => [x, y, z * 2];
  const doubled: ConnectedDrawing = { ...diagram.connected,
    mesh: { ...diagram.connected.mesh, positions: diagram.connected.mesh.positions.map(twice) },
    ink: diagram.connected.ink.map((edge) => ({ ...edge, a: twice(edge.a), b: twice(edge.b) })),
  };
  for (const pitch of [0.5, Math.PI - 0.5]) {
    const presentation = { kind: 'perspective' as const, camera: { yaw: 0.4, pitch, zoom: 1 }, orderSide: 'front' as const };
    const expected = perspectiveDrawing(doubled, connected, presentation);
    const live = foldedFlatPaperScene(kernel, { ...options, presentation }) as ConnectedPaperScene;
    expect(live.connected).toEqual(expected);
    expect(foldedFlatPaperScene(kernel, { ...options, presentation, live: false }))
      .toEqual(connectedPaperScene(expected, kernel.sheet, true));
    expect(foldedFlatPaperScene(kernel, { ...options, presentation: { ...presentation, kind: 'diagram' } }))
      .toEqual(diagram);
  }
  expect(spread).toEqual({ kind: 'connected', version: 1, amount, reveal: [0, 0] });
  expect(solution.heights).toEqual(source.vertices.map((id) => id === 2 || id === 5 ? 0.2 : 0));
});
