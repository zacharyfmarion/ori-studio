import { expect, it } from 'vitest';
import type { ConnectedSpread, Point3, SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource, scenePoint } from '../cp-workspace/folded/connectedSpreadSource';
import { foldedFlatPaperScene } from '../cp-workspace/folded/foldedFlatScene';
import { plainBook } from '../cp-workspace/folded/foldedPrecrease.fixtures';
import { connectedDrawing, connectedPaperScene, type ConnectedDrawing, type ConnectedPaperScene } from './connectedScene';
import { perspectiveDrawing } from './perspective';
import { equalOpeningGain } from './equalOpening';

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

it.each([0.25, 0.5, 1, 2])('keeps lifted paper its size at amount %s, holding the shift past the nominal opening', (amount) => {
  const kernel = plainBook();
  const source = connectedSpreadSource(kernel);
  const reference = { plane: [0, 0, 0] as Point3, center: [0, 0, 0] as Point3, samples: 1, rms: 0 };
  const plainSolution: SpreadSolution = {
    version: 'normalized-50-v1',
    heights: source.vertices.map((id) => id === 2 || id === 5 ? 0.2 : 0),
    references: [reference, reference],
    diagnostics: { status: 'solved', iterations: 1, qp_seconds: 0, variables: 6, constraints: 0,
      overlap_regions: 1, crossing_weight: 50, opening_scale: 1, max_relative_warp: 0,
      max_slope: 0.2, max_crossing: 0, rms_crossing: 0, mean_gap: 0.1 },
  };
  const front = source.input.xy.flatMap((_, v) => [0.01 * (v + 1), -0.02 * v]);
  const solution: SpreadSolution = { ...plainSolution, shifts: [front, front.map((v) => -2 * v)] };
  const shift = solution.shifts![source.back ? 1 : 0]!;
  const spread: ConnectedSpread = { kind: 'connected', version: 1, amount, reveal: [0.8, 0.6] };
  const toScenePx = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
  const options = { spread, live: true, markHidden: false, scale: 1, toScenePx };
  const positions = (connected: { source: typeof source; solution: SpreadSolution }) =>
    (foldedFlatPaperScene(kernel, { ...options, connected }) as ConnectedPaperScene).connected.mesh.positions;
  const plain = positions({ source, solution: plainSolution });
  const moved = positions({ source, solution });
  const held = Math.min(amount, 1) ** 2;
  source.input.xy.forEach(([x, y], v) => {
    const from = scenePoint(source, [x, y]);
    const to = scenePoint(source, [x + held * shift[2 * v]!, y + held * shift[2 * v + 1]!]);
    expect(moved[v]![0] - plain[v]![0]).toBeCloseTo(to.x - from.x, 9);
    expect(moved[v]![1] - plain[v]![1]).toBeCloseTo(to.y - from.y, 9);
    // The reveal and the depth still read the height where the vertex lay flat.
    expect(moved[v]![2]).toBe(plain[v]![2]);
  });
  // Perspective doubles the height before projecting, so its shift follows the doubled amount.
  const connected = { source, solution };
  const presentation = { kind: 'perspective' as const, camera: { yaw: 0.4, pitch: 0.5, zoom: 1 }, orderSide: 'front' as const };
  const doubled = connectedDrawing(kernel, connected, { ...spread, amount: amount * 2, reveal: [0, 0] }, toScenePx, []);
  const live = foldedFlatPaperScene(kernel, { ...options, connected, presentation }) as ConnectedPaperScene;
  expect(live.connected.mesh.positions).toEqual(perspectiveDrawing(doubled, connected, presentation).mesh.positions);
});

it.each([0.14, 1, 2])('draws a version 2 spread in Perspective at its equal-opening height, and alike in Diagram, at amount %s', (amount) => {
  const kernel = plainBook();
  const source = connectedSpreadSource(kernel);
  const reference = { plane: [0, 0, 0] as Point3, center: [0, 0, 0] as Point3, samples: 1, rms: 0 };
  const solution: SpreadSolution = {
    version: 'normalized-50-v1',
    heights: source.vertices.map((id) => id === 2 || id === 5 ? 0.02 : 0),
    references: [reference, reference],
    diagnostics: { status: 'solved', iterations: 1, qp_seconds: 0, variables: 6, constraints: 0,
      overlap_regions: 1, crossing_weight: 50, opening_scale: 1, max_relative_warp: 0,
      max_slope: 0.02, max_crossing: 0, rms_crossing: 0, mean_gap: 0.01 },
  };
  const connected = { source, solution };
  const v1: ConnectedSpread = { kind: 'connected', version: 1, amount, reveal: [0.8, 0.6] };
  const v2: ConnectedSpread = { ...v1, version: 2 };
  const toScenePx = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
  const options = { connected, live: true, markHidden: false, scale: 1, toScenePx };
  const presentation = { kind: 'perspective' as const, camera: { yaw: 0.4, pitch: 0.5, zoom: 1 }, orderSide: 'front' as const };
  const gain = equalOpeningGain(connected);
  expect(gain).toBeGreaterThan(1);
  const v3: ConnectedSpread = { ...v1, version: 3 };
  expect(foldedFlatPaperScene(kernel, { ...options, spread: v3, presentation })).toEqual(
    foldedFlatPaperScene(kernel, { ...options, spread: { ...v2, amount: amount / 2 }, presentation }));
  expect(foldedFlatPaperScene(kernel, { ...options, spread: v3 })).toEqual(
    foldedFlatPaperScene(kernel, { ...options, spread: { ...v1, amount: amount * gain } }));
  const raised = connectedDrawing(kernel, connected, { ...v2, amount: amount * 2 * gain, reveal: [0, 0] }, toScenePx, []);
  const live = foldedFlatPaperScene(kernel, { ...options, spread: v2, presentation }) as ConnectedPaperScene;
  expect(live.connected.mesh.positions).toEqual(perspectiveDrawing(raised, connected, presentation).mesh.positions);
  expect(foldedFlatPaperScene(kernel, { ...options, spread: v2 })).toEqual(foldedFlatPaperScene(kernel, { ...options, spread: v1 }));
});
