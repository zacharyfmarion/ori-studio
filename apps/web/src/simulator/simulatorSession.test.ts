import { describe, expect, it } from 'vitest';
import { createSimulatorSession, type SimulatorFramePayload } from './simulatorSession';
import type { FoldDocument } from '@treemaker/origami-simulator';

/**
 * A frame the session actually produced. `tick`/`settle` return null when the
 * caller quotes a superseded session token; these cases quote none, so a null
 * here is a real failure rather than the ordinary stale-call path.
 */
function frame(payload: SimulatorFramePayload | null): SimulatorFramePayload {
  if (!payload) throw new Error('expected a frame, got a stale-session null');
  return payload;
}

// Exercises the worker session the way the panel drives it. These are the paths
// that broke when the solver moved off-thread, so they are worth pinning: a
// fold change has to actually restart a converged solve, and frames have to
// carry live diagnostics rather than load-time ones.

function miura(n: number, m: number): FoldDocument {
  const angle = Math.PI / 3;
  const at = (i: number, j: number) => i * (m + 1) + j;
  const vertices: number[][] = [];
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      vertices.push([i + (j % 2 === 0 ? 0 : Math.cos(angle) * 0.25), j * Math.sin(angle), 0]);
    }
  }
  const edges: [number, number][] = [];
  const assignment: string[] = [];
  const foldAngle: Array<number | null> = [];
  const push = (u: number, v: number, kind: string) => {
    edges.push([u, v]);
    assignment.push(kind);
    foldAngle.push(kind === 'B' ? null : kind === 'M' ? -150 : 150);
  };
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (i < n) push(at(i, j), at(i + 1, j), j === 0 || j === m ? 'B' : j % 2 === 0 ? 'M' : 'V');
      if (j < m) push(at(i, j), at(i, j + 1), i === 0 || i === n ? 'B' : i % 2 === 0 ? 'V' : 'M');
    }
  }
  const faces: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return {
    vertices_coords: vertices,
    edges_vertices: edges,
    edges_assignment: assignment as FoldDocument['edges_assignment'],
    edges_foldAngle: foldAngle,
    faces_vertices: faces,
  };
}

function maxAbsDelta(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max;
}

// These tests run in jsdom with no WebGL2, so the session always takes the CPU
// path and returns positions. (The GPU render path, where positions are null, is
// exercised by bench:gpu-parity in a real browser.)
function positionsOf(payload: { positions: ArrayBuffer | null }): ArrayBuffer {
  if (!payload.positions) throw new Error('expected CPU-path positions but got null');
  return payload.positions;
}

describe('simulator session', () => {
  it('reports model topology for the renderer', () => {
    const session = createSimulatorSession();
    const info = session.load(miura(8, 8), {});

    expect(info.vertexCount).toBe(81);
    expect(info.faceCount).toBe(128);
    expect(new Uint32Array(info.indices)).toHaveLength(info.faceCount * 3);
    expect(new Int32Array(info.edgesVertices)).toHaveLength(info.edgeCount * 2);
    expect(new Uint8Array(info.edgesAssignment)).toHaveLength(info.edgeCount);
    session.dispose();
  });

  it('settles immediately at rest, then folds when the target changes', () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});

    // Flat with no crease torque: the clock should converge at once rather than
    // burning its whole step allowance.
    const flat = frame(session.settle(4000, {}));
    expect(flat.converged).toBe(true);
    const flatPositions = new Float32Array(positionsOf(flat));

    // The regression this guards: a converged clock spends no budget, so
    // changing the fold target must un-converge it or the model never moves.
    session.setFoldPercent(90);
    let folded = frame(session.tick({}));
    for (let i = 0; i < 40 && !folded.converged; i += 1) folded = frame(session.tick({}));
    const foldedPositions = new Float32Array(positionsOf(folded));

    expect(maxAbsDelta(flatPositions, foldedPositions)).toBeGreaterThan(0.01);
    session.dispose();
  });

  it('carries live strain in the frame payload', () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    frame(session.settle(4000, {}));

    session.setFoldPercent(90);
    let folded = frame(session.tick({}));
    for (let i = 0; i < 40 && !folded.converged; i += 1) folded = frame(session.tick({}));

    // Strain used to be read once from load-time diagnostics, which are taken
    // on the flat sheet and are therefore always zero.
    expect(folded.maxStrain).toBeGreaterThan(0);
    session.dispose();
  });

  it('exports the current folded geometry', () => {
    const session = createSimulatorSession();
    const info = session.load(miura(8, 8), {});
    session.setFoldPercent(70);
    frame(session.settle(4000, {}));

    const geometry = session.exportGeometry();
    const positions = new Float32Array(geometry.positions);
    const triangles = new Uint32Array(geometry.triangles);

    expect(geometry.vertexCount).toBe(info.vertexCount);
    expect(positions.length).toBe(info.vertexCount * 3);
    expect(triangles.length).toBe(info.faceCount * 3);
    expect(geometry.foldPercent).toBe(70);
    expect([...positions].every((value) => Number.isFinite(value))).toBe(true);
    // Every index must address a real vertex, or an exported mesh is corrupt.
    expect(Math.max(...triangles)).toBeLessThan(info.vertexCount);
    // A folded model must have left the flat plane.
    const maxY = Math.max(...[...positions].filter((_, i) => i % 3 === 1).map(Math.abs));
    expect(maxY).toBeGreaterThan(0);

    session.dispose();
  });

  it('keeps ticks bounded by the frame budget', () => {
    const session = createSimulatorSession();
    session.load(miura(16, 16), { budgetMs: 8 });
    session.setFoldPercent(80);

    const tick = frame(session.tick({}));
    // The point of the budget: a tick costs about the budget regardless of how
    // big the model is. One chunk of overshoot is expected.
    expect(tick.elapsedMs).toBeLessThan(40);
    expect(tick.stepsThisTick).toBeGreaterThan(0);
    session.dispose();
  });

  it('reuses a returned buffer instead of allocating', () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    const first = frame(session.tick({}));
    const recycled = positionsOf(first);

    const second = frame(session.tick({ recycled }));
    expect(second.positions).toBe(recycled);
    session.dispose();
  });

  it('returns to flat on reset', () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    const flat = new Float32Array(positionsOf(frame(session.settle(4000, {}))));

    session.setFoldPercent(90);
    for (let i = 0; i < 20; i += 1) frame(session.tick({}));
    session.reset();
    session.setFoldPercent(0);

    const back = new Float32Array(positionsOf(frame(session.tick({}))));
    expect(maxAbsDelta(flat, back)).toBeLessThan(1e-5);
    session.dispose();
  });
});

describe('session handoff', () => {
  // One worker serves several consumers -- the Simulate panel, and each inline
  // simulation window -- but holds one live model. Their calls are asynchronous,
  // so a tick dispatched by the window that just lost focus can land after its
  // successor has loaded. Without a token it would be answered with the *new*
  // model's geometry and drawn into the old window.

  it('gives each load a distinct token', () => {
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    const second = session.load(miura(8, 8), {});

    expect(second.token).not.toBe(first.token);
    session.dispose();
  });

  it('answers the current token', () => {
    const session = createSimulatorSession();
    const info = session.load(miura(4, 4), {});

    expect(session.tick({ token: info.token })).not.toBeNull();
    expect(session.settle(200, { token: info.token })).not.toBeNull();
    session.dispose();
  });

  it('drops work quoting a superseded token', () => {
    const session = createSimulatorSession();
    const stale = session.load(miura(4, 4), {});
    session.load(miura(8, 8), {});

    // Null rather than a throw: being superseded is the ordinary result of
    // moving focus between windows, not a fault to surface.
    expect(session.tick({ token: stale.token })).toBeNull();
    expect(session.settle(200, { token: stale.token })).toBeNull();
    expect(session.setCamera({ view: { yaw: 0, pitch: 0, zoom: 1 }, width: 8, height: 8 }, stale.token)).toBeNull();
    session.dispose();
  });

  it('ignores a stale mutation instead of applying it to the new model', () => {
    const session = createSimulatorSession();
    const stale = session.load(miura(4, 4), {});
    const live = session.load(miura(8, 8), {});

    // The bug this prevents: the outgoing window's fold scrub arriving late and
    // dragging its successor's model to a fold percent nobody asked for.
    session.setFoldPercent(90, stale.token);
    expect(frame(session.tick({ token: live.token })).foldPercent).toBe(0);

    session.setFoldPercent(90, live.token);
    expect(frame(session.tick({ token: live.token })).foldPercent).toBe(90);
    session.dispose();
  });

  it('serves the live model to a caller quoting no token', () => {
    const session = createSimulatorSession();
    session.load(miura(4, 4), {});
    session.load(miura(8, 8), {});

    // The exporters read "whatever is loaded" and have no token to quote.
    expect(session.tick({})).not.toBeNull();
    expect(session.exportGeometry().vertexCount).toBe(81);
    session.dispose();
  });

  it('keeps each model\'s own geometry across an alternation', () => {
    const session = createSimulatorSession();

    const small = session.load(miura(4, 4), {});
    const smallVertices = small.vertexCount;
    frame(session.settle(2000, { token: small.token }));

    const large = session.load(miura(8, 8), {});
    expect(large.vertexCount).not.toBe(smallVertices);
    const largeFrame = frame(session.settle(2000, { token: large.token }));
    expect(positionsOf(largeFrame).byteLength / 4 / 3).toBe(large.vertexCount);

    const backToSmall = session.load(miura(4, 4), {});
    const smallFrame = frame(session.settle(2000, { token: backToSmall.token }));
    expect(positionsOf(smallFrame).byteLength / 4 / 3).toBe(smallVertices);
    session.dispose();
  });
});

describe('prepared-model reuse', () => {
  it('does not leak solver state between loads that share a model key', () => {
    const session = createSimulatorSession();
    const fold = miura(6, 6);

    const first = session.load(fold, { modelKey: 'shared' });
    session.setFoldPercent(90, first.token);
    let folded = frame(session.tick({ token: first.token }));
    for (let i = 0; i < 40 && !folded.converged; i += 1) {
      folded = frame(session.tick({ token: first.token }));
    }
    expect(folded.foldPercent).toBe(90);

    // The cache holds the *prepared* model, which is immutable. A reload must
    // still start from a fresh solver at rest, or a window would inherit the
    // fold state of whichever window used the same source before it.
    const second = session.load(fold, { modelKey: 'shared' });
    const reloaded = frame(session.settle(2000, { token: second.token }));
    expect(reloaded.foldPercent).toBe(0);
    expect(reloaded.step).toBeLessThan(folded.step);
    session.dispose();
  });
});
