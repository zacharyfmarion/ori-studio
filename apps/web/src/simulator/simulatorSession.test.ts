import { describe, expect, it } from 'vitest';
import {
  createSimulatorSession,
  foldScaledForSolver,
  sheetExtent,
  widestPenCssPx,
  type SimulatorCamera,
  type SimulatorFramePayload,
  type SimulatorWorkerApi,
} from './simulatorSession';
import { simulatorExportTarget } from './simulatorExportTarget';
import { MAX_CONCURRENT_SIMULATIONS } from './simulatorLimits';
import golden from './__fixtures__/simulatorExportGolden.json';
import { DEFAULT_PAPER_PAGE, type PaperPage } from '../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX, type PaperStyle } from '../lib/paper/paperStyle';
import {
  PAPER_STYLE_POLICIES,
  resolvePaperStyle,
  surfacePaperStyle,
} from '../lib/paper/paperStyleResolve';
import { PT_PER_MM, paperSceneToSvg, type PaperSvgResult } from '../lib/paper/paperSvg';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../lib/paperExportSettings';
import { paperPresetRows } from '../lib/paperPresetRows';
import {
  createPaperExportSession,
  paintPaperExport,
  paperExportPage,
  paperExportSceneInput,
  paperExportStyle,
} from '../paperExport/paperExportSession';
import { paperExportDraft } from '../paperExport/usePaperExportDialog';
import type { FoldDocument, PaperScene, RenderSettings } from '@treemaker/origami-simulator';

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

/**
 * A Miura-ori sheet of `n` × `m` parallelograms. With `auxDiagonals`, a flat
 * crease (`F`) crosses every face corner to corner — aux lines that end where
 * folds meet, which is where erode pulls them back.
 */
function miura(n: number, m: number, { auxDiagonals = false } = {}): FoldDocument {
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
    foldAngle.push(kind === 'B' ? null : kind === 'F' ? 0 : kind === 'M' ? -150 : 150);
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
      const corners = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)] as const;
      if (!auxDiagonals) {
        faces.push([...corners]);
        continue;
      }
      push(corners[0], corners[2], 'F');
      faces.push([corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]);
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

/**
 * A square with a mountain diagonal and an aux line across the middle, laid
 * out as the crease-pattern kernel's simulation model lays it: the aux line on
 * two vertices of its own, on no face, crossing the diagonal.
 */
function squareWithAuxLine(): FoldDocument {
  return {
    vertices_coords: [
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
      [-1, 0, 0],
      [1, 0, 0],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
      [4, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M', 'F'],
    edges_foldAngle: [null, null, null, null, -90, 0],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
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

/** Framing only: the look of an export comes from the style it is handed. */
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
  edgeWidthPx: 2,
  mountainWidthPx: 2,
  valleyWidthPx: 2,
  faceAlpha: 1,
};

/** A style whose inks are distinct from the defaults, so the page can be seen to follow it. */
const EXPORT_STYLE: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: '#ff0000', back: '#0000ff' },
  mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, color: '#ffff00' },
  valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, color: '#00ffff' },
  edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#ff00ff' },
  // By direction, so each fold pen's ink reaches the file — as the Default
  // preset draws a simulation's, but said here, since that is the point.
  foldsAsEdges: false,
  light: { ...DEFAULT_PAPER_STYLE.light, enabled: false },
};

interface ExportViewOptions {
  token?: number;
  style?: PaperStyle;
  page?: PaperPage;
  devicePixelRatio?: number;
  camera?: SimulatorCamera;
  settings?: RenderSettings;
}

/**
 * The view as a page: a snapshot, one scene of it, and the shared painter
 * through the simulator's policy — the style above on the default page unless
 * told otherwise. Null wherever the dialog would have nothing to show.
 */
function exportView(
  session: SimulatorWorkerApi,
  { style = EXPORT_STYLE, page = DEFAULT_PAPER_PAGE, ...snapshot }: ExportViewOptions = {}
): PaperSvgResult | null {
  const scene = exportViewScene(session, { style, page, ...snapshot });
  if (!scene) return null;
  return paperSceneToSvg(scene, surfacePaperStyle(style, PAPER_STYLE_POLICIES.simulator), page);
}

/** The scene `exportView` paints: the view in its own px. */
function exportViewScene(
  session: SimulatorWorkerApi,
  { style = EXPORT_STYLE, page = DEFAULT_PAPER_PAGE, ...snapshot }: ExportViewOptions = {}
): PaperScene | null {
  const id = session.beginExportSnapshot(snapshot);
  if (id === null) return null;
  try {
    return session.exportScene(id, { style, markHidden: !page.keepHiddenFaces });
  } finally {
    session.endExportSnapshot(id);
  }
}

/**
 * Re-pinned from `exportSvg` onto a snapshot, its scenes and the painter the
 * export dialog paints with. What stayed the same is what these tests are for
 * — the worker exports the view on screen, at the camera and framing it was
 * last told, from any session by token, in the style it is handed.
 */
describe('exporting the current view as SVG', () => {
  it('draws the folded model, not the flat sheet', async () => {
    const session = createSimulatorSession();
    session.load(miura(8, 8), {});
    session.setFoldPercent(70);
    await frame(session.settle(4000, {}));

    const page = exportView(session);
    expect(page).not.toBeNull();
    expect(page!.svg).toContain('<svg');
    expect(page!.svg).toContain('<polygon');
    expect(page!.svg).not.toMatch(/NaN|Infinity/u);
    // The page size travels with the document because the PNG path needs it.
    expect(page!.widthPt).toBeGreaterThan(0);
    expect(page!.heightPt).toBeGreaterThan(0);

    // A flat sheet at the default camera projects to a much shallower box than a
    // 70%-folded one, so the two documents cannot be the same.
    session.reset();
    await frame(session.settle(4000, {}));
    expect(exportView(session)!.svg).not.toBe(page!.svg);
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
    const angled = exportView(session);
    expect(angled).not.toBeNull();

    await session.setCamera({ view: { yaw: 0, pitch: -0.6, zoom: 1.2 }, width: 640, height: 480 });
    expect(exportView(session)!.svg).not.toBe(angled!.svg);
    session.dispose();
  }, 30_000);

  it('paints with the style it is handed, not the render settings the viewport pushed', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    await frame(session.settle(2000, {}));
    await session.setRenderSettings({ ...DEFAULT_EXPORT_SETTINGS, mountainColor: [0, 0, 0] }, info.token);

    const svg = exportView(session, { token: info.token })!.svg;
    expect(svg).toContain('<polygon');
    expect(svg).toContain('<line');
    expect(svg).toContain('stroke="#ffff00"');
    expect(svg).toContain('stroke="#00ffff"');
    // A flat sheet at the opening camera shows one side or the other; either
    // way it is the style's paper, not the settings'.
    expect(svg).toMatch(/fill="#(ff0000|0000ff)"/u);
    // The pens are written in points, as the style states them.
    expect(svg).toContain(`stroke-width="${EXPORT_STYLE.mountainFolds.width.toFixed(2)}"`);
    session.dispose();
  }, 30_000);

  /** Every `stroke` and `stroke-width` pair the file's lines are written with. */
  function linePens(svg: string): Set<string> {
    return new Set(
      (svg.match(/<line [^>]*\/>/gu) ?? []).map((line) => {
        const pen = /stroke="([^"]+)" stroke-width="([^"]+)"/u.exec(line);
        return pen ? `${pen[1]} ${pen[2]}` : line;
      })
    );
  }

  /** What the screen draws a style's lines at, in pt, as the file writes them. */
  function onScreenPt(style: PaperStyle): { edge: string; mountain: string; valley: string } {
    const settings = resolvePaperStyle(style, PAPER_STYLE_POLICIES.simulator, {
      dpr: 1,
      background: [0, 0, 0],
      backgroundAlpha: 1,
      faceAlpha: 1,
      colorMode: 'paper',
      strainClip: 5,
    });
    const pt = (px: number) => (px / PT_TO_CSS_PX).toFixed(2);
    return {
      edge: pt(settings.edgeWidthPx),
      mountain: pt(settings.mountainWidthPx),
      valley: pt(settings.valleyWidthPx),
    };
  }

  it('writes each pen at its own width, as the screen draws it', async () => {
    // Re-pinned for X14: the screen drew every line at the mountain pen's
    // width, so the file's edge and valleys were written at it too. The
    // screen draws each pen at its own width now, and so does the file.
    const style: PaperStyle = {
      ...EXPORT_STYLE,
      edges: { ...EXPORT_STYLE.edges, width: 0.9 },
      mountainFolds: { ...EXPORT_STYLE.mountainFolds, width: 3 },
      valleyFolds: { ...EXPORT_STYLE.valleyFolds, width: 1.5 },
    };
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    await frame(session.settle(2000, {}));
    await session.setRenderSettings(DEFAULT_EXPORT_SETTINGS, info.token);

    const svg = exportView(session, { token: info.token, style })!.svg;
    const screen = onScreenPt(style);
    expect(screen).toEqual({ edge: '0.90', mountain: '3.00', valley: '1.50' });
    expect(linePens(svg)).toEqual(
      new Set([
        `#ff00ff ${screen.edge}`,
        `#ffff00 ${screen.mountain}`,
        `#00ffff ${screen.valley}`,
      ])
    );
    session.dispose();
  }, 30_000);

  it('writes folds drawn as edges in the edge pen at the fold pens’ average width', async () => {
    // The folds take the edge pen's ink at (3 + 1) / 2 pt; the paper's own
    // edge keeps the edge pen's 0.9 pt, as it does on screen.
    const style: PaperStyle = {
      ...EXPORT_STYLE,
      edges: { ...EXPORT_STYLE.edges, width: 0.9 },
      mountainFolds: { ...EXPORT_STYLE.mountainFolds, width: 3 },
      valleyFolds: { ...EXPORT_STYLE.valleyFolds, width: 1 },
      foldsAsEdges: true,
    };
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    await frame(session.settle(2000, {}));
    await session.setRenderSettings(DEFAULT_EXPORT_SETTINGS, info.token);

    const svg = exportView(session, { token: info.token, style })!.svg;
    const screen = onScreenPt(style);
    expect(screen).toEqual({ edge: '0.90', mountain: '2.00', valley: '2.00' });
    expect(linePens(svg)).toEqual(new Set([`#ff00ff ${screen.edge}`, `#ff00ff ${screen.mountain}`]));
    session.dispose();
  }, 30_000);

  it('follows the framing the viewport pushed: faces and lines on or off', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    await frame(session.settle(2000, {}));

    await session.setRenderSettings({ ...DEFAULT_EXPORT_SETTINGS, showEdges: false }, info.token);
    const facesOnly = exportView(session, { token: info.token })!.svg;
    expect(facesOnly).toContain('<polygon');
    expect(facesOnly).not.toContain('<line');

    await session.setRenderSettings({ ...DEFAULT_EXPORT_SETTINGS, showFaces: false }, info.token);
    const linesOnly = exportView(session, { token: info.token })!.svg;
    expect(linesOnly).not.toContain('<polygon');
    expect(linesOnly).toContain('<line');

    // Neither is a scene with nothing in it, which the dialog reads as nothing
    // to export.
    await session.setRenderSettings(
      { ...DEFAULT_EXPORT_SETTINGS, showFaces: false, showEdges: false },
      info.token
    );
    const id = session.beginExportSnapshot({ token: info.token });
    expect(id).not.toBeNull();
    expect(session.exportScene(id!, { style: EXPORT_STYLE, markHidden: false })).toBeNull();
    expect(session.exportScene(id!, { style: EXPORT_STYLE, markHidden: true })).toBeNull();
    session.dispose();
  }, 30_000);

  it('applies the simulator’s policy: the light, and erode since Phase 5', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6, { auxDiagonals: true }), {});
    session.setFoldPercent(50);
    await frame(session.settle(4000, {}));
    await session.setRenderSettings(DEFAULT_EXPORT_SETTINGS, info.token);

    const unlit = exportView(session, { token: info.token })!.svg;
    const lit = exportView(session, {
      token: info.token,
      style: { ...EXPORT_STYLE, light: { ...EXPORT_STYLE.light, enabled: true } },
    })!.svg;
    expect(lit).not.toBe(unlit);

    // Re-pinned twice: the export used to ignore erode while the screen could
    // not draw it, and since Phase 9 erode is the aux pen's alone. At a fifth
    // of the sheet the aux lines retreat or go, while every fold and paper
    // edge keeps its length and the paper is untouched.
    const shown: PaperStyle = {
      ...EXPORT_STYLE,
      auxCreases: { ...EXPORT_STYLE.auxCreases, visible: true },
    };
    const whole = exportView(session, { token: info.token, style: shown })!.svg;
    const eroded = exportView(session, {
      token: info.token,
      style: { ...shown, erode: 0.2 },
    })!.svg;
    const inked = (svg: string, color: string) =>
      (svg.match(/<line [^>]*\/>/g) ?? []).filter((line) => line.includes(`stroke="${color}"`));
    const aux = shown.auxCreases.pen.color;
    expect(inked(whole, aux).length).toBeGreaterThan(0);
    expect(inked(eroded, aux).length).toBeLessThan(inked(whole, aux).length);
    for (const color of [shown.mountainFolds.color, shown.valleyFolds.color, shown.edges.color]) {
      expect(inked(whole, color).length, color).toBeGreaterThan(0);
      expect(inked(eroded, color), color).toEqual(inked(whole, color));
    }
    const polygonCount = (svg: string) => svg.split('<polygon ').length - 1;
    expect(polygonCount(eroded)).toBe(polygonCount(whole));
    session.dispose();
  }, 30_000);

  it('erodes an aux line laid over the faces, where it meets the paper’s edge', async () => {
    // Its ends share no vertex with the border, so only the flat sheet can say
    // they lie on it.
    const session = createSimulatorSession();
    const info = session.load(squareWithAuxLine(), {});
    await session.setRenderSettings(DEFAULT_EXPORT_SETTINGS, info.token);
    const shown: PaperStyle = {
      ...EXPORT_STYLE,
      auxCreases: { ...EXPORT_STYLE.auxCreases, visible: true },
    };
    const lengths = (erode: number, color: string) => {
      const svg = exportView(session, { token: info.token, style: { ...shown, erode } })!.svg;
      return (svg.match(/<line [^>]*\/>/g) ?? [])
        .filter((line) => line.includes(`stroke="${color}"`))
        .map((line) => {
          const at = (name: string) => Number(line.match(new RegExp(` ${name}="([^"]+)"`))![1]);
          return Math.hypot(at('x2') - at('x1'), at('y2') - at('y1'));
        });
    };
    const aux = shown.auxCreases.pen.color;
    const [whole] = lengths(0, aux);
    const [eroded] = lengths(0.1, aux);
    expect(whole).toBeGreaterThan(0);
    expect(eroded).toBeGreaterThan(0);
    expect(eroded!).toBeLessThan(whole! * 0.95);
    // The fold it crosses is drawn to its ends either way.
    expect(lengths(0.1, shown.mountainFolds.color)).toEqual(lengths(0, shown.mountainFolds.color));
    session.dispose();
  });

  it('answers null for a superseded token rather than another window’s model', async () => {
    // The failure this prevents: an inline simulation window that lost focus
    // exporting whatever loaded after it.
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    session.load(miura(8, 8), {});
    session.release(first.token);

    expect(session.beginExportSnapshot({ token: first.token })).toBeNull();
    expect(exportView(session)).not.toBeNull();
    session.dispose();
  });

  it('answers null when nothing is loaded', () => {
    const session = createSimulatorSession();
    expect(session.beginExportSnapshot()).toBeNull();
    session.dispose();
  });

  it('paints the page background the export page asks for, or none', async () => {
    // The on-screen backdrop is the app's canvas colour, which ranges from
    // near-black to white across themes. A file carrying that would arrive in a
    // document with the app's chrome baked in, so the page's own background is
    // the only one an export gets.
    const session = createSimulatorSession();
    const info = session.load(miura(4, 4), {});
    await frame(session.settle(2000, {}));
    // A transparent *surface* (an inline window over the crease pattern) must
    // still export an opaque page when one is asked for.
    await session.setRenderSettings({ ...DEFAULT_EXPORT_SETTINGS, backgroundAlpha: 0 }, info.token);

    expect(exportView(session, { token: info.token })!.svg).not.toContain('<rect');
    const white = exportView(session, {
      token: info.token,
      page: { ...DEFAULT_PAPER_PAGE, background: '#ffffff' },
    })!.svg;
    expect(white).toContain('<rect');
    expect(white).toContain('fill="#ffffff"');
    session.dispose();
  }, 30_000);

  it('keeps or drops the buried faces as the export page says', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(8, 8), {});
    session.setFoldPercent(95);
    await frame(session.settle(6000, {}));
    await session.setRenderSettings(DEFAULT_EXPORT_SETTINGS, info.token);

    const kept = exportView(session, { token: info.token })!.svg;
    const dropped = exportView(session, {
      token: info.token,
      page: { ...DEFAULT_PAPER_PAGE, keepHiddenFaces: false },
    })!.svg;
    const polygons = (svg: string) => (svg.match(/<polygon/gu) ?? []).length;
    // A nearly flat-folded Miura buries most of its faces.
    expect(polygons(dropped)).toBeLessThan(polygons(kept));
    expect(polygons(dropped)).toBeGreaterThan(0);
    session.dispose();
  }, 30_000);

  it('builds the scene in CSS pixels, whatever the display drew it at', async () => {
    // The view is held in device pixels: the drawing buffer is the frame times
    // the device-pixel ratio. Taken as they are, a Retina frame was twice its
    // on-screen size. The ratio the viewport sized the frame by takes the
    // camera back down to CSS pixels; the page is then the size asked for,
    // and the pens are in points already and never scale.
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    await frame(session.settle(2000, {}));
    await session.setCamera(
      { view: { yaw: 0.8, pitch: -0.6, zoom: 1 }, width: 1280, height: 960 },
      info.token
    );
    await session.setRenderSettings(DEFAULT_EXPORT_SETTINGS, info.token);
    const size = ({ bounds }: PaperScene) => [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY];

    const [standardWidth, standardHeight] = size(exportViewScene(session, { token: info.token })!);
    const [retinaWidth, retinaHeight] = size(
      exportViewScene(session, { token: info.token, devicePixelRatio: 2 })!
    );
    expect(retinaWidth).toBeCloseTo(standardWidth! / 2, 6);
    expect(retinaHeight).toBeCloseTo(standardHeight! / 2, 6);

    // So the page does not care what the display drew it at.
    const standard = exportView(session, { token: info.token })!;
    const retina = exportView(session, { token: info.token, devicePixelRatio: 2 })!;
    expect(retina.widthPt).toBeCloseTo(standard.widthPt, 6);
    expect(retina.heightPt).toBeCloseTo(standard.heightPt, 6);
    const strokes = (svg: string) => new Set(svg.match(/stroke-width="[\d.]+"/gu));
    expect(strokes(retina.svg)).toEqual(strokes(standard.svg));

    // A ratio of 1 is the page as it always was.
    expect(exportView(session, { token: info.token, devicePixelRatio: 1 })!.svg).toBe(
      standard.svg
    );
    session.dispose();
  }, 30_000);

  it('draws the camera and settings it is handed', async () => {
    // The canvas-2D path draws on the main thread and never sends the worker a
    // camera or framing, so the runtime hands both over with the export
    // instead. The result must be the same document as pushing them first.
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    await frame(session.settle(2000, { token: info.token }));
    // Loaded now, before either has a view of its own, so it carries nothing
    // of the handed one forward and the comparison below is a real one.
    const other = session.load(miura(6, 6), {});
    await frame(session.settle(2000, { token: other.token }));
    const camera = { view: { yaw: 0.8, pitch: -0.6, zoom: 1.2 }, width: 640, height: 480 };
    const settings = { ...DEFAULT_EXPORT_SETTINGS, showEdges: false };

    const handed = exportView(session, { token: info.token, camera, settings })!.svg;
    expect(handed).not.toContain('<line');

    await session.setCamera(camera, other.token);
    await session.setRenderSettings(settings, other.token);
    expect(exportView(session, { token: other.token })!.svg).toBe(handed);

    // Without either, the export is the worker's own view -- which is now the
    // handed one, the same as after a push.
    expect(exportView(session, { token: info.token })!.svg).toBe(handed);
    session.dispose();
  }, 30_000);
});

describe('export snapshots', () => {
  const UNMARKED = { style: EXPORT_STYLE, markHidden: false };
  const MARKED = { style: EXPORT_STYLE, markHidden: true };

  it('keeps every scene of a snapshot on the frame it froze while the solver moves on', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    session.setFoldPercent(40, info.token);
    await frame(session.settle(3000, { token: info.token }));

    const frozen = session.beginExportSnapshot({ token: info.token })!;
    // A second snapshot of the same frame, to check a scene first built after the solver moved.
    const witness = session.beginExportSnapshot({ token: info.token })!;
    const before = session.exportScene(frozen, UNMARKED);
    const witnessMarked = session.exportScene(witness, MARKED);
    expect(before).not.toBeNull();
    expect(witnessMarked).not.toBeNull();

    session.setFoldPercent(90, info.token);
    await frame(session.tick({ token: info.token }));
    await frame(session.settle(3000, { token: info.token }));

    expect(session.exportScene(frozen, UNMARKED)).toEqual(before);
    expect(session.exportScene(frozen, MARKED)).toEqual(witnessMarked);

    const fresh = session.beginExportSnapshot({ token: info.token })!;
    expect(session.exportScene(fresh, UNMARKED)).not.toEqual(before);
    // A later snapshot is its own frame, not the earlier one's buffer.
    expect(session.exportScene(frozen, UNMARKED)).toEqual(before);
    session.dispose();
  }, 30_000);

  it('keeps the camera and the faces and edges it froze, however the view changes after', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    await frame(session.settle(2000, { token: info.token }));
    await session.setCamera({ view: { yaw: 0.8, pitch: -0.6, zoom: 1.2 }, width: 640, height: 480 }, info.token);
    await session.setRenderSettings(DEFAULT_EXPORT_SETTINGS, info.token);
    const frozen = session.beginExportSnapshot({ token: info.token })!;
    const before = session.exportScene(frozen, UNMARKED);

    await session.setCamera({ view: { yaw: -0.4, pitch: 0.3, zoom: 2 }, width: 320, height: 640 }, info.token);
    await session.setRenderSettings({ ...DEFAULT_EXPORT_SETTINGS, showEdges: false }, info.token);

    expect(session.exportScene(frozen, UNMARKED)).toEqual(before);
    const fresh = session.beginExportSnapshot({ token: info.token })!;
    expect(session.exportScene(fresh, UNMARKED)).not.toEqual(before);
    session.dispose();
  }, 30_000);

  it('builds with the style as the simulator draws it, and its widest pen', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(8, 8), {});
    session.setFoldPercent(95);
    await frame(session.settle(6000, {}));
    const id = session.beginExportSnapshot({ token: info.token })!;
    const scene = (style: PaperStyle) => session.exportScene(id, { style, markHidden: true });
    // Folds drawn as edges at a mountain pen far wider than the valley's: the
    // simulator's policy decides which pen the hidden test allows for.
    const raw: PaperStyle = {
      ...EXPORT_STYLE,
      foldsAsEdges: true,
      mountainFolds: { ...EXPORT_STYLE.mountainFolds, width: 6 },
      valleyFolds: { ...EXPORT_STYLE.valleyFolds, width: 1 },
    };
    expect(scene(raw)).toEqual(scene(surfacePaperStyle(raw, PAPER_STYLE_POLICIES.simulator)));
    const wide: PaperStyle = {
      ...EXPORT_STYLE,
      edges: { ...EXPORT_STYLE.edges, width: 6 },
      mountainFolds: { ...EXPORT_STYLE.mountainFolds, width: 6 },
      valleyFolds: { ...EXPORT_STYLE.valleyFolds, width: 6 },
    };
    expect(scene(wide)).not.toEqual(scene(EXPORT_STYLE));
    session.dispose();
  }, 30_000);

  it('drops a snapshot when its dialog ends it', () => {
    const session = createSimulatorSession();
    const info = session.load(miura(4, 4), {});
    const id = session.beginExportSnapshot({ token: info.token })!;
    expect(session.exportScene(id, UNMARKED)).not.toBeNull();

    session.endExportSnapshot(id);
    expect(session.exportScene(id, UNMARKED)).toBeNull();
    session.dispose();
  });

  it('drops a released session’s snapshots and keeps every other session’s', () => {
    const session = createSimulatorSession();
    const released = session.load(miura(4, 4), {});
    const kept = session.load(miura(4, 4), {});
    const releasedId = session.beginExportSnapshot({ token: released.token })!;
    const keptId = session.beginExportSnapshot({ token: kept.token })!;

    session.release(released.token);
    expect(session.exportScene(releasedId, UNMARKED)).toBeNull();
    expect(session.exportScene(keptId, UNMARKED)).not.toBeNull();
    session.dispose();
  });

  it('drops every snapshot on dispose', () => {
    const session = createSimulatorSession();
    const info = session.load(miura(4, 4), {});
    const id = session.beginExportSnapshot({ token: info.token })!;

    session.dispose();
    expect(session.exportScene(id, UNMARKED)).toBeNull();
  });

  it('drops an evicted session’s snapshot', async () => {
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    const id = session.beginExportSnapshot({ token: first.token })!;
    expect(session.exportScene(id, UNMARKED)).not.toBeNull();

    // Two past the cap in all, as the eviction test above loads, so the snapshotted session goes.
    for (let i = 0; i < MAX_CONCURRENT_SIMULATIONS + 1; i += 1) session.load(miura(4, 4), {});

    expect(await session.tick({ token: first.token })).toBeNull();
    expect(session.exportScene(id, UNMARKED)).toBeNull();
    session.dispose();
  });

  it('answers null for a token or a snapshot id it does not know', () => {
    const session = createSimulatorSession();
    const info = session.load(miura(4, 4), {});
    expect(session.beginExportSnapshot({ token: info.token + 1 })).toBeNull();

    const id = session.beginExportSnapshot({ token: info.token })!;
    // The next id has not been handed out yet.
    expect(session.exportScene(id + 1, UNMARKED)).toBeNull();
    session.dispose();
  });

  it('marks hidden items only when asked', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(8, 8), {});
    session.setFoldPercent(95);
    await frame(session.settle(6000, {}));
    const id = session.beginExportSnapshot({ token: info.token })!;
    const hiddenCount = (options: typeof UNMARKED) =>
      session.exportScene(id, options)!.items.filter((item) => item.hidden).length;

    expect(hiddenCount(UNMARKED)).toBe(0);
    expect(hiddenCount(MARKED)).toBeGreaterThan(0);
    session.dispose();
  }, 30_000);
});

/** The page the export dialog saves of a snapshot: the target, the draft, the scene session and the painter. */
async function dialogPage(
  session: SimulatorWorkerApi,
  token: number,
  exportStyle: PaperStyle,
  page: PaperPage,
  devicePixelRatio?: number
): Promise<PaperSvgResult> {
  const id = session.beginExportSnapshot({ token, devicePixelRatio });
  if (id === null) throw new Error('expected a snapshot');
  const target = simulatorExportTarget({
    snapshot: {
      scene: async (options) => session.exportScene(id, options),
      release: () => session.endExportSnapshot(id),
    },
    surface: 'simulator',
    title: 'Export view',
    fileStem: 'x',
    exportStyle,
    pins: null,
  });
  try {
    const rows = paperPresetRows([]);
    const draft = paperExportDraft(
      { ...DEFAULT_PAPER_EXPORT_SETTINGS, ...page },
      { format: 'svg' },
      rows
    );
    const style = paperExportStyle(target, draft.style, rows);
    const scene = await createPaperExportSession(target).scene(
      paperExportSceneInput(target, style, draft)
    );
    if (!scene) throw new Error('expected a scene');
    return paintPaperExport(target, scene, style, paperExportPage(target, draft));
  } finally {
    target.release();
  }
}

describe('the export dialog’s page of a simulation', () => {
  it('is the picture the retired exportSvg wrote, sized across the figure', async () => {
    // `simulatorExportGolden.json` was written by `exportSvg` before it was
    // retired, from exactly this session and these two requests. The sized
    // page was repainted when a simulation's size came to measure the model
    // rather than its unfolded sheet — at 120 mm the drawing's longer side is
    // now 120 mm — and the default one when "as shown" went and every page
    // became a size in mm: it is 60 mm across. Only the scale moved. Both were
    // repainted again when a crease's pieces came to join where they meet:
    // a solid fold's links are drawn round, and a sliver shorter than its own
    // width, which round would make a blob, is left to its neighbours.
    const session = createSimulatorSession();
    const info = session.load(miura(6, 6), {});
    session.setFoldPercent(60);
    await frame(session.settle(3000, {}));
    await session.setCamera(
      { view: { yaw: 0.8, pitch: -0.6, zoom: 1.2 }, width: 640, height: 480 },
      info.token
    );

    // The styles as they were when it was written: the fold pens dashed, as the
    // Default preset had them then — the diagram-crease pens carry those dashes
    // now — and the Default drawing a simulation's folds as edges.
    const writtenWith = (style: PaperStyle): PaperStyle => ({
      ...style,
      mountainFolds: { ...style.mountainFolds, dash: DEFAULT_PAPER_STYLE.mountainDiagramCreases.dash },
      valleyFolds: { ...style.valleyFolds, dash: DEFAULT_PAPER_STYLE.valleyDiagramCreases.dash },
    });
    const defaults = await dialogPage(
      session,
      info.token,
      { ...writtenWith(DEFAULT_PAPER_STYLE), foldsAsEdges: true },
      DEFAULT_PAPER_PAGE
    );
    const custom = await dialogPage(
      session,
      info.token,
      writtenWith(EXPORT_STYLE),
      { sheet: { mm: 120 }, paddingMm: 12, background: '#223344', keepHiddenFaces: false },
      2
    );

    expect(defaults).toEqual(golden.defaults);
    expect(custom).toEqual(golden.custom);
    // 120 mm across the model's longer side, inside two 12 mm margins.
    expect(Math.max(custom.widthPt, custom.heightPt) / PT_PER_MM - 2 * 12).toBeCloseTo(120, 6);
    session.dispose();
  }, 30_000);
});

describe('sheetExtent', () => {
  it('is the longest axis span of the unfolded sheet', () => {
    expect(sheetExtent(new Float32Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]))).toBe(2);
    expect(sheetExtent(new Float32Array([-1, -3, 0, 1, 3, 0]))).toBe(6);
  });

  it('ignores a non-finite coordinate and is zero for a point or nothing', () => {
    expect(sheetExtent(new Float32Array([0, 0, 0, Number.NaN, 5, 0]))).toBe(5);
    expect(sheetExtent(new Float32Array([1, 1, 1]))).toBe(0);
    expect(sheetExtent(new Float32Array())).toBe(0);
  });
});

describe('widestPenCssPx', () => {
  it('is the widest drawn pen at 4/3 px per pt, counting the aux pen only when shown', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      edges: { ...DEFAULT_PAPER_STYLE.edges, width: 1 },
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width: 2 },
      valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, width: 0.5 },
      auxCreases: { visible: false, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, width: 3 } },
    };
    expect(widestPenCssPx(style)).toBeCloseTo(2 * PT_TO_CSS_PX, 9);
    expect(
      widestPenCssPx({ ...style, auxCreases: { ...style.auxCreases, visible: true } })
    ).toBeCloseTo(3 * PT_TO_CSS_PX, 9);
  });
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
    auxEnds: new Uint8Array([0]).buffer,
    center: [0, 0, 0] as [number, number, number],
    radius: 1,
    sheet: 1,
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
        edgeWidthPx: 3,
        mountainWidthPx: 3,
        valleyWidthPx: 3,
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

/**
 * What a new session looks through. A load carries the most recent session's
 * camera and palette forward, which covers a model replacing a live one and
 * nothing else: a session released before its replacement loads leaves nothing
 * to carry, and the replacement opened on the worker's defaults — the blue
 * front colour a refresh used to produce. The caller can now say what to open
 * on, and that answer outranks the carry-over.
 */
describe('the view a new session opens on', () => {
  const camera = { view: { yaw: 0.8, pitch: -0.6, zoom: 1.2 }, width: 640, height: 480 };
  const OPENING_SETTINGS: RenderSettings = { ...DEFAULT_EXPORT_SETTINGS, showEdges: false };

  it('opens on the view it is given', async () => {
    const session = createSimulatorSession();
    const info = session.load(miura(4, 4), { view: { camera, settings: OPENING_SETTINGS } });
    await frame(session.settle(2000, { token: info.token }));

    const opened = exportView(session, { token: info.token })!.svg;
    // Faces only, as the framing it was handed says, at the camera it was
    // handed — the same document as pushing both after the fact. (Re-pinned
    // from the mountain colour: the look now comes from the style, so the
    // framing is what the opening settings still decide.)
    expect(opened).not.toContain('<line');
    await session.setCamera(camera, info.token);
    await session.setRenderSettings(OPENING_SETTINGS, info.token);
    expect(exportView(session, { token: info.token })!.svg).toBe(opened);
    session.dispose();
  }, 30_000);

  it('opens on the given view even with nothing to carry from', async () => {
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    await session.setCamera(camera, first.token);
    await session.setRenderSettings(OPENING_SETTINGS, first.token);
    // Released before the replacement loads: the gap a rebuild passes through.
    session.release(first.token);

    const second = session.load(miura(4, 4), { view: { camera, settings: OPENING_SETTINGS } });
    await frame(session.settle(2000, { token: second.token }));
    const svg = exportView(session, { token: second.token })!.svg;
    expect(svg).not.toContain('<line');

    // And without the answer, the same gap really does fall back to defaults —
    // which is the case the runtime exists to close.
    session.release(second.token);
    const third = session.load(miura(4, 4), {});
    await frame(session.settle(2000, { token: third.token }));
    expect(exportView(session, { token: third.token })!.svg).toContain('<line');
    session.dispose();
  }, 30_000);

  it('still carries the most recent session forward when not told otherwise', async () => {
    const session = createSimulatorSession();
    const first = session.load(miura(4, 4), {});
    await session.setCamera(camera, first.token);
    await session.setRenderSettings(OPENING_SETTINGS, first.token);

    const second = session.load(miura(4, 4), {});
    await frame(session.settle(2000, { token: second.token }));
    expect(exportView(session, { token: second.token })!.svg).not.toContain('<line');
    session.dispose();
  }, 30_000);
});
