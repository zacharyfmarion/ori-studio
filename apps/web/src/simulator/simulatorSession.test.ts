import { describe, expect, it } from 'vitest';
import {
  createSimulatorSession,
  foldScaledForSolver,
  type SimulatorFramePayload,
} from './simulatorSession';
import { MAX_CONCURRENT_SIMULATIONS } from './simulatorLimits';
import type { FoldDocument, RenderSettings } from '@treemaker/origami-simulator';

/**
 * A frame the session actually produced. `tick`/`settle` return null when the
 * caller quotes a superseded session token; these cases quote none, so a null
 * here is a real failure rather than the ordinary stale-call path.
 */
async function frame(
  payload: Promise<SimulatorFramePayload | null> | SimulatorFramePayload | null
): Promise<SimulatorFramePayload> {
  const resolved = await payload;
  if (!resolved) throw new Error('expected a frame, got a stale-session null');
  return resolved;
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
  it('reports model topology for the renderer', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(8, 8), {});

    expect(info.vertexCount).toBe(81);
    expect(info.faceCount).toBe(128);
    expect(new Uint32Array(info.indices)).toHaveLength(info.faceCount * 3);
    expect(new Int32Array(info.edgesVertices)).toHaveLength(info.edgeCount * 2);
    expect(new Uint8Array(info.edgesAssignment)).toHaveLength(info.edgeCount);
    session.dispose();
  });

  it('settles immediately at rest, then folds when the target changes', async () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});

    // Flat with no crease torque: the clock should converge at once rather than
    // burning its whole step allowance.
    const flat = await frame(session.settle(4000, {}));
    expect(flat.converged).toBe(true);
    const flatPositions = new Float32Array(positionsOf(flat));

    // The regression this guards: a converged clock spends no budget, so
    // changing the fold target must un-converge it or the model never moves.
    session.setFoldPercent(90);
    let folded = await frame(session.tick({}));
    for (let i = 0; i < 40 && !folded.converged; i += 1) folded = await frame(session.tick({}));
    const foldedPositions = new Float32Array(positionsOf(folded));

    expect(maxAbsDelta(flatPositions, foldedPositions)).toBeGreaterThan(0.01);
    session.dispose();
  });

  it('carries live strain in the frame payload', async () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    await frame(session.settle(4000, {}));

    session.setFoldPercent(90);
    let folded = await frame(session.tick({}));
    for (let i = 0; i < 40 && !folded.converged; i += 1) folded = await frame(session.tick({}));

    // Strain used to be read once from load-time diagnostics, which are taken
    // on the flat sheet and are therefore always zero.
    expect(folded.maxStrain).toBeGreaterThan(0);
    session.dispose();
  });

  it('exports the current folded geometry', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(8, 8), {});
    session.setFoldPercent(70);
    await frame(session.settle(4000, {}));

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
    // Up to 4,000 CPU solver steps on a 289-vertex model: seconds of real work,
    // against a 5s default that it was already close to. Given an explicit
    // budget so a loaded machine cannot turn it into a phantom failure.
  }, 30_000);

  it('keeps ticks bounded by the frame budget', async () => {
    const session = createSimulatorSession();
    session.load(miura(16, 16), { budgetMs: 8 });
    session.setFoldPercent(80);

    const tick = await frame(session.tick({}));
    // The point of the budget: a tick costs about the budget regardless of how
    // big the model is. Without it this model would run to convergence and take
    // seconds, so the ceiling only has to separate "bounded" from "unbounded" --
    // and being wall-clock, it needs enough slack to survive a loaded machine.
    expect(tick.elapsedMs).toBeLessThan(120);
    expect(tick.stepsThisTick).toBeGreaterThan(0);
    session.dispose();
  });

  it('reuses a returned buffer instead of allocating', async () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    const first = await frame(session.tick({}));
    const recycled = positionsOf(first);

    const second = await frame(session.tick({ recycled }));
    expect(second.positions).toBe(recycled);
    session.dispose();
  });

  it('returns to flat on reset', async () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    const flat = new Float32Array(positionsOf(await frame(session.settle(4000, {}))));

    session.setFoldPercent(90);
    for (let i = 0; i < 20; i += 1) await frame(session.tick({}));
    session.reset();
    session.setFoldPercent(0);

    const back = new Float32Array(positionsOf(await frame(session.tick({}))));
    expect(maxAbsDelta(flat, back)).toBeLessThan(1e-5);
    session.dispose();
  });

  it('stays flat when a tick lands between the reset and the new target', async () => {
    // The test above sets the new target on the very next line, which no caller
    // can actually guarantee: `reset` and `setFoldPercent` are two round-trips to
    // the worker and the tick loop keeps running in between.
    //
    // That gap is what made pressing play on a fully folded window snap straight
    // back to folded instead of replaying: reset returned the paper to flat but
    // left the target where it was, so the solver drove the flat sheet at the old
    // target with nothing damping it.
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    const flat = new Float32Array(positionsOf(await frame(session.settle(4000, {}))));

    session.setFoldPercent(100);
    for (let i = 0; i < 40; i += 1) await frame(session.tick({}));

    session.reset();
    const afterTick = new Float32Array(positionsOf(await frame(session.tick({}))));

    expect(maxAbsDelta(flat, afterTick)).toBeLessThan(1e-5);
    session.dispose();
  });
});

describe('session tokens', () => {
  // One worker serves several consumers -- the Simulate panel, and each inline
  // simulation window -- and now holds several models at once, so that an
  // unfocused window can still be re-rendered when the crease-pattern camera
  // resizes it. Tokens are what keep those apart.

  it('gives each load a distinct token', async () => {
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    const second = session.load(miura(8, 8), {});

    expect(second.token).not.toBe(first.token);
    session.dispose();
  });

  it('keeps answering an earlier token after a later load', async () => {
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    const second = session.load(miura(8, 8), {});

    // Loading no longer displaces: a window that lost focus keeps its model, so
    // a camera change can still redraw it rather than scaling a stale bitmap.
    expect((await frame(session.tick({ token: first.token }))).step).toBeGreaterThan(0);
    expect((await frame(session.tick({ token: second.token }))).step).toBeGreaterThan(0);
    session.dispose();
  });

  it('answers each token with its own model', async () => {
    const session = createSimulatorSession();
    const small = session.load(miura(4, 4), {});
    const large = session.load(miura(8, 8), {});

    // The cross-talk this prevents: a call from one window being answered with
    // whatever model another window loaded most recently.
    const smallFrame = await frame(session.settle(2000, { token: small.token }));
    const largeFrame = await frame(session.settle(2000, { token: large.token }));
    expect(positionsOf(smallFrame).byteLength / 4 / 3).toBe(small.vertexCount);
    expect(positionsOf(largeFrame).byteLength / 4 / 3).toBe(large.vertexCount);
    expect(small.vertexCount).not.toBe(large.vertexCount);
    session.dispose();
  });

  it('keeps a mutation to one model off the other', async () => {
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    const second = session.load(miura(8, 8), {});

    session.setFoldPercent(90, first.token);

    expect((await frame(session.tick({ token: first.token }))).foldPercent).toBe(90);
    expect((await frame(session.tick({ token: second.token }))).foldPercent).toBe(0);
    session.dispose();
  });

  it('stops answering a released token', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(4, 4), {});
    session.release(info.token);

    // Null rather than a throw: a window closing is ordinary, not a fault.
    expect(await session.tick({ token: info.token })).toBeNull();
    expect(await session.settle(200, { token: info.token })).toBeNull();
    expect(
      await session.setCamera({ view: { yaw: 0, pitch: 0, zoom: 1 }, width: 8, height: 8 }, info.token)
    ).toBeNull();
    session.dispose();
  });

  it('evicts the oldest model past the cap rather than growing without bound', async () => {
    const session = createSimulatorSession();
    // The cap matches the window cap, so this should not happen in practice;
    // when it does, the oldest degrades to its last frame instead of the worker
    // holding every model ever loaded.
    // Two past the cap, read from the constant: hard-coding a count meant the
    // test kept passing for the wrong reason the moment the cap moved.
    const tokens = Array.from({ length: MAX_CONCURRENT_SIMULATIONS + 2 }, () =>
      session.load(miura(4, 4), {}).token
    );

    expect(await session.tick({ token: tokens[0]! })).toBeNull();
    expect(await session.tick({ token: tokens[tokens.length - 1]! })).not.toBeNull();
    session.dispose();
  });

  it('has room for every window plus a reload', async () => {
    // A runtime replacing its model loads the new session before releasing the
    // old, so its window is never briefly backed by nothing. A full house
    // therefore needs one slot more than there are windows; without the spare,
    // every reload at the cap evicted somebody still on screen.
    const session = createSimulatorSession();
    const windows = Array.from({ length: MAX_CONCURRENT_SIMULATIONS }, () =>
      session.load(miura(4, 4), {}).token
    );
    // The overlap: one window reloads while all the others hold their models.
    const reloaded = session.load(miura(4, 4), {}).token;

    for (const token of windows) {
      expect(await session.tick({ token })).not.toBeNull();
    }
    expect(await session.tick({ token: reloaded })).not.toBeNull();
    session.dispose();
  });

  it('evicts by use, not by age, so the window in hand is the last to go', async () => {
    // The map is insertion-ordered, so the first entry is whichever window was
    // opened first — no more likely to be idle than any other, and quite likely
    // the one being looked at.
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {}).token;
    const rest = Array.from({ length: MAX_CONCURRENT_SIMULATIONS - 1 }, () =>
      session.load(miura(4, 4), {}).token
    );

    // The oldest session is the one in use; the second-oldest has gone quiet.
    await session.tick({ token: first });

    // Two past the cap, so exactly two must go.
    session.load(miura(4, 4), {});
    session.load(miura(4, 4), {});

    expect(await session.tick({ token: first })).not.toBeNull();
    expect(await session.tick({ token: rest[0]! })).toBeNull();
    session.dispose();
  });

  it('counts what is resident, so a leak is visible', async () => {
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    const second = session.load(miura(4, 4), {});
    expect(session.getPerfStats().liveSessions).toBe(2);

    // Whoever loaded is responsible for handing the previous model back. The
    // runtime does this on reload; without it, repeated loads pile up until the
    // cap evicts them, which showed up first as the test suite slowing down.
    session.release(first.token);
    expect(session.getPerfStats().liveSessions).toBe(1);

    session.release(second.token);
    expect(session.getPerfStats().liveSessions).toBe(0);
    session.dispose();
  });

  it('serves the most recent model to a caller quoting no token', async () => {
    const session = createSimulatorSession();
    session.load(miura(4, 4), {});
    session.load(miura(8, 8), {});

    // The exporters read "whatever is loaded" and have no token to quote.
    expect(await session.tick({})).not.toBeNull();
    expect(session.exportGeometry().vertexCount).toBe(81);
    session.dispose();
  });
});

/** Distinct background so the "theme" mode is identifiable in the output. */
const DEFAULT_EXPORT_SETTINGS: RenderSettings = {
  frontColor: [1, 0, 0],
  backColor: [0, 0, 1],
  mountainColor: [1, 1, 0],
  valleyColor: [0, 1, 1],
  borderColor: [1, 0, 1],
  lightDir: [0, 0, 1],
  background: [0.05, 0.066, 0.078],
  showFaces: true,
  showEdges: true,
  lighting: false,
  creaseWidthPx: 2,
  faceAlpha: 1,
};

describe('exporting the current view as SVG', () => {
  it('draws the folded model, not the flat sheet', async () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    session.setFoldPercent(70);
    await frame(session.settle(4000, {}));

    const page = session.exportSvg();
    expect(page).not.toBeNull();
    expect(page!.svg).toContain('<svg');
    expect(page!.svg).toContain('<polygon');
    expect(page!.svg).not.toMatch(/NaN|Infinity/u);
    // The page size travels with the document because the PNG path needs it.
    expect(page!.width).toBeGreaterThan(0);
    expect(page!.height).toBeGreaterThan(0);

    // A flat sheet at the default camera projects to a much shallower box than a
    // 70%-folded one, so the two documents cannot be the same.
    session.reset();
    await frame(session.settle(4000, {}));
    expect(session.exportSvg()!.svg).not.toBe(page!.svg);
    session.dispose();
  }, 30_000);

  it('exports on the canvas-2D path, where the worker does not draw', async () => {
    // No canvas was ever attached here, so there is no GPU render state. The
    // session still has to know how it is being looked at -- setCamera used to
    // bail out early without one and the camera was never recorded, which left
    // nothing to export from. A fold profile forces this path even on a GPU
    // machine, so it is not an exotic case.
    const session = createSimulatorSession();
    session.load(miura(6, 6), {});
    await frame(session.settle(2000, {}));

    await session.setCamera({ view: { yaw: 0.8, pitch: -0.6, zoom: 1.2 }, width: 640, height: 480 });
    const angled = session.exportSvg();
    expect(angled).not.toBeNull();

    await session.setCamera({ view: { yaw: 0, pitch: -0.6, zoom: 1.2 }, width: 640, height: 480 });
    expect(session.exportSvg()!.svg).not.toBe(angled!.svg);
    session.dispose();
  }, 30_000);

  it('follows the render settings the viewport pushed', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    await frame(session.settle(2000, {}));

    const base: RenderSettings = {
      frontColor: [1, 0, 0],
      backColor: [0, 0, 1],
      mountainColor: [1, 1, 0],
      valleyColor: [0, 1, 1],
      borderColor: [1, 0, 1],
      lightDir: [0, 0, 1],
      background: [0, 0, 0],
      showFaces: true,
      showEdges: true,
      lighting: false,
      creaseWidthPx: 2,
      faceAlpha: 1,
    };

    await session.setRenderSettings({ ...base }, info.token);
    const both = session.exportSvg({ token: info.token })!.svg;
    expect(both).toContain('<polygon');
    expect(both).toContain('<line');
    expect(both).toContain('#ffff00');

    await session.setRenderSettings({ ...base, showEdges: false }, info.token);
    const facesOnly = session.exportSvg({ token: info.token })!.svg;
    expect(facesOnly).toContain('<polygon');
    expect(facesOnly).not.toContain('<line');

    await session.setRenderSettings({ ...base, faceAlpha: 0.48 }, info.token);
    expect(session.exportSvg({ token: info.token })!.svg).toContain('fill-opacity="0.48"');
    session.dispose();
  }, 30_000);

  it('answers null for a superseded token rather than another window’s model', async () => {
    // The failure this prevents: an inline simulation window that lost focus
    // exporting whatever loaded after it.
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    session.load(miura(8, 8), {});
    session.release(first.token);

    expect(session.exportSvg({ token: first.token })).toBeNull();
    expect(session.exportSvg()).not.toBeNull();
    session.dispose();
  });

  it('answers null when nothing is loaded', () => {
    const session = createSimulatorSession();
    expect(session.exportSvg()).toBeNull();
    session.dispose();
  });

  it('leaves the page transparent by default', async () => {
    // The on-screen backdrop is the app's canvas colour, which ranges from
    // near-black to white across themes. A file carrying that would arrive in a
    // document with the app's chrome baked in, so the export does not inherit it.
    const session = createSimulatorSession();
    session.load(miura(4, 4), {});
    await frame(session.settle(2000, {}));

    expect(session.exportSvg()!.svg).not.toContain('<rect');
    expect(session.exportSvg({ background: 'transparent' })!.svg).not.toContain('<rect');
    session.dispose();
  }, 30_000);

  it('paints an opaque page on request', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(4, 4), {});
    await frame(session.settle(2000, {}));
    // A transparent *surface* (an inline window over the crease pattern) must
    // still export an opaque page when one is asked for.
    await session.setRenderSettings(
      { ...DEFAULT_EXPORT_SETTINGS, backgroundAlpha: 0 },
      info.token
    );

    const white = session.exportSvg({ token: info.token, background: 'white' })!.svg;
    expect(white).toContain('<rect');
    expect(white).toContain('fill="#ffffff"');
    expect(white).not.toContain('fill-opacity');

    const themed = session.exportSvg({ token: info.token, background: 'theme' })!.svg;
    expect(themed).toContain('fill="#0d1114"');
    expect(themed).not.toContain('fill-opacity');
    session.dispose();
  }, 30_000);
});

describe('prepared-model reuse', () => {
  it('does not leak solver state between loads that share a model key', async () => {
    const session = createSimulatorSession();
    const fold = miura(6, 6);

    const first = session.load(fold, { modelKey: 'shared' });
    session.setFoldPercent(90, first.token);
    let folded = await frame(session.tick({ token: first.token }));
    for (let i = 0; i < 40 && !folded.converged; i += 1) {
      folded = await frame(session.tick({ token: first.token }));
    }
    expect(folded.foldPercent).toBe(90);

    // The cache holds the *prepared* model, which is immutable. A reload must
    // still start from a fresh solver at rest, or a window would inherit the
    // fold state of whichever window used the same source before it.
    const second = session.load(fold, { modelKey: 'shared' });
    const reloaded = await frame(session.settle(2000, { token: second.token }));
    expect(reloaded.foldPercent).toBe(0);
    expect(reloaded.step).toBeLessThan(folded.step);
    session.dispose();
  });
});

describe('foldScaledForSolver', () => {
  const square = (size: number): FoldDocument =>
    ({
      vertices_coords: [
        [0, 0, 0],
        [size, 0, 0],
        [size, size, 0],
        [0, size, 0],
      ],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
      edges_assignment: ['B', 'B', 'B', 'B'],
      faces_vertices: [[0, 1, 2, 3]],
    }) as unknown as FoldDocument;

  const span = (fold: FoldDocument) => {
    const xs = fold.vertices_coords!.map((c) => c[0]!);
    return Math.max(...xs) - Math.min(...xs);
  };

  /**
   * The constraint this exists for. The GPU solver is float32 and
   * `SimulationClock` calls convergence at an absolute `maxVelocity < 1e-5`; a
   * velocity below the float32 step at the model's own magnitude can never be
   * observed, so the model never settles and every load runs to the step cap.
   */
  it('brings document-scale coordinates inside float32 convergence resolution', () => {
    const CONVERGENCE_EPSILON = 1e-5;
    const float32StepAt = (magnitude: number) =>
      Math.abs(Math.fround(magnitude + magnitude * 2 ** -23) - Math.fround(magnitude));

    // An Oriedita sheet reaches ~3900 units, where 1e-5 is unrepresentable.
    expect(float32StepAt(3900)).toBeGreaterThan(CONVERGENCE_EPSILON);
    expect(float32StepAt(span(foldScaledForSolver(square(3900))))).toBeLessThan(
      CONVERGENCE_EPSILON
    );
  });

  it('scales uniformly, so folded geometry stays similar to the input', () => {
    const scaled = foldScaledForSolver(square(400));
    expect(span(scaled)).toBeCloseTo(1);
    const ys = scaled.vertices_coords!.map((c) => c[1]!);
    // A square stays square: same span on both axes, origin at the corner.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1);
    expect(Math.min(...scaled.vertices_coords!.map((c) => c[0]!))).toBeCloseTo(0);
  });

  it('leaves an already unit-scale fold exactly alone', () => {
    // No rounding introduced where there is nothing to fix -- and this is the
    // common case, since a single-pattern document is already unit-ish.
    const unit = square(1);
    expect(foldScaledForSolver(unit)).toBe(unit);
  });

  it('leaves a degenerate fold alone rather than dividing by zero', () => {
    const point = square(0);
    expect(foldScaledForSolver(point)).toBe(point);
    expect(foldScaledForSolver({ vertices_coords: [] } as unknown as FoldDocument))
      .toEqual({ vertices_coords: [] });
  });
});

describe('folded-figure meshes', () => {
  // These run in jsdom, where there is no WebGL2 at all, so what they pin is the
  // contract around the mesh registry rather than the drawing: that a figure
  // which cannot be meshed is told so instead of throwing, and that a token the
  // worker no longer knows answers null — which is the signal the window's
  // runtime reloads on, and the only thing that makes evicting a mesh safe.
  const payload = () => ({
    positions: new Float32Array(4 * 4 * 4).buffer,
    textureDim: 4,
    vertexCount: 3,
    faceIndices: new Uint32Array([0, 1, 2]).buffer,
    edgeIndices: new Uint32Array([0, 1]).buffer,
    edgeAssignments: new Uint8Array([1]).buffer,
    center: [0, 0, 0] as [number, number, number],
    radius: 1,
    skins: [],
    translucent: { faceIndexStart: 0, faceIndexCount: 3, edgeStart: 0, edgeCount: 1 },
    undetermined: { faceIndexStart: 3, faceIndexCount: 0, edgeStart: 1, edgeCount: 0 },
    undeterminedFaceAlpha: 0.45,
  });

  it('refuses rather than throws when there is nothing to draw on', () => {
    // A figure that cannot be meshed still has to draw, and the caller already
    // has that path: the snapshot it is showing now.
    const session = createSimulatorSession();
    expect(session.loadFolded3dMesh(payload())).toBeNull();
  });

  it('answers null for a mesh it does not have', async () => {
    const session = createSimulatorSession();
    expect(await session.setFolded3dMeshCamera(9999, { view: { yaw: 0, pitch: 0, zoom: 1 }, width: 64, height: 64 })).toBeNull();
    expect(
      await session.setFolded3dMeshRenderSettings(9999, {
        frontColor: [1, 1, 0],
        backColor: [1, 1, 1],
        mountainColor: [1, 0, 0],
        valleyColor: [0, 0, 1],
        borderColor: [0, 0, 0],
        lightDir: [0, 0, 1],
        background: [0, 0, 0],
        showFaces: true,
        showEdges: true,
        lighting: true,
        creaseWidthPx: 3,
        faceAlpha: 1,
      } satisfies RenderSettings)
    ).toBeNull();
  });

  it('releases a mesh it does not have without complaint', () => {
    // Unmount ordering is not guaranteed after an eviction, so a release of
    // something already gone is a normal arrival rather than a fault.
    const session = createSimulatorSession();
    expect(() => session.releaseFolded3dMesh(9999)).not.toThrow();
  });

  it('counts meshes apart from sessions in the perf readout', () => {
    // One shared context draws both kinds, so `renders` deliberately counts
    // both; residency does not, because a session is a solver and a mesh is
    // three textures.
    const session = createSimulatorSession();
    expect(session.getPerfStats().liveMeshes).toBe(0);
  });
});
