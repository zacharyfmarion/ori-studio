import { describe, expect, it } from 'vitest';
import { createOrigamiSimulator, detectWebGlSupport, prepareFoldModel } from '../src/index.js';
import { makeBookFoldFixture, maxPositionDelta } from '../src/testing.js';

describe('prepareFoldModel', () => {
  it('normalizes FOLD data and extracts crease parameters', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());

    expect(prepared.vertexCount).toBe(4);
    expect(prepared.faceCount).toBe(2);
    expect(prepared.positions[1]).toBe(0);
    expect(prepared.positions[2]).toBe(0);
    expect(prepared.positions[5]).toBe(0);
    expect(prepared.edgesAssignment[4]).toBe('M');
    expect(prepared.edgesFoldAngle[4]).toBe(-180);
    expect(prepared.creaseParams).toHaveLength(1);
    expect(prepared.creaseParams[0]).toMatchObject({
      face1: 1,
      vertex1: 3,
      face2: 0,
      vertex2: 1,
      edge: 4,
      targetAngle: -180,
    });
  });

  it('triangulates quads and adds flat facet edges', () => {
    const prepared = prepareFoldModel({
      vertices_coords: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      edges_assignment: ['B', 'B', 'B', 'B'],
      edges_foldAngle: [null, null, null, null],
      faces_vertices: [[0, 1, 2, 3]],
    });

    expect(prepared.facesVertices).toHaveLength(2);
    expect(prepared.edgesVertices).toHaveLength(5);
    expect(prepared.edgesAssignment[4]).toBe('F');
    expect(prepared.edgesFoldAngle[4]).toBe(0);
  });
});

describe('createOrigamiSimulator', () => {
  it('steps deterministically without requiring WebGL', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 100 } });
    const before = simulator.readFrame().positions;
    const after = simulator.step(32).positions;

    expect(maxPositionDelta(before, after)).toBeGreaterThan(0);
    expect(simulator.readFrame().diagnostics.usedCpuFallback).toBe(true);

    simulator.dispose();
    expect(() => simulator.step()).toThrow(/disposed/);
  });

  it('starts from OrigamiSimulator-style centered and scaled model coordinates', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared });
    const positions = simulator.readFrame().positions;
    const xs = [positions[0], positions[3], positions[6], positions[9]];
    const zs = [positions[2], positions[5], positions[8], positions[11]];

    expect(Math.max(...xs)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.min(...xs)).toBeCloseTo(-Math.SQRT1_2);
    expect(Math.max(...zs)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.min(...zs)).toBeCloseTo(-Math.SQRT1_2);

    simulator.dispose();
  });

  it('clamps fold playback to the flat-to-target range', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: -100 } });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64);

    expect(after.foldPercent).toBe(0);
    expect(maxPositionDelta(before, after.positions)).toBeLessThan(1e-6);
    simulator.setFoldPercent(250);
    expect(simulator.readFrame().foldPercent).toBe(100);

    simulator.dispose();
  });

  it('settles a simple fold without frame-to-frame shape jumps', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 100 } });
    let previous = simulator.readFrame().positions;

    for (let i = 0; i < 8; i += 1) {
      previous = simulator.step(100).positions;
    }
    const after = simulator.step(100);

    expect(maxPositionDelta(previous, after.positions)).toBeLessThan(1e-4);
    expect(after.diagnostics.maxEdgeStrain).toBeLessThan(1e-4);
    expect(Array.from(after.positions).every(Number.isFinite)).toBe(true);
    simulator.dispose();
  });

  it('uses an adaptive timestep for very small crease-pattern edges', () => {
    const tiny = makeBookFoldFixture();
    tiny.vertices_coords = tiny.vertices_coords.map(([x, y]) => [x * 0.001, y * 0.001]);
    const prepared = prepareFoldModel(tiny);
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 100 } });
    const frame = simulator.step(800);

    expect(Array.from(frame.positions).every(Number.isFinite)).toBe(true);
    expect(frame.diagnostics.maxEdgeStrain).toBeLessThan(1e-4);
    simulator.dispose();
  });

  it('can scale the adaptive timestep down for higher-accuracy settling', () => {
    const standardPrepared = prepareFoldModel(makeBookFoldFixture());
    const accuratePrepared = prepareFoldModel(makeBookFoldFixture());
    const standard = createOrigamiSimulator({
      model: standardPrepared,
      options: { foldPercent: 100 },
    });
    const accurate = createOrigamiSimulator({
      model: accuratePrepared,
      options: { foldPercent: 100, timeStepScale: 0.25 },
    });
    const standardBefore = standard.readFrame().positions;
    const accurateBefore = accurate.readFrame().positions;
    const standardAfter = standard.step(1).positions;
    const accurateAfter = accurate.step(1).positions;

    expect(maxPositionDelta(standardBefore, standardAfter)).toBeGreaterThan(0);
    expect(maxPositionDelta(accurateBefore, accurateAfter)).toBeGreaterThan(0);
    expect(maxPositionDelta(accurateBefore, accurateAfter)).toBeLessThan(
      maxPositionDelta(standardBefore, standardAfter)
    );
    standard.dispose();
    accurate.dispose();
  });

  it('leaves a flat model still when the target fold percent is zero', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 0 } });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeLessThan(1e-6);
    simulator.dispose();
  });

  it('keeps a profiled crease still when its fold range is flat', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({
      model: prepared,
      options: {
        foldPercent: 100,
        foldProfile: { ranges: [{ edge: 4, fromAngle: 0, toAngle: 0 }] },
      },
    });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeLessThan(1e-6);
    simulator.dispose();
  });

  it('moves a profiled crease as the fold percent advances through its range', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({
      model: prepared,
      options: {
        foldPercent: 100,
        foldProfile: { ranges: [{ edge: 4, fromAngle: 0, toAngle: -180 }] },
      },
    });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeGreaterThan(0);
    simulator.dispose();
  });

  it('returns to whole-model targets after clearing a fold profile', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({
      model: prepared,
      options: {
        foldPercent: 100,
        foldProfile: { ranges: [{ edge: 4, fromAngle: 0, toAngle: 0 }] },
      },
    });
    const before = simulator.step(64).positions;
    simulator.setFoldProfile(null);
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeGreaterThan(0);
    simulator.dispose();
  });

  it('reports WebGL availability without throwing in node', () => {
    expect(detectWebGlSupport()).toBe(false);
  });
});
