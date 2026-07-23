import { describe, expect, it } from 'vitest';
import { createSimulatorSession } from './simulatorSession';
import type { FoldDocument } from '@treemaker/origami-simulator';

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
    const flat = session.settle(4000, {});
    expect(flat.converged).toBe(true);
    const flatPositions = new Float32Array(flat.positions);

    // The regression this guards: a converged clock spends no budget, so
    // changing the fold target must un-converge it or the model never moves.
    session.setFoldPercent(90);
    let folded = session.tick({});
    for (let i = 0; i < 40 && !folded.converged; i += 1) folded = session.tick({});
    const foldedPositions = new Float32Array(folded.positions);

    expect(maxAbsDelta(flatPositions, foldedPositions)).toBeGreaterThan(0.01);
    session.dispose();
  });

  it('carries live strain in the frame payload', () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    session.settle(4000, {});

    session.setFoldPercent(90);
    let folded = session.tick({});
    for (let i = 0; i < 40 && !folded.converged; i += 1) folded = session.tick({});

    // Strain used to be read once from load-time diagnostics, which are taken
    // on the flat sheet and are therefore always zero.
    expect(folded.maxEdgeStrain).toBeGreaterThan(0);
    session.dispose();
  });

  it('keeps ticks bounded by the frame budget', () => {
    const session = createSimulatorSession();
    session.load(miura(16, 16), { budgetMs: 8 });
    session.setFoldPercent(80);

    const tick = session.tick({});
    // The point of the budget: a tick costs about the budget regardless of how
    // big the model is. One chunk of overshoot is expected.
    expect(tick.elapsedMs).toBeLessThan(40);
    expect(tick.stepsThisTick).toBeGreaterThan(0);
    session.dispose();
  });

  it('reuses a returned buffer instead of allocating', () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    const first = session.tick({});
    const recycled = first.positions;

    const second = session.tick({ recycled });
    expect(second.positions).toBe(recycled);
    session.dispose();
  });

  it('returns to flat on reset', () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    const flat = new Float32Array(session.settle(4000, {}).positions);

    session.setFoldPercent(90);
    for (let i = 0; i < 20; i += 1) session.tick({});
    session.reset();
    session.setFoldPercent(0);

    const back = new Float32Array(session.tick({}).positions);
    expect(maxAbsDelta(flat, back)).toBeLessThan(1e-5);
    session.dispose();
  });
});
