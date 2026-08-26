import { transfer } from 'comlink';
import { PreparedModelCache } from '../lib/preparedModelCache';
import type { SimulatorExportBackground } from '../lib/simulatorSettings';
import { MAX_CONCURRENT_SIMULATIONS, MAX_LIVE_FOLDED_MESHES } from './simulatorLimits';
import {
  FOLDED_3D_REQUIRED_DEPTH_BITS,
  FoldedMeshSource,
  type Folded3dMeshPayload,
} from './foldedMeshSource';
import {
  GlCore,
  OrigamiModel,
  ReferenceSolver,
  SimulationClock,
  WebglSolver,
  cameraUniforms,
  centroid,
  boundingRadius,
  glContextAttributeOverrides,
  meshTopologyFor,
  prepareFoldModel,
  renderMeshToSvg,
  setGlContextAttributeOverrides,
  type CameraUniforms,
  type GlContextAttributeOverrides,
  type FoldDocument,
  type FoldProfile,
  type OrbitView,
  type PrepareFoldOptions,
  type RenderSettings,
  type SimulatorDiagnostics,
  type SimulatorOptions,
  type SolverBackend,
  type SvgRenderResult,
} from '@treemaker/origami-simulator';

// The simulator's solver, off the main thread.
//
// Before this, the whole simulation ran inside requestAnimationFrame on the
// main thread with a fixed step count, so a single play tick on a 1089-vertex
// model took ~780ms and the tab stopped responding. The solver is not faster
// here -- that is the GPU port's job -- but it no longer competes with the UI,
// which is the difference between "slow" and "frozen".
//
// Control flows over comlink like every other worker in this app. Frame data
// does not: positions move as transferable ArrayBuffers that the caller hands
// back for reuse, so a 60fps loop performs no allocation and no structured
// clone. Deliberately NOT a SharedArrayBuffer ring -- see the plan; the GPU
// backend removes this transport entirely, so it only ever serves the
// no-WebGL2 fallback and simple is the right trade.

export type SimulatorBackendId = 'webgl2' | 'reference';

export interface SimulatorLoadOptions {
  prepare?: PrepareFoldOptions;
  solver?: SimulatorOptions;
  /** Solver milliseconds per tick. Higher than the main thread could afford. */
  budgetMs?: number;
  convergenceEpsilon?: number;
  /** Force the CPU reference backend (debugging, or a known-bad driver). */
  preferGpu?: boolean;
  /** GPU steps per tick (bounds async GPU work; overrides the default). */
  gpuStepsPerTick?: number;
  /**
   * Stable identity of this fold, so re-loading it skips `prepareFoldModel`.
   *
   * Switching the focused inline window means loading its model again, and
   * preparation is the expensive part — triangulation, edge indexing, crease
   * params — where stepping the solver afterwards is not. Omit it and every load
   * prepares from scratch, which is right for a source that actually changed.
   */
  modelKey?: string;
}

/**
 * Steps per GPU tick. Small enough that one tick's shader passes finish well
 * inside a frame (so the convergence readback barely stalls), large enough that
 * the fold still converges in well under a second at 60 ticks/s.
 */
const GPU_STEPS_PER_TICK = 80;

/** Orbit view + viewport + look, forwarded from the panel for worker-side rendering. */
export interface SimulatorCamera {
  view: OrbitView;
  /** Drawing-buffer size in device pixels. */
  width: number;
  height: number;
}

/**
 * Everything the render side needs about topology, as flat typed arrays.
 *
 * The worker owns the prepared model now, so the main thread cannot reach into
 * it. Rather than ship a structured clone of arrays-of-arrays (which for a
 * 19k-edge model is tens of thousands of tiny objects), topology crosses once
 * at load as transferable buffers and is inflated on the other side.
 */
export interface SimulatorModelInfo {
  vertexCount: number;
  faceCount: number;
  edgeCount: number;
  creaseCount: number;
  /** Triangle indices, 3 per face. */
  indices: ArrayBuffer;
  /** 2 vertex indices per edge. */
  edgesVertices: ArrayBuffer;
  /** One {@link EDGE_ASSIGNMENT_CODES} index per edge. */
  edgesAssignment: ArrayBuffer;
  /** 3 edge indices per (triangulated) face; -1 where an edge was not found. */
  facesEdges: ArrayBuffer;
  diagnostics: SimulatorDiagnostics;
  /** Which solver actually got selected, for the UI's backend indicator. */
  backend: SimulatorBackendId;
  /** Quote this on later calls; see {@link SimulatorSessionToken}. */
  token: SimulatorSessionToken;
}

/** Index -> FOLD assignment letter, shared with the render side. */
export const EDGE_ASSIGNMENT_CODES = ['B', 'M', 'V', 'F', 'U', 'C', 'J'] as const;

export interface SimulatorFramePayload {
  /**
   * xyz per vertex. Transferred; hand it back via `recycled` to avoid churn.
   * Null in GPU-render mode — the worker drew straight to the canvas and the
   * main thread needs no positions.
   */
  positions: ArrayBuffer | null;
  /** rgb per vertex, only present when colours were requested. */
  colors: ArrayBuffer | null;
  /** True when the worker rendered this frame itself (GPU-render mode). */
  renderedInWorker: boolean;
  /**
   * The rendered frame, in bitmap-present mode. Transferred; the caller hands it
   * to a `bitmaprenderer` canvas. Null when the worker drew straight to a
   * transferred canvas, or when there was nothing to draw.
   */
  bitmap: ImageBitmap | null;
  step: number;
  stepsThisTick: number;
  elapsedMs: number;
  converged: boolean;
  maxVelocity: number;
  foldPercent: number;
  /**
   * Peak per-node mean axial strain for this frame, as a fraction. Computed once
   * per frame rather than per step, and defined identically on both backends so
   * the readout does not change meaning with the solver.
   */
  maxStrain: number;
}

/** Folded geometry snapshot handed to the exporters. */
export interface SimulatorExportGeometry {
  /** xyz per vertex, in the solver's normalized (centered, unit-radius) space. */
  positions: ArrayBuffer;
  /** 3 vertex indices per triangle. */
  triangles: ArrayBuffer;
  vertexCount: number;
  /** Fold percent the snapshot was taken at, for the exported file's metadata. */
  foldPercent: number;
}

interface Session {
  model: OrigamiModel;
  backend: SolverBackend;
  backendId: SimulatorBackendId;
  clock: SimulationClock;
  positionScratch: Float32Array;
  colorScratch: Float32Array;
  foldPercent: number;
  /** How this model is being looked at — see {@link SessionView}. */
  view: SessionView;
  /**
   * Present only when the panel transferred its canvas and the GPU solver was
   * selected: the solver renders straight to that canvas in the worker, so no
   * positions are transferred to the main thread. Absent means the panel draws
   * on the main thread from transferred positions (canvas-2D fallback).
   */
  gpuRender: WebglSolver | null;
  /**
   * When this session was last spoken to, on a monotonic counter. Eviction picks
   * the least recently *used*, not the oldest loaded — with twenty windows open,
   * the oldest is simply the one placed first, which is as likely as any other to
   * be the one being looked at.
   */
  lastUsed: number;
}

/**
 * How a session is being looked at: the orbit camera, the frame it is drawn
 * into, the appearance the viewport asked for, and the model's own framing.
 *
 * Deliberately on {@link Session} rather than on the GPU renderer, even though
 * only the GPU path draws from it here. It is a property of the *view*, not of
 * whichever renderer happens to be attached — and a session that does not know
 * how it is being looked at cannot answer a question like "export this view",
 * which is exactly what happened on the canvas-2D path: `setCamera` and
 * `setRenderSettings` used to bail out early there, so the worker never learned
 * the camera at all. A fold profile forces that path even on a GPU machine.
 */
interface SessionView {
  view: OrbitView;
  /** Drawing-buffer size in device pixels. */
  width: number;
  height: number;
  settings: RenderSettings;
  /** Camera fit, computed once from the settled model. */
  center: [number, number, number];
  radius: number;
  fitted: boolean;
  /**
   * When this view last actually drew, so the shared buffer can be sized from
   * the windows in use rather than from every window that exists.
   *
   * `-Infinity` until the first render: a window that has never drawn has no
   * claim on the buffer's size.
   */
  lastRenderedAt: number;
}

const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  frontColor: [0.31, 0.51, 0.84],
  backColor: [0.95, 0.94, 0.9],
  mountainColor: [0.86, 0.12, 0.14],
  valleyColor: [0.11, 0.36, 0.85],
  borderColor: [0.16, 0.18, 0.2],
  lightDir: [-0.45, 0.58, 0.68],
  background: [0.05, 0.06, 0.07],
  showFaces: true,
  showEdges: true,
  lighting: true,
  creaseWidthPx: 3,
  faceAlpha: 1,
};

/**
 * Identifies one loaded model, handed back by `load` and quoted by every later
 * call.
 *
 * The worker holds a single live session, and more than one consumer can ask it
 * to load: the Simulate panel, and any of the inline simulation windows on the
 * Edit canvas. Those calls are asynchronous, so a `tick` dispatched by the
 * window that just lost focus can arrive after its successor has loaded — and
 * would otherwise be answered with the *new* model's geometry, which the caller
 * would happily draw into the old window. Quoting a token makes that arrival
 * identifiable, and it is dropped instead.
 */
export type SimulatorSessionToken = number;

/**
 * Every loaded model, newest last. Keyed by the token `load` handed back.
 *
 * Originally there was one. That was enough while an unfocused inline simulation
 * only ever had to hold still: it kept the last frame its canvas received, which
 * costs nothing. But the crease-pattern camera keeps moving underneath it — pan
 * and zoom resize the window — and a bitmap rendered for the old size is then
 * scaled, so the fold goes soft when zoomed in and its creases go to threads
 * when zoomed out.
 *
 * Re-rendering needs the mesh, and the mesh lives in solver textures, so the
 * sessions have to stay. They are cheap to keep and cheap to draw: bitmap
 * presentation means they share a single GL context, and a settled model spends
 * no solver budget. Only the focused window ticks; the rest cost a draw when the
 * camera moves them, which is the whole point.
 */
const sessions = new Map<SimulatorSessionToken, Session>();
let sessionToken: SimulatorSessionToken = 0;
/** Ticks on every session access, so eviction can order by use. */
let useCounter = 0;

/**
 * How many models stay resident.
 *
 * One per open window, plus one. The `+ 1` is the reload overlap: a runtime
 * replacing its model loads the new session *before* releasing the old, so that
 * its window is never briefly backed by nothing — which means a full house
 * momentarily needs one slot more than there are windows. Without the spare,
 * every reload at the cap evicted somebody, and the victim was a window still on
 * screen.
 *
 * Nothing should be evicted in practice. When something is, the owner reloads on
 * its next tick (see `useSimulatorRuntime`) rather than freezing — but that is a
 * recovery path, and a cap that keeps needing it is a cap that is too small.
 */
const MAX_LIVE_SESSIONS = MAX_CONCURRENT_SIMULATIONS + 1;

/**
 * Every 3D folded figure the worker can draw, keyed by its own token.
 *
 * Deliberately **not** in {@link sessions}, and the separation is load-bearing
 * rather than tidy. `load` seeds a new simulation's camera and render settings
 * from `latestSession()?.view`, so a folded figure in that map would make the
 * next simulation open at the figure's viewpoint and colours. And
 * `evictBeyondCap` would let figures evict a live window's *solver*, which loses
 * the fold position the user scrubbed to.
 *
 * The asymmetry runs the other way too, which is why a separate cap is right
 * rather than a shared one: evicting a solver session loses state the user
 * created, so the UI refuses past `MAX_CONCURRENT_SIMULATIONS`. Evicting a mesh
 * loses nothing at all — it is pure derived data, rebuilt by one upload — so
 * eviction here needs no cooperating UI constant, which is exactly the
 * two-numbers-held-equal-by-a-comment failure the inline-simulation plan records.
 */
const meshes = new Map<Folded3dMeshToken, MeshSession>();
let meshToken: Folded3dMeshToken = 0;

/**
 * Identifies one loaded folded-figure mesh. A separate space from
 * {@link SimulatorSessionToken}: the two are never accepted by the same call, so
 * a number from one can never be read as the other.
 */
export type Folded3dMeshToken = number;

interface MeshSession {
  source: FoldedMeshSource;
  view: SessionView;
  lastUsed: number;
}

export interface Folded3dMeshInfo {
  token: Folded3dMeshToken;
  /**
   * Depth bits of the default framebuffer. The layer displacement assumes 24;
   * reported rather than assumed so 16 fails loudly instead of as unexplained
   * shimmer on deep stacks. See `folded3dMesh.ts`.
   */
  depthBits: number;
  /** True when {@link depthBits} is below what the displacement was budgeted for. */
  shallowDepthBuffer: boolean;
}

/** One drawn frame. `null` from a call means the token is no longer known. */
export interface Folded3dMeshFrame {
  bitmap: ImageBitmap | null;
}

/**
 * Anything {@link renderGpu} can draw: a solver session, or a static folded mesh.
 *
 * Two members, both of which `WebglSolver` already has. Widening to this is what
 * lets a folded figure reuse the sizing, viewport-fit and Y-flipped crop below
 * it — every line of which is there because the inline-simulation work measured
 * what happens without it — with no change at all to the simulation path.
 */
interface MeshRenderSource {
  readonly drawingBufferSize: { width: number; height: number };
  render(
    camera: CameraUniforms,
    settings: RenderSettings,
    target?: WebGLFramebuffer | null
  ): void;
}

/** The most recently loaded session, for callers with no token to quote. */
function latestSession(): Session | null {
  let latest: Session | null = null;
  for (const candidate of sessions.values()) latest = candidate;
  return latest;
}

function disposeSession(token: SimulatorSessionToken): void {
  const existing = sessions.get(token);
  if (!existing) return;
  existing.backend.dispose();
  sessions.delete(token);
}

/**
 * Uniformly scale a fold into a unit box before it reaches the solver.
 *
 * The GPU solver is float32 end to end — positions, velocities, and the
 * `readPixels` convergence readback — while `SimulationClock` tests convergence
 * as an **absolute** `maxVelocity < 1e-5`. Those two only coexist near unit
 * scale. At an Oriedita document's own coordinates a sheet runs to ~3900 units,
 * where the float32 step is ~2.4e-4: a velocity of 1e-5 is smaller than the
 * gap between representable positions, so the model can never be *observed* to
 * settle however still it is. Every settle then runs to its 20,000-step cap with
 * a pipeline-stalling readback every 20 steps — about half a second per region
 * switch, paid again on every visit because nothing converges to cache.
 *
 * This is why the crease pattern used to be normalized on import. It no longer
 * is: segmentation, region containment and canvas placement all have to agree
 * with the document's own coordinates, so the scaling belongs here, at the one
 * boundary that actually needs it. The solver only ever needs the shape —
 * `timeStepFor` derives its step from rest lengths, and the renderer fits its
 * own camera — so nothing downstream reads these numbers as document units.
 *
 * Aspect-preserving and translation-only otherwise, so folded geometry is
 * similar to the input rather than distorted.
 */
export function foldScaledForSolver(fold: FoldDocument): FoldDocument {
  const coords = fold.vertices_coords ?? [];
  if (coords.length === 0) return fold;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const coord of coords) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = coord[axis] ?? 0;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  const span = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  // Already unit-ish, or degenerate: leave it exactly alone rather than
  // introduce rounding for nothing.
  if (!Number.isFinite(span) || span <= 0 || (span > 0.5 && span <= 2)) return fold;

  return {
    ...fold,
    vertices_coords: coords.map((coord) => [
      ((coord[0] ?? 0) - min[0]!) / span,
      ((coord[1] ?? 0) - min[1]!) / span,
      ((coord[2] ?? 0) - min[2]!) / span,
    ]),
  };
}

/**
 * Drop the least recently used sessions until the cap is met.
 *
 * By use rather than by age: the map is insertion-ordered, so the first entry is
 * whichever window was opened first — no more likely to be idle than any other,
 * and quite likely the one being looked at. Whatever the user is working in has
 * just ticked, so it sorts last and is the final thing to go.
 */
function evictBeyondCap(): void {
  while (sessions.size > MAX_LIVE_SESSIONS) {
    let victim: SimulatorSessionToken | undefined;
    let oldestUse = Infinity;
    for (const [token, session] of sessions) {
      if (session.lastUsed < oldestUse) {
        oldestUse = session.lastUsed;
        victim = token;
      }
    }
    if (victim === undefined) break;
    disposeSession(victim);
  }
}

/**
 * Drop the least recently drawn meshes until the cap is met.
 *
 * Safe in a way {@link evictBeyondCap} is not: a mesh is derived entirely from a
 * render model the main thread still holds, so losing one costs a re-upload and
 * nothing else. The owner notices on its next draw — which answers `null` — and
 * loads it again.
 */
function evictMeshesBeyondCap(): void {
  while (meshes.size > MAX_LIVE_FOLDED_MESHES) {
    let victim: Folded3dMeshToken | undefined;
    let oldestUse = Infinity;
    for (const [token, mesh] of meshes) {
      if (mesh.lastUsed < oldestUse) {
        oldestUse = mesh.lastUsed;
        victim = token;
      }
    }
    if (victim === undefined) break;
    disposeMesh(victim);
  }
}

function disposeMesh(token: Folded3dMeshToken): void {
  const existing = meshes.get(token);
  if (!existing) return;
  existing.source.dispose();
  meshes.delete(token);
}

/** The mesh behind `token`, or null once it has been released or evicted. */
function meshFor(token: Folded3dMeshToken): MeshSession | null {
  const mesh = meshes.get(token) ?? null;
  if (mesh) mesh.lastUsed = ++useCounter;
  return mesh;
}

/**
 * Prepared models kept across loads, keyed by the caller's `modelKey`.
 *
 * Bounded, because a prepared model is the triangulated mesh plus its adjacency
 * — tens of megabytes on a large crease pattern — so an unbounded cache would
 * simply move the memory problem rather than solve it. Four is enough to make
 * alternating between a handful of open windows feel instant.
 */
const preparedModels = new PreparedModelCache(4);

/**
 * Set when the live session's GL context is lost, and cleared by the next
 * successful load.
 *
 * A lost context does not throw — GL calls become no-ops and reads return
 * zeros — so the solver would go on "converging" a flat, motionless mesh and the
 * panel would show a settled fold that is simply wrong. Failing every subsequent
 * call with this message routes it to the runtime's error state instead, which
 * is the only honest thing to show.
 */
let sessionFailure: string | null = null;

/**
 * The surface the GPU solver's context lives on, and how its frames get out.
 *
 * `'canvas'` — the caller transferred its own canvas via
 * `transferControlToOffscreen`. The worker draws straight to it and nothing
 * crosses back. One canvas can only be transferred once, so it is held here and
 * reused across model reloads.
 *
 * `'bitmap'` — the worker owns a private OffscreenCanvas and hands each frame
 * out as an ImageBitmap. This costs one transfer per frame, and buys the thing
 * inline windows need: **one** GL context serving any number of on-screen
 * surfaces, because the receiving canvases take a `bitmaprenderer` context,
 * which is not a WebGL context and so does not count against the four a worker
 * gets. Measured at 0.011ms per 512px frame — see `__simCapabilityProbe`.
 */
type PresentMode = 'canvas' | 'bitmap';

let renderCanvas: OffscreenCanvas | null = null;
let presentMode: PresentMode = 'canvas';

export interface PerfSnapshot {
  windowMs: number;
  backend: SimulatorBackendId;
  gpuRender: boolean;
  /** GPU draws issued this window (settle/tick + every setCamera/setRenderSettings). */
  renders: number;
  renderAvgMs: number;
  renderMaxMs: number;
  /** Reallocating the shared drawing buffer. Near zero once it has grown. */
  resizeAvgMs: number;
  /** Issuing the GL commands — the actual drawing. */
  drawAvgMs: number;
  /**
   * `createImageBitmap` — cropping the frame out of the shared canvas.
   *
   * The cost that does not have to scale with the window: a browser able to copy
   * a sub-rect on the GPU charges for the crop, one that cannot snapshots the
   * whole drawing buffer. Compare against {@link PerfSnapshot.canvas}.
   */
  snapshotAvgMs: number;
  snapshotMaxMs: number;
  /** Device-pixel size the window asked for, uncapped. */
  request: { width: number; height: number };
  /**
   * The largest size *any* live session or mesh currently wants — what the
   * buffer is actually sized from.
   *
   * Separate from {@link PerfSnapshot.request}, which is only the window that
   * drew last, because the two answer different questions and the gap between
   * them is the interesting part: a small `request` against a large `canvas`
   * says the buffer is being held up by something, and only this says by how
   * much and therefore whether the shrink policy is wrong or is being fed a
   * stale size by a window that is not drawing.
   */
  peak: { width: number; height: number };
  /** The shared, grow-only render canvas. */
  canvas: { width: number; height: number };
  /** What GL actually backed it with, which the browser may clamp. */
  buffer: { width: number; height: number };
  /** The sub-rect actually rendered and cropped out. */
  crop: { width: number; height: number };
  /** setCamera calls this window — the orbit/zoom message rate. */
  cameraCalls: number;
  /** Solver ticks (budgeted frames) this window. */
  ticks: number;
  /** Models resident in the worker. Only the focused one ticks; the rest draw. */
  liveSessions: number;
  /**
   * Folded-figure meshes resident in the worker.
   *
   * A separate field rather than folded into `liveSessions`, because the two
   * cost different things: a session is a solver, a mesh is three textures and
   * two programs. `renders` and `renderAvgMs` above *do* count both, since they
   * are draws on one shared context and splitting them would misreport what that
   * context is doing.
   */
  liveMeshes: number;
  solveAvgMs: number;
  solveMaxMs: number;
  stepsTotal: number;
}

/** Distribution of one timing series, in ms. */
export interface GlBenchStat {
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/**
 * One arm of the context-attribute experiment.
 *
 * Carries the sizes as well as the timings, because a result is only meaningful
 * against the buffer it was measured at — and the sizes are what prove the arms
 * were comparable rather than accidentally measured at different buffers.
 */
export interface GlBenchResult {
  /**
   * Fraction of the frame that was actually painted, 0 to 1.
   *
   * The honesty check. A blank frame is fast, so timings alone can rank a
   * configuration that renders nothing as the winner — see `measureCoverage`.
   */
  coverage: number;
  attributes: { antialias: boolean; preserveDrawingBuffer: boolean };
  frames: number;
  request: { width: number; height: number };
  canvas: { width: number; height: number };
  buffer: { width: number; height: number };
  crop: { width: number; height: number };
  draw: GlBenchStat;
  /** `createImageBitmap`. Watched as closely as `draw`: a change that merely
   * moves cost from one to the other is not a win, and only the pair can tell. */
  snapshot: GlBenchStat;
  /** Reallocating the shared buffer — the price of sizing it to the caller. */
  resize: GlBenchStat;
  /** Wall time for the whole render call — the number that has to come down. */
  total: GlBenchStat;
}

/**
 * Fraction of the cropped frame that actually got painted, 0 to 1.
 *
 * A timing harness cannot see the failure mode this codebase has already been
 * bitten by: when the drawing buffer is larger than the browser will back, GL
 * reports no error, `isContextLost()` stays false, and `createImageBitmap`
 * hands back a fully transparent image. Every window blanks at once and every
 * measurement looks fine, because drawing nothing is fast.
 *
 * So a bench that only reports milliseconds can award first place to a
 * configuration that renders nothing at all. This is the guard: any arm whose
 * coverage is zero produced no pixels and its timings mean nothing.
 */
async function measureCoverage(source: MeshRenderSource, state: SessionView): Promise<number> {
  const bitmap = await renderGpu(source, state);
  if (!bitmap) return 0;
  try {
    const probe = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = probe.getContext('2d');
    if (!context) return 0;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let painted = 0;
    // Every 64th pixel: this runs once per arm, and a blank frame is blank
    // everywhere, so a full scan of four megapixels buys nothing.
    for (let i = 3; i < data.length; i += 4 * 64) {
      if (data[i]! > 0) painted += 1;
    }
    return painted / Math.max(1, Math.ceil(data.length / (4 * 64)));
  } finally {
    bitmap.close();
  }
}

function summarise(samples: readonly number[]): GlBenchStat {
  if (!samples.length) return { p50: 0, p95: 0, max: 0, mean: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1] ?? 0,
    mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
  };
}

// Cheap counters, always on (a few adds per op). getPerfStats() reads and
// resets them; the runtime only polls when the debug flag is set.
const ZERO_SIZE = { width: 0, height: 0 };

const perf = {
  windowStart: 0,
  renders: 0,
  renderTotalMs: 0,
  renderMaxMs: 0,
  // The three phases of a render, which the total cannot tell apart. See
  // `renderGpu`.
  resizeTotalMs: 0,
  drawTotalMs: 0,
  snapshotTotalMs: 0,
  snapshotMaxMs: 0,
  cameraCalls: 0,
  ticks: 0,
  solveTotalMs: 0,
  solveMaxMs: 0,
  stepsTotal: 0,
  // Sizes from the most recent render, not aggregates: they are step functions
  // that hold for long stretches, and what matters is the value in force.
  lastRequest: ZERO_SIZE as { width: number; height: number },
  lastCanvas: ZERO_SIZE as { width: number; height: number },
  lastBuffer: ZERO_SIZE as { width: number; height: number },
  lastCrop: ZERO_SIZE as { width: number; height: number },
};

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function resetPerf(at: number): void {
  perf.windowStart = at;
  perf.renders = 0;
  perf.renderTotalMs = 0;
  perf.renderMaxMs = 0;
  perf.resizeTotalMs = 0;
  perf.drawTotalMs = 0;
  perf.snapshotTotalMs = 0;
  perf.snapshotMaxMs = 0;
  perf.cameraCalls = 0;
  perf.ticks = 0;
  perf.solveTotalMs = 0;
  perf.solveMaxMs = 0;
  perf.stepsTotal = 0;
  // Deliberately not the `last*` sizes: they describe the state the next window
  // starts in, and zeroing them would blank the readout between renders.
}

function requireSession(): Session {
  if (sessionFailure) throw new Error(sessionFailure);
  const latest = latestSession();
  if (!latest) throw new Error('Simulator worker: no model loaded');
  return latest;
}

/**
 * The live session, or null when `token` refers to one that has been replaced.
 *
 * Callers that quote a stale token get a no-op rather than an error: being
 * superseded is the normal outcome of moving focus between inline windows, not a
 * fault worth surfacing.
 */
function sessionFor(token: SimulatorSessionToken | undefined): Session | null {
  if (sessionFailure) throw new Error(sessionFailure);
  const session = token === undefined ? latestSession() : sessions.get(token) ?? null;
  if (session) session.lastUsed = ++useCounter;
  return session;
}

/**
 * Pick the solver backend.
 *
 * When the panel transfers its canvas (`renderCanvas`) and the model uses the
 * standard uniform fold target, the GPU solver runs *on that canvas* and renders
 * to it in the worker — positions never touch the CPU. A fold profile (our
 * addition, which the GPU path does not express), a Verlet request,
 * `preferGpu: false`, or no canvas / no WebGL2 falls back to the reference
 * solver with main-thread canvas-2D rendering.
 */
function createBackend(
  model: OrigamiModel,
  options: SimulatorLoadOptions,
  renderCanvas: OffscreenCanvas | null
): { backend: SolverBackend; backendId: SimulatorBackendId; gpuSolver: WebglSolver | null } {
  const solverOptions = options.solver ?? {};
  const hasFoldProfile = Boolean(solverOptions.foldProfile?.ranges?.length);

  // Verlet used to force the CPU backend; the GPU solver implements it now, so
  // only a fold profile (segment/sequence-step simulation) still needs the
  // reference solver.
  if (renderCanvas && options.preferGpu !== false && !hasFoldProfile) {
    try {
      if (WebglSolver.isSupported(renderCanvas)) {
        const solver = new WebglSolver(renderCanvas, model, solverOptions);
        solver.onContextLost(() => {
          sessionFailure =
            'The graphics context was lost, so the simulation stopped. Reload the model to restart it.';
        });
        return { backend: solver, backendId: 'webgl2', gpuSolver: solver };
      }
    } catch {
      // Any GPU setup failure (driver bug, lost context) falls through to the
      // reference solver rather than breaking the simulator.
    }
  }
  return {
    backend: new ReferenceSolver(model, solverOptions),
    backendId: 'reference',
    gpuSolver: null,
  };
}

/**
 * Reuse the caller's returned buffer when it is the right size, otherwise
 * allocate. Steady state performs zero allocation; a resize costs one.
 */
function scratchFrom(recycled: ArrayBuffer | undefined, floats: number): Float32Array {
  if (recycled && recycled.byteLength === floats * 4) return new Float32Array(recycled);
  return new Float32Array(floats);
}

const api = {
  /**
   * Set the GL context attributes the *next* context will be created with.
   *
   * Only meaningful before a context exists, which in practice means before the
   * first `load` or `attachBitmapOutput`. Exists so `glBench` can cross
   * `antialias` against `preserveDrawingBuffer` on the real render path instead
   * of on a replica of it — see {@link GlContextAttributeOverrides}.
   */
  configureGl(overrides: GlContextAttributeOverrides): void {
    setGlContextAttributeOverrides(overrides);
  },

  /**
   * Render one fixed camera N times and report the distribution.
   *
   * The whole point is that it takes no gesture and no animation frame: the
   * cost under investigation is per-render, so N sequential renders measure it
   * exactly, and a scripted loop pins the camera, the buffer and the crop that a
   * hand-driven orbit would drift. It also bypasses the main thread's camera
   * coalescing by construction — that lives in the runtime hook, and this talks
   * to the session directly, so N calls really are N renders.
   *
   * Percentiles rather than a mean: the suspected cost may be charged on only
   * some frames, and an average would smear that into something that merely
   * looks like a uniformly slower renderer.
   */
  async glBench(options: {
    token?: SimulatorSessionToken;
    frames: number;
    warmup: number;
    /** Device-pixel size to request per render — what the window would ask for. */
    request: { width: number; height: number };
    /**
     * Alternate with a second size every frame.
     *
     * The worst case for sizing the buffer from the caller rather than from the
     * peak across windows: two windows in different quantisation buckets take
     * turns, so every render reallocates. Phase 1 rejected caller-sizing on
     * exactly this, before the standing cost of an oversized buffer was known —
     * so it is the trade that has to be re-priced, not re-argued.
     */
    alternateWith?: { width: number; height: number };
  }): Promise<GlBenchResult | null> {
    const active = sessionFor(options.token);
    const source = active?.gpuRender;
    if (!active || !source) return null;
    // Pinned rather than inherited: buffer size follows the largest request
    // across every live session, so leaving it to whatever the window last
    // reported is the one confound that would invalidate the comparison.
    active.view.width = options.request.width;
    active.view.height = options.request.height;

    const draw: number[] = [];
    const snapshot: number[] = [];
    const resize: number[] = [];
    const total: number[] = [];

    for (let frame = 0; frame < options.warmup + options.frames; frame += 1) {
      if (options.alternateWith) {
        const size = frame % 2 === 0 ? options.request : options.alternateWith;
        active.view.width = size.width;
        active.view.height = size.height;
      }
      const before = {
        draw: perf.drawTotalMs,
        snapshot: perf.snapshotTotalMs,
        resize: perf.resizeTotalMs,
      };
      const started = nowMs();
      // Straight at `renderGpu`, so this covers exactly the path a camera
      // message takes and nothing else.
      const bitmap = await renderGpu(source, active.view);
      const elapsed = nowMs() - started;
      // Closed immediately. 200 uncollected 2048-square bitmaps is gigabytes,
      // and the GC pressure would land inside the thing being measured.
      bitmap?.close();
      if (frame < options.warmup) continue;
      draw.push(perf.drawTotalMs - before.draw);
      snapshot.push(perf.snapshotTotalMs - before.snapshot);
      resize.push(perf.resizeTotalMs - before.resize);
      total.push(elapsed);
    }

    const buffer = source.drawingBufferSize;
    const crop = fitRenderWithin(active.view, buffer);
    return {
      coverage: await measureCoverage(source, active.view),
      attributes: glContextAttributeOverrides(),
      frames: options.frames,
      request: { ...options.request },
      canvas: renderCanvas
        ? { width: renderCanvas.width, height: renderCanvas.height }
        : { width: 0, height: 0 },
      buffer: { width: buffer.width, height: buffer.height },
      crop,
      draw: summarise(draw),
      snapshot: summarise(snapshot),
      resize: summarise(resize),
      total: summarise(total),
    };
  },

  /**
   * Whether this worker can actually render on the GPU.
   *
   * The question has to be asked *here*, because the answer differs by thread.
   * The main thread's `webglRenderSupported()` probes a `document` canvas, and on
   * WebKitGTK that says yes while a worker's OffscreenCanvas says no — so the
   * caller committing a canvas on the main-thread answer hands it to a renderer
   * that will never draw. The commitment is irreversible either way it is made
   * (`transferControlToOffscreen` puts the element in placeholder mode;
   * `bitmaprenderer` is exclusive), so the canvas-2D fallback then cannot touch
   * its own canvas: it throws `InvalidStateError` on the transferred one and
   * silently draws nothing on the bitmap one.
   *
   * Runs the same `GlCore.create` predicate `createBackend` does rather than a
   * lookalike, so the probe and the real path cannot drift apart.
   *
   * The context is explicitly released, not left to GC. Four per worker is the
   * whole budget, and a probe that kept one would evict a live session — the
   * same discipline `webglRenderSupported` follows on the main thread.
   */
  probeGpuRender(): boolean {
    if (typeof OffscreenCanvas === 'undefined') return false;
    try {
      const core = GlCore.create(new OffscreenCanvas(1, 1));
      if (!core) return false;
      core.dispose();
      core.gl.getExtension('WEBGL_lose_context')?.loseContext();
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Transfer a caller-owned canvas to the worker, once. The solver renders
   * straight to it and no pixels cross back.
   */
  attachCanvas(canvas: OffscreenCanvas): void {
    renderCanvas = canvas;
    presentMode = 'canvas';
  },

  /**
   * Render into a worker-private canvas and hand each frame back as an
   * ImageBitmap, instead of drawing to a transferred one.
   *
   * This is what lets many on-screen surfaces share a single GL context: the
   * receiving canvases hold `bitmaprenderer` contexts, which do not count
   * against the four WebGL contexts a worker is allowed. Resizing reuses the
   * same canvas, so switching size does not churn the context.
   */
  attachBitmapOutput(width: number, height: number): void {
    if (renderCanvas && presentMode === 'bitmap') {
      // Grow-only, like every other size request in this mode — see
      // {@link sizeRenderCanvas}. Shrinking here would hand the reallocation
      // back on the next window that wants the larger size.
      sizeRenderCanvas(width, height);
      return;
    }
    renderCanvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    presentMode = 'bitmap';
  },

  load(fold: FoldDocument, options: SimulatorLoadOptions = {}): SimulatorModelInfo {
    // Carry the panel's camera and render settings across reloads. The panel
    // only pushes them when the GPU path first turns on, so a plain reset here
    // would make every segment switch snap back to the default view and the
    // default (blue) front colour until the next user interaction. Only the fit
    // (center/radius) is model-specific and recomputed by refitOnce.
    // Carried from the most recent session, not from one being replaced: a load
    // no longer displaces anything, so this is only about a new model opening
    // with the camera and palette already in use rather than the defaults.
    const previous = latestSession()?.view;
    // A fresh load gets a fresh context, so a previous loss is no longer the
    // truth about this session.
    sessionFailure = null;
    sessionToken += 1;

    // Scaled first — see `foldScaledForSolver`.
    //
    // prepareFoldModel runs here rather than on the main thread: it is O(n)
    // heavy (earcut triangulation, edge indexing) and used to block the UI
    // before a single solver step had run. Prepared models are immutable, so a
    // keyed one is safe to share between loads; solver state is not cached and a
    // fresh backend is always built, so no fold state leaks across a switch.
    const prepareOptions = options.prepare ?? { triangulate: true };
    const prepared = options.modelKey
      ? preparedModels.get(options.modelKey, () =>
          prepareFoldModel(foldScaledForSolver(fold), prepareOptions)
        )
      : prepareFoldModel(foldScaledForSolver(fold), prepareOptions);
    const model = new OrigamiModel(prepared);
    const { backend, backendId, gpuSolver } = createBackend(model, options, renderCanvas);
    // The GPU tick is bounded by a fixed step COUNT, not a CPU-time budget. GPU
    // commands are async, so a CPU-time budget queues an unbounded pile of work
    // that the next convergence readback then has to flush in one synchronous
    // stall -- which was turning ~60 small ticks/s into ~4 giant ones. A modest
    // fixed count keeps each tick's GPU work small and the loop smooth. The CPU
    // reference solver keeps the time budget, which is correct for synchronous
    // work.
    const clock = new SimulationClock(
      gpuSolver
        ? {
            budgetMs: 1000, // effectively unlimited; the step cap is the real bound
            maxStepsPerFrame: options.gpuStepsPerTick ?? GPU_STEPS_PER_TICK,
            chunkSteps: 20,
            convergenceEpsilon: options.convergenceEpsilon,
          }
        : {
            budgetMs: options.budgetMs ?? 10,
            convergenceEpsilon: options.convergenceEpsilon,
          }
    );

    const created: Session = {
      model,
      backend,
      backendId,
      clock,
      positionScratch: new Float32Array(prepared.vertexCount * 3),
      colorScratch: new Float32Array(prepared.vertexCount * 3),
      foldPercent: options.solver?.foldPercent ?? 0,
      view: {
        view: previous?.view ?? { yaw: 0, pitch: 0.38, zoom: 1 },
        width: previous?.width ?? renderCanvas?.width ?? 512,
        height: previous?.height ?? renderCanvas?.height ?? 512,
        settings: previous?.settings ?? DEFAULT_RENDER_SETTINGS,
        center: [0, 0, 0],
        radius: 1,
        fitted: false,
        lastRenderedAt: -Infinity,
      },
      // A fresh load counts as the most recent use, so a window that has just
      // opened is the last thing eviction would reach for rather than the first.
      lastUsed: ++useCounter,
      gpuRender: gpuSolver && renderCanvas ? gpuSolver : null,

    };
    sessions.set(sessionToken, created);
    evictBeyondCap();


    const indices = prepared.indices.slice();

    const edgesVertices = new Int32Array(prepared.edgesVertices.length * 2);
    const edgesAssignment = new Uint8Array(prepared.edgesVertices.length);
    prepared.edgesVertices.forEach((edge, index) => {
      edgesVertices[index * 2] = edge[0];
      edgesVertices[index * 2 + 1] = edge[1];
      const code = EDGE_ASSIGNMENT_CODES.indexOf(
        prepared.edgesAssignment[index] ?? 'U'
      );
      edgesAssignment[index] = code < 0 ? EDGE_ASSIGNMENT_CODES.indexOf('U') : code;
    });

    const facesEdges = new Int32Array(prepared.faceCount * 3);
    facesEdges.fill(-1);
    prepared.facesEdges.forEach((face, faceIndex) => {
      for (let i = 0; i < 3 && i < face.length; i += 1) {
        facesEdges[faceIndex * 3 + i] = face[i] ?? -1;
      }
    });

    return transfer(
      {
        vertexCount: prepared.vertexCount,
        faceCount: prepared.faceCount,
        edgeCount: prepared.edgeCount,
        creaseCount: prepared.creaseParams.length,
        indices: indices.buffer as ArrayBuffer,
        edgesVertices: edgesVertices.buffer as ArrayBuffer,
        edgesAssignment: edgesAssignment.buffer as ArrayBuffer,
        facesEdges: facesEdges.buffer as ArrayBuffer,
        diagnostics: backend.readDiagnostics(),
        backend: backendId,
        token: sessionToken,
      },
      [
        indices.buffer as ArrayBuffer,
        edgesVertices.buffer as ArrayBuffer,
        edgesAssignment.buffer as ArrayBuffer,
        facesEdges.buffer as ArrayBuffer,
      ]
    );
  },

  setFoldPercent(percent: number, token?: SimulatorSessionToken): void {
    const active = sessionFor(token);
    if (!active) return;
    active.backend.setFoldPercent(percent);
    active.foldPercent = percent;
    // A converged clock spends no budget, so a new target must un-converge it
    // or the model would simply never move to it.
    active.clock.invalidate();
  },

  setFoldProfile(profile: FoldProfile | null, token?: SimulatorSessionToken): void {
    const active = sessionFor(token);
    if (!active) return;
    active.backend.setFoldProfile(profile);
    active.clock.invalidate();
  },

  setMaterial(options: Partial<SimulatorOptions>, token?: SimulatorSessionToken): void {
    const active = sessionFor(token);
    if (!active) return;
    active.backend.setMaterial(options);
    if (options.foldPercent !== undefined) active.foldPercent = options.foldPercent;
    active.clock.invalidate();
  },

  /**
   * Back to flat — the paper *and* the target it was heading for.
   *
   * Zeroing the target here rather than leaving it to the caller is what makes
   * this safe to call. Every caller means "flat" and every one of them followed
   * this with a separate `setFoldPercent(0)`, which is a second round-trip to
   * the worker: for the frames in between, a flat sheet sat under the old
   * target with the clock freshly un-converged, so the solver drove it straight
   * back where it came from. Pressing play on a fully folded window snapped to
   * folded instead of replaying from the start.
   */
  reset(token?: SimulatorSessionToken): void {
    const active = sessionFor(token);
    if (!active) return;
    active.backend.reset();
    active.backend.setFoldPercent(0);
    active.foldPercent = 0;
    active.clock.reset();
  },

  /**
   * Run one budgeted frame and return the resulting positions. The main thread
   * awaits this instead of doing the work itself, so its own frame stays free
   * regardless of how long the solve takes.
   */
  async tick(
    options: {
      withColors?: boolean;
      recycled?: ArrayBuffer;
      token?: SimulatorSessionToken;
    } = {}
  ): Promise<SimulatorFramePayload | null> {
    const active = sessionFor(options.token);
    if (!active) return null;
    const tick = active.clock.runFrame(active.backend);
    return readFrame(active, tick, options);
  },

  /**
   * Run to convergence ignoring the frame budget. Safe here in a way it never
   * was on the main thread; used for initial settle and for scrubbing to a new
   * fold target where an immediately-correct result beats an animated one.
   */
  async settle(
    maxSteps = 20_000,
    options: {
      withColors?: boolean;
      recycled?: ArrayBuffer;
      token?: SimulatorSessionToken;
    } = {}
  ): Promise<SimulatorFramePayload | null> {
    const active = sessionFor(options.token);
    if (!active) return null;
    const tick = active.clock.runToConvergence(active.backend, maxSteps);
    return readFrame(active, tick, options);
  },

  /**
   * The current folded geometry, for export. Positions are read on demand rather
   * than pushed with every frame: in GPU-render mode nothing crosses to the main
   * thread at all, so an exporter has no other way to see the fold. Triangles are
   * the solver's own (already triangulated) faces.
   */
  exportGeometry(): SimulatorExportGeometry {
    const active = requireSession();
    const positions = new Float32Array(active.model.prepared.vertexCount * 3);
    active.backend.readPositions(positions);
    const triangles = active.model.prepared.indices.slice();
    return transfer(
      {
        positions: positions.buffer as ArrayBuffer,
        triangles: triangles.buffer as ArrayBuffer,
        vertexCount: active.model.prepared.vertexCount,
        foldPercent: active.foldPercent,
      },
      [positions.buffer as ArrayBuffer, triangles.buffer as ArrayBuffer]
    );
  },

  /**
   * The current view as a standalone SVG document, or null when there is
   * nothing to draw.
   *
   * Here rather than on the main thread because this is where the complete
   * render state already lives: positions in the solver, the camera and
   * appearance on {@link SessionView}. It is the vector sibling of
   * {@link renderGpu} — same positions, same topology, same camera, same
   * settings — which is what makes the file the view the user is looking at
   * rather than a second interpretation of it.
   *
   * Distinct from {@link exportGeometry}, which serves STL/OBJ and wants raw
   * geometry with no camera at all.
   */
  exportSvg(
    options: {
      token?: SimulatorSessionToken;
      /**
       * Page background. Defaults to transparent, which is not what is on
       * screen: the panel's backdrop is the app's canvas colour, and a file
       * carrying that would arrive in a document with the app's dark chrome
       * baked in. Transparent composites into anything.
       */
      background?: SimulatorExportBackground;
    } = {}
  ): SvgRenderResult | null {
    const active = sessionFor(options.token);
    if (!active) return null;
    const prepared = active.model.prepared;
    const positions = new Float32Array(prepared.vertexCount * 3);
    active.backend.readPositions(positions);
    // The GPU path fits on its first settled frame; the canvas-2D path has never
    // had reason to, so fit here from the same positions being exported.
    if (!active.view.fitted) fitTo(positions, active.view);

    let strain: Float32Array | null = null;
    if (active.view.settings.colorMode === 'strain') {
      strain = new Float32Array(prepared.vertexCount);
      active.backend.readStrain(strain);
    }

    const camera = cameraUniforms(
      active.view.view,
      active.view.center,
      active.view.radius,
      active.view.width,
      active.view.height
    );
    const mode = options.background ?? 'transparent';
    const settings: RenderSettings =
      mode === 'white'
        ? { ...active.view.settings, background: [1, 1, 1], backgroundAlpha: 1 }
        : { ...active.view.settings, backgroundAlpha: 1 };

    // The page size comes back with the document because a rasterizer needs it,
    // and re-deriving it from a string we just produced would be worse.
    return renderMeshToSvg(positions, meshTopologyFor(prepared), camera, settings, {
      // The canvas-2D fallback is orthographic, so a machine drawing through it
      // must export the way its own screen looks.
      perspective: Boolean(active.gpuRender),
      strain,
      background: mode !== 'transparent',
    });
  },

  diagnostics(): SimulatorDiagnostics {
    return requireSession().backend.readDiagnostics();
  },

  /**
   * Update the orbit camera and redraw. Called on every orbit/zoom: it runs no
   * solver work and no readback — just a re-draw with a new view — which is what
   * makes camera manipulation cheap at any model size.
   *
   * The camera is recorded whether or not a GPU renderer is attached; only the
   * redraw is skipped. On the canvas-2D path the main thread draws and there is
   * nothing to return, but the session still has to know how it is being looked
   * at — see {@link SessionView}.
   */
  async setCamera(
    camera: SimulatorCamera,
    token?: SimulatorSessionToken
  ): Promise<ImageBitmap | null> {
    const active = sessionFor(token);
    if (!active) return null;
    perf.cameraCalls += 1;
    active.view.view = camera.view;
    active.view.width = camera.width;
    active.view.height = camera.height;
    if (!active.gpuRender) return null;
    const bitmap = await renderGpu(active.gpuRender, active.view);
    return bitmap ? transfer(bitmap, [bitmap]) : null;
  },

  /** Update render settings (colours, faces/edges/lighting, x-ray) and redraw. */
  async setRenderSettings(
    settings: RenderSettings,
    token?: SimulatorSessionToken
  ): Promise<ImageBitmap | null> {
    const active = sessionFor(token);
    if (!active) return null;
    active.view.settings = settings;
    if (!active.gpuRender) return null;
    const bitmap = await renderGpu(active.gpuRender, active.view);
    return bitmap ? transfer(bitmap, [bitmap]) : null;
  },

  /**
   * Snapshot of timing counters since the last call, then reset them. Polled by
   * the runtime when `localStorage.simPerf === '1'` and logged to the console.
   * Everything is measured in the worker, where the solve and the GPU draw
   * actually happen, so it reflects real cost rather than main-thread overhead.
   */
  getPerfStats(): PerfSnapshot {
    const now = nowMs();
    const windowMs = now - perf.windowStart;
    const snapshot: PerfSnapshot = {
      windowMs,
      backend: latestSession()?.backendId ?? 'reference',
      gpuRender: Boolean(latestSession()?.gpuRender),
      liveSessions: sessions.size,
      liveMeshes: meshes.size,
      renders: perf.renders,
      renderAvgMs: perf.renders ? perf.renderTotalMs / perf.renders : 0,
      renderMaxMs: perf.renderMaxMs,
      resizeAvgMs: perf.renders ? perf.resizeTotalMs / perf.renders : 0,
      drawAvgMs: perf.renders ? perf.drawTotalMs / perf.renders : 0,
      snapshotAvgMs: perf.renders ? perf.snapshotTotalMs / perf.renders : 0,
      snapshotMaxMs: perf.snapshotMaxMs,
      request: perf.lastRequest,
      // Read live rather than sampled at render time: it is the current state of
      // the session map, and the question it answers is what the buffer would be
      // sized to *now*.
      peak: peakRequestedSize(),
      canvas: perf.lastCanvas,
      buffer: perf.lastBuffer,
      crop: perf.lastCrop,
      cameraCalls: perf.cameraCalls,
      ticks: perf.ticks,
      solveAvgMs: perf.ticks ? perf.solveTotalMs / perf.ticks : 0,
      solveMaxMs: perf.solveMaxMs,
      stepsTotal: perf.stepsTotal,
    };
    resetPerf(now);
    return snapshot;
  },

  /**
   * Drop one model. Called when a window is closed, so its textures go with it
   * rather than waiting to be evicted by something else loading.
   */
  release(token: SimulatorSessionToken): void {
    disposeSession(token);
  },

  /**
   * Take a 3D folded figure's mesh, ready to draw. No solver, no clock, no tick
   * loop — the geometry is final, so the whole cost is one texture upload and
   * two program links.
   *
   * Returns null when there is no render surface or WebGL2 is unavailable, which
   * is a real answer: the caller keeps drawing the figure the way it does today,
   * from its stored snapshot.
   */
  loadFolded3dMesh(payload: Folded3dMeshPayload): Folded3dMeshInfo | null {
    if (!renderCanvas) return null;
    const source = FoldedMeshSource.create(renderCanvas, payload);
    if (!source) return null;
    meshToken += 1;
    const previous = latestSession()?.view;
    meshes.set(meshToken, {
      source,
      view: {
        view: { yaw: 0, pitch: 0, zoom: 1 },
        width: renderCanvas.width,
        height: renderCanvas.height,
        settings: previous?.settings ?? DEFAULT_RENDER_SETTINGS,
        center: payload.center,
        radius: payload.radius,
        // A folded figure's geometry is final, so its fit is known at load: the
        // mesh is centroid-relative and reports the same radius the figure's
        // frame was sized from. Nothing to settle and nothing to re-fit.
        fitted: true,
        lastRenderedAt: -Infinity,
      },
      lastUsed: ++useCounter,
    });
    evictMeshesBeyondCap();
    return {
      token: meshToken,
      depthBits: source.depthBits,
      // The displacement between stacked layers is budgeted against a 24-bit
      // buffer; at 16 the deepest real model's layers sit 1.01 units apart and
      // start to collide. Reported so that shows up as a fact rather than as
      // shimmer nobody can explain.
      shallowDepthBuffer:
        source.depthBits > 0 && source.depthBits < FOLDED_3D_REQUIRED_DEPTH_BITS,
    };
  },

  /** Move a folded figure's camera and redraw it. Null once its mesh is gone. */
  async setFolded3dMeshCamera(
    token: Folded3dMeshToken,
    camera: SimulatorCamera
  ): Promise<Folded3dMeshFrame | null> {
    const mesh = meshFor(token);
    if (!mesh) return null;
    perf.cameraCalls += 1;
    mesh.view.view = camera.view;
    mesh.view.width = camera.width;
    mesh.view.height = camera.height;
    const bitmap = await renderGpu(mesh.source, mesh.view);
    return bitmap ? transfer({ bitmap }, [bitmap]) : { bitmap: null };
  },

  /** Change a folded figure's colours or style and redraw it. */
  async setFolded3dMeshRenderSettings(
    token: Folded3dMeshToken,
    settings: RenderSettings
  ): Promise<Folded3dMeshFrame | null> {
    const mesh = meshFor(token);
    if (!mesh) return null;
    mesh.view.settings = settings;
    const bitmap = await renderGpu(mesh.source, mesh.view);
    return bitmap ? transfer({ bitmap }, [bitmap]) : { bitmap: null };
  },

  /** Drop one mesh, when its window unmounts or its figure is deleted. */
  releaseFolded3dMesh(token: Folded3dMeshToken): void {
    disposeMesh(token);
  },

  dispose(): void {
    for (const token of [...sessions.keys()]) disposeSession(token);
    for (const token of [...meshes.keys()]) disposeMesh(token);
  },
};

async function readFrame(
  active: Session,
  tick: { steps: number; elapsedMs: number; converged: boolean; maxVelocity: number },
  options: { withColors?: boolean; recycled?: ArrayBuffer }
): Promise<SimulatorFramePayload> {
  perf.ticks += 1;
  perf.solveTotalMs += tick.elapsedMs;
  perf.stepsTotal += tick.steps;
  if (tick.elapsedMs > perf.solveMaxMs) perf.solveMaxMs = tick.elapsedMs;

  const scalars = {
    step: active.backend.stepCount,
    stepsThisTick: tick.steps,
    elapsedMs: tick.elapsedMs,
    converged: tick.converged,
    maxVelocity: tick.maxVelocity,
    foldPercent: active.foldPercent,
    maxStrain: active.backend.readDiagnostics().maxNodalStrain ?? 0,
  };

  // GPU-render mode: the worker draws straight to the transferred canvas. No
  // positions cross to the main thread at all -- the whole point of this path.
  if (active.gpuRender) {
    refitOnce(active.gpuRender, active.view);
    const bitmap = await renderGpu(active.gpuRender, active.view);
    const payload = {
      positions: null,
      colors: null,
      renderedInWorker: true,
      bitmap,
      ...scalars,
    };
    return bitmap ? transfer(payload, [bitmap]) : payload;
  }

  const floats = active.model.positions.length;
  const positions = scratchFrom(options.recycled, floats);
  active.backend.readPositions(positions);

  let colors: Float32Array | null = null;
  if (options.withColors) {
    colors = active.colorScratch;
    active.backend.readColors(colors);
    colors = colors.slice();
  }

  const transferables: ArrayBuffer[] = [positions.buffer as ArrayBuffer];
  if (colors) transferables.push(colors.buffer as ArrayBuffer);

  return transfer(
    {
      positions: positions.buffer as ArrayBuffer,
      colors: colors ? (colors.buffer as ArrayBuffer) : null,
      renderedInWorker: false,
      bitmap: null,
      ...scalars,
    },
    transferables
  );
}

/**
 * Draw the current GPU state. No readback in either mode: the mesh is drawn from
 * a position texture, so nothing crosses to the CPU.
 *
 * Kind-agnostic by design — a running solver and a static folded mesh both
 * satisfy {@link MeshRenderSource}, and everything below this line (the
 * grow-only, capped and quantised canvas, the aspect-preserving viewport fit,
 * the Y-flipped crop) is the same for both because each of those exists for a
 * reason that has nothing to do with what is being drawn.
 *
 * Returns an ImageBitmap in bitmap-present mode and null when drawing straight
 * to a transferred canvas. This is the single fork between the two paths —
 * solver, camera, settings and MeshRenderer are identical either side of it.
 */
/**
 * Size the shared drawing buffer for a render.
 *
 * Resizing a drawing buffer reallocates it, which costs ~2.2ms and stalls on the
 * GPU process. Sizing it to each request meant paying that on *every* render:
 * once per frame while a window zooms, and once per message when two windows of
 * different sizes take turns — measured at 78% worker occupancy with only ~95ms
 * of actual GL command submission behind it.
 *
 * In bitmap mode the canvas is scratch, not the frame, so it grows to the
 * largest render anyone has asked for and stays there; each render takes the
 * corner it needs and is cropped out. Window size stops being a performance
 * variable. See `implementation-plans/inline-simulation-performance.md`.
 *
 * In canvas mode it stays exact: the transferred canvas *is* the visible
 * surface, and a buffer larger than the drawing would be stretched across it by
 * the compositor.
 */
/**
 * Ceiling on a bitmap-mode render, in device pixels.
 *
 * Not a quality choice — a correctness one. A browser silently clamps the
 * drawing buffer when it cannot back the size asked for: a canvas set to 16384
 * came back with a 5760 buffer, `isContextLost()` false and no GL error. Past
 * that point the render lands outside the buffer and the crop reads nothing, so
 * every window goes transparent at once and, with a grow-only canvas, stays that
 * way. Well under the observed clamp, and ~9ms to allocate once.
 *
 * A window larger than this renders at the cap and is scaled up slightly by the
 * time it reaches the screen. That is a window filling most of a large display,
 * where mild softness is a better outcome than a blank one.
 */
export const MAX_BITMAP_RENDER_EDGE = 2048;

/** Floor, so a window measured mid-collapse still renders something usable. */
const MIN_BITMAP_RENDER_EDGE = 128;

/**
 * Quantised edge for the *canvas*, which is the expensive thing to change.
 *
 * Grow-only alone does nothing for a monotonically increasing sequence, and
 * zooming in is exactly that — every frame wants a few more pixels than the
 * last, so the buffer reallocated every frame regardless, at 3.6ms when small
 * and 95ms by the time it reached 8192. Snapped to powers of two there are at
 * most four growth events in a session.
 *
 * Deliberately *not* used for the render viewport. Quantising each axis
 * separately changes the aspect ratio — a 257x255 window would render 512x256
 * and be stretched to twice its width on the way to the screen — and setting a
 * viewport costs nothing, so there is nothing to buy by rounding it.
 */
export function bitmapCanvasEdge(edge: number): number {
  const wanted = Math.max(MIN_BITMAP_RENDER_EDGE, Math.ceil(edge));
  if (wanted >= MAX_BITMAP_RENDER_EDGE) return MAX_BITMAP_RENDER_EDGE;
  return 2 ** Math.ceil(Math.log2(wanted));
}

/**
 * Scale a requested render down to fit a limit, keeping its shape.
 *
 * Uniform, never per-axis: the bitmap is stretched to the window's box when it
 * is presented, so any difference between its aspect and the window's shows up
 * as a squashed fold.
 */
export function fitRenderWithin(
  requested: { width: number; height: number },
  limit: { width: number; height: number }
): { width: number; height: number } {
  const width = Math.max(1, Math.floor(requested.width));
  const height = Math.max(1, Math.floor(requested.height));
  const scale = Math.min(1, limit.width / width, limit.height / height);
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/**
 * How long the peak must stay below the buffer before it is given back.
 *
 * Grows are instant; only shrinking waits. Long enough that a zoom-out gesture
 * settles first — so the buffer is handed back once, not once per frame of the
 * gesture — and short enough that letting go of a zoom returns the frame rate
 * before the next thing you try feels slow.
 */
const SHRINK_HOLD_MS = 750;

/**
 * When the buffer last changed size, so a shrink can be made to wait.
 * `-Infinity` lets the first one happen immediately.
 */
let lastCanvasResizeMs = -Infinity;

export function nextRenderCanvasSize(options: {
  current: { width: number; height: number };
  requested: { width: number; height: number };
  mode: PresentMode;
  /**
   * Whether the buffer may be handed back when the request is smaller than it.
   * Omitted or false keeps the historical grow-only behaviour, which is what a
   * caller that cannot see the *other* windows' sizes must ask for — see
   * {@link renderCanvasResize}.
   */
  allowShrink?: boolean;
}): { width: number; height: number } | null {
  const { current, requested, mode, allowShrink = false } = options;
  if (mode === 'canvas') {
    const width = Math.max(1, Math.floor(requested.width));
    const height = Math.max(1, Math.floor(requested.height));
    if (current.width === width && current.height === height) return null;
    return { width, height };
  }
  const width = bitmapCanvasEdge(requested.width);
  const height = bitmapCanvasEdge(requested.height);
  if (current.width >= width && current.height >= height) {
    if (!allowShrink) return null;
    // Give the buffer back once nobody needs it.
    //
    // This was grow-only, on the reasoning that a reallocation costs ~2.2ms and
    // stalls the GPU process, so never paying it twice is the cheaper trade.
    // That holds for the *allocation* and misses what the allocation then costs
    // per frame: with `preserveDrawingBuffer: false`, reading the canvas each
    // frame obliges the browser to clear the whole drawing buffer before the
    // next draw, and multisampling makes that four samples deep. That clear is
    // the browser's, not ours — no scissor of ours bounds it — and it is
    // charged on every render for as long as the buffer stays big.
    //
    // Measured in WebKit, one deep zoom and back: 234x234 windows drawing into
    // a 2048x2048 buffer cost ~7ms per render, against 0.69ms once the buffer
    // is 512x512. So the trade is one 2.2ms stall against ~6ms every frame
    // until the tab closes, and grow-only is on the wrong side of it. Chromium
    // fast-paths the clear and shows none of this, which is why it went unseen.
    if (current.width === width && current.height === height) return null;
    return { width, height };
  }
  return {
    width: Math.max(current.width, width),
    height: Math.max(current.height, height),
  };
}

/**
 * How recently a window must have drawn to have a say in the buffer's size.
 *
 * Comfortably longer than a frame, so a window being orbited or stepped always
 * counts, and comfortably shorter than a person's attention, so one that has
 * stopped stops paying for its size almost immediately.
 */
const ACTIVE_RENDER_MS = 1000;

/**
 * The largest render any window *in use* currently wants.
 *
 * The buffer is shared, so its size is a property of a set rather than of
 * whichever window is drawing now: sizing it to the caller alone makes two
 * windows of different sizes thrash it against each other on every message,
 * which is the regression `inline-simulation-performance.md` removed and which
 * this deliberately does not reintroduce.
 *
 * The set is the mistake being fixed. It was every *live* window, and liveness
 * is not use — an inline window that was zoomed large once and then left alone
 * kept its claim forever, pinning the buffer at its 2048 cap. Measured in the
 * desktop shell: the window being dragged wanted 783px, the peak said 3648, and
 * every render cost ~25ms instead of ~8ms because of a window nobody was
 * looking at. A render costs buffer area regardless of what is drawn into it,
 * so that is a tax the whole session pays for one idle neighbour.
 *
 * Recency is what distinguishes the two. A window that is drawing still gets
 * its size honoured on the frame it asks — that is what stops the thrash — and
 * one that has not drawn for {@link ACTIVE_RENDER_MS} stops holding the buffer
 * up for everyone else. Shrinking is still rate-limited by `SHRINK_HOLD_MS`, so
 * a window that goes quiet and comes back pays one reallocation, not a stream
 * of them.
 */
function peakRequestedSize(at = nowMs()): { width: number; height: number } {
  const views: Array<Pick<SessionView, 'width' | 'height' | 'lastRenderedAt'>> = [];
  for (const session of sessions.values()) views.push(session.view);
  for (const mesh of meshes.values()) views.push(mesh.view);
  return activePeakSize(views, at);
}

/**
 * The peak over the views that have drawn recently, as a pure function.
 *
 * Exported and taking the views and the clock explicitly, for the same reason
 * {@link renderCanvasResize} is: the interesting half of this policy is *which
 * windows count*, and that is exactly the half a test driving the session map
 * could not reach. jsdom has no `OffscreenCanvas`, so there is no way to build
 * real sessions there at all.
 */
export function activePeakSize(
  views: ReadonlyArray<{ width: number; height: number; lastRenderedAt: number }>,
  at: number,
  activeWithinMs = ACTIVE_RENDER_MS
): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const view of views) {
    if (at - view.lastRenderedAt > activeWithinMs) continue;
    width = Math.max(width, view.width);
    height = Math.max(height, view.height);
  }
  return { width, height };
}

/**
 * The whole resize policy, as a pure function.
 *
 * Exported and taking every input explicitly — the elapsed time and the peak,
 * rather than reading a clock and a session map — because the interesting half
 * of this policy is *when shrinking is allowed*, and a test that calls
 * {@link nextRenderCanvasSize} with the flag already set proves nothing about
 * whether anything ever sets it. jsdom has no `OffscreenCanvas`, so driving
 * `sizeRenderCanvas` itself is not an option; this is the seam that makes the
 * reachable behaviour testable instead of just the leaf.
 */
export function renderCanvasResize(options: {
  current: { width: number; height: number };
  /** What the window being drawn asked for. */
  callerRequest: { width: number; height: number };
  /** The largest request across every live window, or null if none has a size. */
  peak: { width: number; height: number } | null;
  mode: PresentMode;
  /** Time since the buffer last changed size. */
  msSinceResize: number;
}): { width: number; height: number } | null {
  const { current, callerRequest, peak, mode, msSinceResize } = options;
  // Canvas mode is not shared: the buffer *is* the visible surface, it must
  // match the drawing exactly or the compositor stretches it, and there is one
  // consumer. The peak is a bitmap-mode idea and consulting it here could size
  // the visible canvas to some other window's request.
  if (mode === 'canvas') {
    return nextRenderCanvasSize({ current, requested: callerRequest, mode });
  }
  // Growth is decided by the caller's own request, so a window that needs more
  // pixels gets them on the frame it asks. Shrinking is decided by the peak
  // across every live window, and only once the last resize has held — see
  // {@link SHRINK_HOLD_MS}.
  const allowShrink = msSinceResize >= SHRINK_HOLD_MS;
  // A peak of zero means no window has been given a size yet; fall back to the
  // caller's request rather than collapsing the buffer to the floor.
  const usable = allowShrink && peak && peak.width > 0 && peak.height > 0;
  return nextRenderCanvasSize({
    current,
    requested: usable ? peak : callerRequest,
    mode,
    allowShrink,
  });
}

function sizeRenderCanvas(width: number, height: number, at = nowMs()): void {
  if (!renderCanvas) return;
  const next = renderCanvasResize({
    current: renderCanvas,
    callerRequest: { width, height },
    peak: peakRequestedSize(),
    mode: presentMode,
    msSinceResize: at - lastCanvasResizeMs,
  });
  if (!next) return;
  renderCanvas.width = next.width;
  renderCanvas.height = next.height;
  lastCanvasResizeMs = at;
}

async function renderGpu(
  source: MeshRenderSource,
  state: SessionView
): Promise<ImageBitmap | null> {
  // Timed as a whole. It used to start after the resize, which is exactly the
  // work that turned out to dominate — the instrumentation meant to catch this
  // could not see it.
  const started = nowMs();
  // Stamped before the resize, so this render's own size counts towards the peak
  // it is about to be sized against. Stamping afterwards would let a window's
  // first frame back be measured as though the window were still idle.
  state.lastRenderedAt = started;
  // The canvas is quantised so it rarely reallocates; the viewport inside it is
  // the window's true shape, because changing a viewport is free and the bitmap
  // is stretched to the window's box when it is presented. Rounding the viewport
  // too is what squashed the fold: a 257x255 window rendered 512x256.
  sizeRenderCanvas(state.width, state.height);
  const resized = nowMs();
  // What GL actually gave us, which is not always what the canvas was set to —
  // see {@link WebglSolver.drawingBufferSize}. Rendering or cropping past this
  // reads nothing back and shows an empty window with no error anywhere.
  const buffer = source.drawingBufferSize;
  const { width, height } = fitRenderWithin(state, buffer);
  const camera = cameraUniforms(state.view, state.center, state.radius, width, height);
  source.render(camera, state.settings);
  const drawn = nowMs();
  // The render fills the viewport at the buffer's bottom-left; a bitmap's origin
  // is top-left, so the crop is measured down from the top of the buffer.
  const bitmap =
    presentMode === 'bitmap' && renderCanvas
      ? await createImageBitmap(renderCanvas, 0, buffer.height - height, width, height)
      : null;
  // render() issues GL commands but they run async on the GPU; this measures the
  // CPU-side command cost, which is what would block the worker. A readPixels
  // would be needed to time actual GPU work, and that would itself stall.
  const elapsed = nowMs() - started;
  perf.renders += 1;
  perf.renderTotalMs += elapsed;
  if (elapsed > perf.renderMaxMs) perf.renderMaxMs = elapsed;
  // Split three ways, because the total cannot distinguish the failure modes and
  // they have opposite fixes. `snapshot` is the one to watch: a browser that
  // cannot copy a sub-rect on the GPU snapshots the *whole* drawing buffer here,
  // so it scales with the grow-only canvas rather than with the window — and the
  // sizes below are what make that visible instead of inferred.
  perf.resizeTotalMs += resized - started;
  perf.drawTotalMs += drawn - resized;
  const snapshotMs = nowMs() - drawn;
  perf.snapshotTotalMs += snapshotMs;
  if (snapshotMs > perf.snapshotMaxMs) perf.snapshotMaxMs = snapshotMs;
  perf.lastRequest = { width: state.width, height: state.height };
  perf.lastCanvas = renderCanvas
    ? { width: renderCanvas.width, height: renderCanvas.height }
    : { width: 0, height: 0 };
  perf.lastBuffer = buffer;
  perf.lastCrop = { width, height };
  return bitmap;
}

/**
 * Fit the camera once, from the first settled frame. Matches the canvas-2D
 * renderer, which also fits once (a folded model shrinks, and refitting every
 * frame makes it visibly "breathe"). A readback of positions here is a one-off
 * on load, not a per-frame cost.
 */
function refitOnce(solver: WebglSolver, state: SessionView): void {
  if (state.fitted) return;
  const positions = new Float32Array(solver.vertexCount * 3);
  solver.readPositions(positions);
  fitTo(positions, state);
}

/** Frame a set of positions, which is what makes the camera's scale meaningful. */
function fitTo(positions: Float32Array, state: SessionView): void {
  const center = centroid(positions);
  state.center = center;
  state.radius = boundingRadius(positions, center);
  state.fitted = true;
}

export type SimulatorWorkerApi = typeof api;

/**
 * The worker API as a plain object, usable without a Worker.
 *
 * `simulatorWorker.ts` is a three-line comlink wrapper around this, which keeps
 * the session logic testable in jsdom (where `Worker` does not exist) and
 * runnable in Node.
 */
export function createSimulatorSession(): SimulatorWorkerApi {
  return api;
}
