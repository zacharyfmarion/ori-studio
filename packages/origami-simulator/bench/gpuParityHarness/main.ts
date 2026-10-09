// Runs in a real browser (via the parity bench). Exposes a function that folds
// each fixture with both the GPU solver and the reference solver and returns the
// divergence, so the Playwright driver can assert on it. WebGL2 is unavailable
// in Node, so this is the only place the GPU solver can actually be exercised.
import { prepareFoldModel } from '../../src/prepare.js';
import { OrigamiModel } from '../../src/model.js';
import { ReferenceSolver } from '../../src/referenceSolver.js';
import { WebglSolver } from '../../src/webgl/webglSolver.js';
import { cameraUniforms, centroid, boundingRadius } from '../../src/webgl/camera.js';
import type { RenderSettings } from '../../src/webgl/meshRenderer.js';
import { FIXTURES } from '../fixtures.js';
import { createSolverShape, type SolverShape } from '../../src/solverBackend.js';
import { POSE_REST_LENGTH_TOLERANCE } from '../../src/pull.js';
import type { FoldDocument } from '../../src/types.js';

interface GpuParityRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  /** Run with fixed nodes, pinned mid-fold after {@link PIN_AFTER_STEPS}. */
  pinned: boolean;
  /** Pinned rows only: how far the GPU moved a node it was told to hold. */
  heldDrift?: number;
  steps: number;
  vertices: number;
  maxAbs: number;
  meanAbs: number;
  gpuSupported: boolean;
  error?: string;
}

interface RenderCheckRow {
  fixture: string;
  vertices: number;
  coverage: number;
  distinctColors: number;
  ok: boolean;
  /** Strain colour mode produced a different image than paper mode. */
  strainDiffers?: boolean;
  /** A frame drawn with the highlight tinted the highlighted triangles. */
  highlightDiffers?: boolean;
  /** A frame drawn without asking (an export) shows no highlight at all. */
  highlightAbsentUnasked?: boolean;
  error?: string;
}

/** One phase of a scripted pull, run on both backends; see {@link runPullParity}. */
interface PullParityRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  phase: 'pulling' | 'kept' | 'cancelled' | 'released';
  maxAbs: number;
  /** How far the GPU moved a node it was told to hold, over the whole script. */
  heldDrift: number;
  movedCreases?: { reference: number; gpu: number };
  error?: string;
}

declare global {
  interface Window {
    runGpuParity: (foldPercent: number, stepCounts: number[]) => GpuParityRow[];
    runRenderCheck: () => RenderCheckRow[];
    runPullParity: (foldPercent: number) => PullParityRow[];
    runShapeChecks: () => ShapeCheckRow[];
  }
}

/** One fixture's shape read and restore on the GPU; see {@link runShapeChecks}. */
interface ShapeCheckRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  vertices: number;
  creases: number;
  /** readShape then writeShape onto a fresh solver then readShape: every byte the same. */
  roundTrip: boolean;
  /** The positions drawn after the restore are the ones drawn before it, bit for bit. */
  positionsMatch: boolean;
  /** Settled fixtures only: how far any node moved in 400 steps after a restore, unposed and kept. */
  heldStill?: { free: number; kept: number };
  /** Settled fixtures only: every crease's angle kept its sign through those steps. */
  sidesKept?: boolean;
  /**
   * The shape's largest edge stretch. A pose keeps edge lengths only within
   * `POSE_REST_LENGTH_TOLERANCE` of the sheet's, so a shape stretched further
   * settles by the difference when kept, restored or not.
   */
  stretch?: number;
  /** Mean milliseconds over 20 calls. */
  readShapeMs: number;
  writeShapeMs: number;
  /** For scale: the position readback the worker already makes on a pin, pick or pull. */
  readPositionsMs: number;
  error?: string;
}

function compare(a: Float32Array, b: Float32Array): { maxAbs: number; meanAbs: number } {
  const n = Math.min(a.length, b.length);
  let maxAbs = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const delta = Math.abs(a[i]! - b[i]!);
    if (delta > maxAbs) maxAbs = delta;
    total += delta;
  }
  return { maxAbs, meanAbs: n ? total / n : 0 };
}

/**
 * Pinned rows fix nodes part-way through the fold, not on the flat sheet: a
 * node fixed at rest would hide an integrator that snaps fixed nodes back to
 * rest, which is exactly the bug Verlet's fixed branch used to have.
 */
const PIN_AFTER_STEPS = 20;

/** The first triangle's nodes and every seventh node: a held face plus scattered pins. */
function pinMask(vertexCount: number, indices: Uint32Array): Uint8Array {
  const mask = new Uint8Array(vertexCount);
  for (let corner = 0; corner < 3; corner += 1) mask[indices[corner]!] = 1;
  for (let node = 0; node < vertexCount; node += 7) mask[node] = 1;
  return mask;
}

function maxDriftOf(mask: Uint8Array, before: Float32Array, after: Float32Array): number {
  let max = 0;
  for (let node = 0; node < mask.length; node += 1) {
    if (!mask[node]) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      max = Math.max(max, Math.abs(after[node * 3 + axis]! - before[node * 3 + axis]!));
    }
  }
  return max;
}

window.runGpuParity = (foldPercent, stepCounts) => {
  const rows: GpuParityRow[] = [];
  // Both integrators are compared: they share the force shader but apply it
  // differently, so a Verlet-only regression would otherwise go unnoticed.
  const integrators = ['euler', 'verlet'] as const;

  for (const fixture of FIXTURES) {
    if (fixture.degenerate) continue;

    for (const integrationType of integrators) {
      for (const pinned of [false, true]) {
      for (const steps of stepCounts) {
        const fold = fixture.build();

        const referenceModel = new OrigamiModel(prepareFoldModel(structuredClone(fold), { triangulate: true }));
        const reference = new ReferenceSolver(referenceModel, { foldPercent, integrationType });
        const mask = pinned ? pinMask(referenceModel.prepared.vertexCount, referenceModel.prepared.indices) : null;
        if (mask) {
          reference.step(PIN_AFTER_STEPS);
          reference.setFixedNodes(mask);
        }
        reference.step(steps);
        const referencePositions = referenceModel.positions.slice(0, referenceModel.prepared.vertexCount * 3);

        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;

        let row: GpuParityRow = {
          fixture: fixture.name,
          integrator: integrationType,
          pinned,
          steps,
          vertices: referenceModel.prepared.vertexCount,
          maxAbs: 0,
          meanAbs: 0,
          gpuSupported: true,
        };

        try {
          if (!WebglSolver.isSupported(canvas)) {
            rows.push({ ...row, gpuSupported: false, error: 'WebGL2 unsupported' });
            continue;
          }
          const gpuModel = new OrigamiModel(prepareFoldModel(structuredClone(fold), { triangulate: true }));
          const gpu = new WebglSolver(canvas, gpuModel, { foldPercent, integrationType });
          const gpuPositions = new Float32Array(gpuModel.prepared.vertexCount * 3);
          let held: Float32Array | null = null;
          if (mask) {
            gpu.step(PIN_AFTER_STEPS);
            gpu.setFixedNodes(mask);
            held = new Float32Array(gpuPositions.length);
            gpu.readPositions(held);
          }
          gpu.step(steps);
          gpu.readPositions(gpuPositions);
          gpu.dispose();

          row = { ...row, ...compare(referencePositions, gpuPositions) };
          if (mask && held) row.heldDrift = maxDriftOf(mask, held, gpuPositions);
        } catch (cause) {
          row = { ...row, error: cause instanceof Error ? cause.message : String(cause) };
        }
        rows.push(row);
      }
      }
    }
  }

  return rows;
};

/**
 * A pull, scripted identically on both backends: grip the triangle farthest from
 * a held one, draw it up and sideways, keep the shape, pull again and cancel,
 * then drop the pose. Positions are compared after each phase.
 */
window.runPullParity = (foldPercent) => {
  const rows: PullParityRow[] = [];
  for (const fixture of FIXTURES) {
    if (fixture.degenerate) continue;
    for (const integrationType of ['euler', 'verlet'] as const) {
      const base = { fixture: fixture.name, integrator: integrationType, heldDrift: 0 };
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        if (!WebglSolver.isSupported(canvas)) {
          rows.push({ ...base, phase: 'pulling', maxAbs: 0, error: 'WebGL2 unsupported' });
          continue;
        }
        const fold = fixture.build();
        const referenceModel = new OrigamiModel(prepareFoldModel(structuredClone(fold), { triangulate: true }));
        const gpuModel = new OrigamiModel(prepareFoldModel(structuredClone(fold), { triangulate: true }));
        const reference = new ReferenceSolver(referenceModel, { foldPercent, integrationType });
        const gpu = new WebglSolver(canvas, gpuModel, { foldPercent, integrationType });
        const { indices, vertexCount } = referenceModel.prepared;
        const mask = new Uint8Array(vertexCount);
        for (let corner = 0; corner < 3; corner += 1) mask[indices[corner]!] = 1;
        const held = new Float32Array(vertexCount * 3);
        const now = new Float32Array(vertexCount * 3);

        const both = (act: (solver: ReferenceSolver | WebglSolver) => void) => {
          act(reference);
          act(gpu);
        };
        both((solver) => solver.step(40));
        both((solver) => solver.setFixedNodes(mask));
        gpu.readPositions(held);

        // The grip: the triangle whose centre is farthest from the held one's.
        const centre = (positions: Float32Array, triangle: number): [number, number, number] => {
          const out: [number, number, number] = [0, 0, 0];
          for (let corner = 0; corner < 3; corner += 1) {
            const node = indices[triangle * 3 + corner]!;
            for (let axis = 0; axis < 3; axis += 1) out[axis] += positions[node * 3 + axis]! / 3;
          }
          return out;
        };
        const anchor = centre(referenceModel.positions, 0);
        let far = 0;
        let farthest = -1;
        for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
          const c = centre(referenceModel.positions, triangle);
          const d = Math.hypot(c[0] - anchor[0], c[1] - anchor[1], c[2] - anchor[2]);
          if (d > farthest) {
            farthest = d;
            far = triangle;
          }
        }
        const at = centre(referenceModel.positions, far);
        const direction: [number, number, number] = [Math.SQRT1_2, 0, Math.SQRT1_2];
        const rayThrough = (lift: number, side: number) => ({
          origin: [at[0] - direction[0] * 5 - side, at[1] + lift, at[2] - direction[2] * 5 + side] as [number, number, number],
          direction,
        });
        const grip = {
          nodes: [indices[far * 3]!, indices[far * 3 + 1]!, indices[far * 3 + 2]!] as [number, number, number],
          weights: [1 / 3, 1 / 3, 1 / 3] as [number, number, number],
          ray: rayThrough(0.25, 0),
        };

        const compareNow = (phase: PullParityRow['phase'], movedCreases?: PullParityRow['movedCreases']) => {
          gpu.readPositions(now);
          const heldDrift = maxDriftOf(mask, held, now);
          const reference3 = referenceModel.positions.slice(0, vertexCount * 3);
          rows.push({ ...base, phase, heldDrift, ...compare(reference3, now), ...(movedCreases ? { movedCreases } : {}) });
        };

        both((solver) => solver.beginPull(grip));
        both((solver) => solver.step(60));
        compareNow('pulling');

        const kept = { reference: reference.endPull('keep').movedCreases, gpu: gpu.endPull('keep').movedCreases };
        both((solver) => solver.step(40));
        compareNow('kept', kept);

        both((solver) => solver.beginPull({ ...grip, ray: rayThrough(0.1, 0.2) }));
        both((solver) => solver.step(20));
        both((solver) => solver.endPull('cancel'));
        both((solver) => solver.step(20));
        compareNow('cancelled');

        both((solver) => solver.releasePose());
        both((solver) => solver.step(40));
        compareNow('released');
        gpu.dispose();
      } catch (cause) {
        rows.push({ ...base, phase: 'pulling', maxAbs: 0, error: cause instanceof Error ? cause.message : String(cause) });
      }
    }
  }
  return rows;
};

// Headless render coverage check. The renderer's *visual* correctness is the
// user's call in a visible window; this only catches the failures that need no
// eyes: shaders that do not compile/link, and a render that draws nothing (all
// background) or everything flat (one colour, i.e. the mesh collapsed or the
// projection is degenerate). It renders to an offscreen framebuffer so no
// visible canvas is required.
const RENDER_SIZE = 128;
const RENDER_SETTINGS: RenderSettings = {
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
  edgeWidthPx: 3,
  mountainWidthPx: 3,
  valleyWidthPx: 3,
  faceAlpha: 1,
};

window.runRenderCheck = () => {
  const rows: RenderCheckRow[] = [];

  for (const fixture of FIXTURES) {
    if (fixture.degenerate) continue;
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    let row: RenderCheckRow = {
      fixture: fixture.name,
      vertices: 0,
      coverage: 0,
      distinctColors: 0,
      ok: false,
    };

    try {
      if (!WebglSolver.isSupported(canvas)) {
        rows.push({ ...row, error: 'WebGL2 unsupported' });
        continue;
      }
      const model = new OrigamiModel(prepareFoldModel(fixture.build(), { triangulate: true }));
      const solver = new WebglSolver(canvas, model, { foldPercent: 60 });
      solver.step(120);

      const positions = new Float32Array(model.prepared.vertexCount * 3);
      solver.readPositions(positions);
      const center = centroid(positions);
      const radius = boundingRadius(positions, center);
      const camera = cameraUniforms({ yaw: 0.4, pitch: 0.38, zoom: 1 }, center, radius, RENDER_SIZE, RENDER_SIZE);

      const pixels = solver.renderToImage(camera, RENDER_SETTINGS, RENDER_SIZE, RENDER_SIZE);
      // Strain colour mode must compile and produce a visibly different image;
      // otherwise the ramp is silently a no-op (it was a stub before). Compared
      // with creases hidden: on a dense model at this size the 3px crease ribbons
      // cover the faces completely, so leaving them on would compare two
      // identical images of nothing but lines.
      const facesOnly = { ...RENDER_SETTINGS, showEdges: false };
      const paperFaces = solver.renderToImage(camera, facesOnly, RENDER_SIZE, RENDER_SIZE);
      const strainFaces = solver.renderToImage(
        camera,
        { ...facesOnly, colorMode: 'strain', strainClip: 5 },
        RENDER_SIZE,
        RENDER_SIZE
      );
      let strainDiffers = false;
      for (let i = 0; i < paperFaces.length; i += 4) {
        if (paperFaces[i] !== strainFaces[i] || paperFaces[i + 1] !== strainFaces[i + 1]) {
          strainDiffers = true;
          break;
        }
      }

      // Pinned faces are drawn tinted, and only in a frame that asks: the
      // highlight pass must compile and change the picture, and must not leak
      // into a frame drawn without it, which is what an export is.
      const triangleCount = model.prepared.indices.length / 3;
      solver.setHighlightTriangles(Array.from({ length: Math.ceil(triangleCount / 2) }, (_, t) => t));
      const highlighted = solver.renderToImage(camera, facesOnly, RENDER_SIZE, RENDER_SIZE, { highlight: true });
      const unasked = solver.renderToImage(camera, facesOnly, RENDER_SIZE, RENDER_SIZE);
      let highlightDiffers = false;
      let highlightAbsentUnasked = true;
      for (let i = 0; i < paperFaces.length; i += 1) {
        if (highlighted[i] !== paperFaces[i]) highlightDiffers = true;
        if (unasked[i] !== paperFaces[i]) highlightAbsentUnasked = false;
      }

      const bg = [Math.round(0.05 * 255), Math.round(0.06 * 255), Math.round(0.07 * 255)];
      let covered = 0;
      const colors = new Set<number>();
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
        if (Math.abs(r - bg[0]!) > 6 || Math.abs(g - bg[1]!) > 6 || Math.abs(b - bg[2]!) > 6) covered += 1;
        colors.add((r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10));
      }
      const coverage = covered / (RENDER_SIZE * RENDER_SIZE);
      solver.dispose();

      // A real folded silhouette covers a meaningful but not total fraction of
      // the frame; a single flat colour means the projection or shading
      // collapsed. (Two colours is already valid -- it means the two-tone
      // front/back is showing. A dense model at 128px legitimately quantises to
      // just the two paper tones once shading variation falls below a pixel.)
      row = {
        fixture: fixture.name,
        vertices: model.prepared.vertexCount,
        coverage,
        distinctColors: colors.size,
        ok: coverage > 0.02 && coverage < 0.99 && colors.size > 1,
        strainDiffers,
        highlightDiffers,
        highlightAbsentUnasked,
      };
    } catch (cause) {
      row = { ...row, error: cause instanceof Error ? cause.message : String(cause) };
    }
    rows.push(row);
  }

  return rows;
};

// Long-run stability sweep. The parity check above only compares 1-100 steps at a
// fixed fold percent; the interactive simulator runs tens of thousands of steps
// while the fold target ramps, which is where the model was observed blowing up.
// Runs the same ramp on both backends so a GPU-only instability is separable from
// one the reference solver shares.
interface StabilityRow {
  fixture: string;
  backend: 'webgl2' | 'reference';
  vertices: number;
  steps: number;
  timeStepScale?: number;
  firstBadStep: number | null;
  firstBadFoldPercent: number | null;
  firstBadKind: 'nonfinite' | 'strain' | null;
  maxStrainSeen: number;
  integrator?: 'euler' | 'verlet';
  firstBadTexture?: string;
  firstBadTextureStep?: number;
  maxAbsPositionAtFailure?: number;
  /** Run with the two farthest-apart triangles fixed part-way through the ramp. */
  pinned?: boolean;
  /** Run with one of them held and the other pulled, kept, and let go. */
  pulled?: boolean;
  error?: string;
}

declare global {
  interface Window {
    runStabilitySweep: (
      fixtureNames: string[],
      totalSteps: number,
      chunk: number,
      strainLimit: number,
      extraFolds?: Record<string, FoldDocument>,
      timeStepScale?: number,
      fineFrom?: number,
      integrationType?: 'euler' | 'verlet',
      pinAtFraction?: number,
      pullAtFraction?: number
    ) => StabilityRow[];
  }
}

/**
 * The nodes of the two triangles whose flat centroids are farthest apart.
 * Fixed mid-fold and then folded further, they hold a relative pose the rest of
 * the fold contradicts — the over-constrained pin set a user can make by
 * pinning both ends of a model.
 */
function farthestTrianglePairMask(model: OrigamiModel): Uint8Array {
  const { indices, vertexCount } = model.prepared;
  const mask = new Uint8Array(vertexCount);
  for (const t of farthestTrianglePair(model)) for (let corner = 0; corner < 3; corner += 1) mask[indices[t * 3 + corner]!] = 1;
  return mask;
}

function farthestTrianglePair(model: OrigamiModel): [number, number] {
  const { indices } = model.prepared;
  const rest = model.originalPositions;
  const triangles = indices.length / 3;
  const centre = (t: number, axis: number) =>
    (rest[indices[t * 3]! * 3 + axis]! + rest[indices[t * 3 + 1]! * 3 + axis]! + rest[indices[t * 3 + 2]! * 3 + axis]!) / 3;
  let best: [number, number] = [0, 0];
  let bestDistance = -1;
  for (let a = 0; a < triangles; a += 1) {
    for (let b = a + 1; b < triangles; b += 1) {
      const d = Math.hypot(centre(a, 0) - centre(b, 0), centre(a, 1) - centre(b, 1), centre(a, 2) - centre(b, 2));
      if (d > bestDistance) {
        bestDistance = d;
        best = [a, b];
      }
    }
  }
  return best;
}

/**
 * A pull across the rest of a ramp: hold one of the farthest-apart triangles,
 * grip the other, lift it and swing it sideways over a quarter of the run, keep
 * the shape, and drop the pose a little later. Returns what to do at each step.
 */
function scriptedPull(model: OrigamiModel, totalSteps: number, fromFraction: number) {
  const { indices, vertexCount } = model.prepared;
  const [held, gripped] = farthestTrianglePair(model);
  const mask = new Uint8Array(vertexCount);
  for (let corner = 0; corner < 3; corner += 1) mask[indices[held * 3 + corner]!] = 1;
  const nodes: [number, number, number] = [indices[gripped * 3]!, indices[gripped * 3 + 1]!, indices[gripped * 3 + 2]!];
  const direction: [number, number, number] = [Math.SQRT1_2, 0, Math.SQRT1_2];
  let started: [number, number, number] | null = null;
  let state: 'waiting' | 'pulling' | 'kept' | 'released' = 'waiting';
  return (solver: WebglSolver | ReferenceSolver, done: number) => {
    const fraction = done / totalSteps;
    if (state === 'waiting' && fraction >= fromFraction) {
      const positions = new Float32Array(vertexCount * 3);
      solver.readPositions(positions);
      started = [0, 0, 0];
      for (const node of nodes) for (let axis = 0; axis < 3; axis += 1) started[axis] += positions[node * 3 + axis]! / 3;
      solver.setFixedNodes(mask);
      solver.beginPull({ nodes, weights: [1 / 3, 1 / 3, 1 / 3], ray: { origin: [...started], direction } });
      state = 'pulling';
    }
    if (state === 'pulling' && started) {
      const progress = Math.min(1, (fraction - fromFraction) / 0.25);
      solver.movePull({
        origin: [started[0] - 0.3 * progress, started[1] + 0.5 * progress, started[2] + 0.3 * progress],
        direction,
      });
      if (progress >= 1) {
        solver.endPull('keep');
        state = 'kept';
      }
    }
    if (state === 'kept' && fraction >= fromFraction + 0.4) {
      solver.releasePose();
      state = 'released';
    }
  };
}

window.runStabilitySweep = (fixtureNames, totalSteps, chunk, strainLimit, extraFolds = {}, timeStepScale = 1, fineFrom = Number.POSITIVE_INFINITY, integrationType = 'euler', pinAtFraction = Number.POSITIVE_INFINITY, pullAtFraction = Number.POSITIVE_INFINITY) => {
  const rows: StabilityRow[] = [];
  const builders: Array<{ name: string; build: () => FoldDocument }> = [
    ...fixtureNames.flatMap((name) => {
      const fixture = FIXTURES.find((f) => f.name === name);
      return fixture ? [{ name, build: () => fixture.build() as FoldDocument }] : [];
    }),
    // Real imported geometry passed in from the driver, so a model that only
    // misbehaves outside the synthetic fixtures is still covered.
    ...Object.entries(extraFolds).map(([name, fold]) => ({
      name,
      build: () => structuredClone(fold) as FoldDocument,
    })),
  ];

  for (const entry of builders) {
    const name = entry.name;

    for (const backendId of ['webgl2', 'reference'] as const) {
      const model = new OrigamiModel(prepareFoldModel(entry.build(), { triangulate: true }));
      const row: StabilityRow = {
        fixture: name,
        backend: backendId,
        vertices: model.prepared.vertexCount,
        steps: totalSteps,
        firstBadStep: null,
        firstBadFoldPercent: null,
        firstBadKind: null,
        maxStrainSeen: 0,
        timeStepScale,
        integrator: integrationType,
        pinned: Number.isFinite(pinAtFraction),
        pulled: Number.isFinite(pullAtFraction),
      };
      const pinMaskForRun = Number.isFinite(pinAtFraction) ? farthestTrianglePairMask(model) : null;
      let pinnedYet = false;
      const pull = Number.isFinite(pullAtFraction) ? scriptedPull(model, totalSteps, pullAtFraction) : null;

      try {
        let solver: WebglSolver | ReferenceSolver;
        if (backendId === 'webgl2') {
          const canvas = document.createElement('canvas');
          canvas.width = 2;
          canvas.height = 2;
          if (!WebglSolver.isSupported(canvas)) {
            rows.push({ ...row, error: 'WebGL2 unsupported' });
            continue;
          }
          solver = new WebglSolver(canvas, model, { foldPercent: 0, timeStepScale, integrationType });
        } else {
          solver = new ReferenceSolver(model, { foldPercent: 0, timeStepScale, integrationType });
        }

        for (let done = 0; done < totalSteps; ) {
          const thisChunk = done >= fineFrom ? 1 : chunk;
          // Ramp the fold target across the run, the way playback does.
          const foldPercent = Math.min(100, (done / totalSteps) * 100);
          if (pinMaskForRun && !pinnedYet && done >= totalSteps * pinAtFraction) {
            solver.setFixedNodes(pinMaskForRun);
            pinnedYet = true;
          }
          solver.setFoldPercent(foldPercent);
          pull?.(solver, done);
          solver.step(thisChunk);
          done += thisChunk;

          // Pinpoint which texture first goes non-finite, which identifies the
          // pass that produced the NaN.
          if (backendId === 'webgl2' && row.firstBadTexture === undefined) {
            const internals = solver as unknown as {
              gl: { readTexture(n: string): Float32Array };
              packed: { dims: { faces: number; creases: number } };
            };
            const dims = internals.packed.dims;
            // Only the meaningful prefix of each texture: the power-of-two
            // padding texels are not real elements and legitimately hold
            // garbage, which would be a false positive.
            const targets: Array<[string, number]> = [
              ['u_normals', dims.faces],
              ['u_lastTheta', dims.creases],
              ['u_creaseGeo', dims.creases],
              ['u_lastVelocity', solver.vertexCount],
              ['u_lastPosition', solver.vertexCount],
            ];
            const badList: string[] = [];
            let maxAbsPos = 0;
            for (const [tex, count] of targets) {
              try {
                const raw = internals.gl.readTexture(tex);
                let bad = false;
                for (let k = 0; k < count * 4; k += 1) {
                  const v = raw[k]!;
                  if (!Number.isFinite(v)) bad = true;
                  else if (tex === 'u_lastPosition' && Math.abs(v) > maxAbsPos) maxAbsPos = Math.abs(v);
                }
                if (bad) badList.push(tex);
              } catch { /* texture may not exist */ }
            }
            if (badList.length) {
              row.firstBadTexture = badList.join('+');
              row.firstBadTextureStep = done;
              row.maxAbsPositionAtFailure = maxAbsPos;
            }
          }
          const velocity = solver.maxVelocity();
          // Nodal strain is the measure both backends define identically (the GPU
          // does not compute max *edge* strain at all), so compare on that.
          const diagnostics = solver.readDiagnostics();
          const strain = diagnostics.maxNodalStrain ?? diagnostics.maxEdgeStrain ?? 0;
          if (Number.isFinite(strain) && strain > row.maxStrainSeen) row.maxStrainSeen = strain;

          const nonFinite = !Number.isFinite(velocity) || !Number.isFinite(strain);
          const exceeds = Number.isFinite(strain) && strain > strainLimit;
          if ((nonFinite || exceeds) && row.firstBadStep === null) {
            row.firstBadStep = done;
            row.firstBadFoldPercent = foldPercent;
            row.firstBadKind = nonFinite ? 'nonfinite' : 'strain';
            break; // the first failure is the datum; afterwards it is garbage
          }
        }
        solver.dispose();
      } catch (cause) {
        row.error = cause instanceof Error ? cause.message : String(cause);
      }
      rows.push(row);
    }
  }

  return rows;
};

/** Step until the solver's velocity settles, or give up. True once settled. */
function settleGpu(solver: WebglSolver, maxSteps: number): boolean {
  for (let done = 0; done < maxSteps; done += 80) {
    solver.step(80);
    if (solver.maxVelocity() < 1e-5) return true;
  }
  return false;
}

function shapeBytes(shape: SolverShape): Uint8Array {
  const out = new Uint8Array(shape.offsets.byteLength + shape.theta.byteLength);
  out.set(new Uint8Array(shape.offsets.buffer, shape.offsets.byteOffset, shape.offsets.byteLength));
  out.set(new Uint8Array(shape.theta.buffer, shape.theta.byteOffset, shape.theta.byteLength), shape.offsets.byteLength);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function meanMs(calls: number, run: () => void): number {
  const started = performance.now();
  for (let call = 0; call < calls; call += 1) run();
  return (performance.now() - started) / calls;
}

/**
 * A shape read and put back on the GPU (`readShape`, `writeShape`): the round
 * trip is exact, a restored settled shape holds still with and without a pose,
 * and no crease changes side. Timed on every size, since a Diagram reads one
 * on every capture of a simulated step.
 */
window.runShapeChecks = () => {
  const rows: ShapeCheckRow[] = [];
  const settled = new Set(['bird-base', 'miura-8x8']);
  const sized = ['bird-base', 'miura-8x8', 'miura-32x32', 'boxpleat-24', 'miura-56x56', 'miura-80x80'];
  for (const name of sized) {
    const fixture = FIXTURES.find((candidate) => candidate.name === name);
    if (!fixture) continue;
    for (const integrationType of ['euler', 'verlet'] as const) {
      const solvers: WebglSolver[] = [];
      const make = (model: OrigamiModel, foldPercent: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const solver = new WebglSolver(canvas, model, { foldPercent, integrationType });
        solvers.push(solver);
        return solver;
      };
      const foldPercent = name === 'bird-base' ? 100 : 60;
      const fold = fixture.build();
      const modelOf = () => new OrigamiModel(prepareFoldModel(structuredClone(fold), { triangulate: true }));
      const model = modelOf();
      const { vertexCount } = model.prepared;
      const creases = model.prepared.creaseParams.length;
      const row: ShapeCheckRow = {
        fixture: name,
        integrator: integrationType,
        vertices: vertexCount,
        creases,
        roundTrip: false,
        positionsMatch: false,
        readShapeMs: 0,
        writeShapeMs: 0,
        readPositionsMs: 0,
      };
      try {
        const folded = make(model, foldPercent);
        const isSettled = settled.has(name) ? settleGpu(folded, 40_000) : (folded.step(200), false);
        // As the worker reads: after a tick, whose convergence readback has
        // already waited for the GPU.
        folded.maxVelocity();
        const shape = createSolverShape(vertexCount, creases);
        row.readShapeMs = meanMs(20, () => folded.readShape(shape));
        const positions = new Float32Array(vertexCount * 3);
        row.readPositionsMs = meanMs(20, () => folded.readPositions(positions));

        const restored = make(modelOf(), foldPercent);
        row.writeShapeMs = meanMs(20, () => restored.writeShape(shape, false));
        const back = createSolverShape(vertexCount, creases);
        restored.readShape(back);
        row.roundTrip = sameBytes(shapeBytes(back), shapeBytes(shape));
        const drawn = new Float32Array(vertexCount * 3);
        restored.readPositions(drawn);
        row.positionsMatch = sameBytes(new Uint8Array(drawn.buffer), new Uint8Array(positions.buffer));

        if (isSettled) {
          const moved = (solver: WebglSolver) => {
            const after = new Float32Array(vertexCount * 3);
            solver.step(400);
            solver.readPositions(after);
            return compare(positions, after).maxAbs;
          };
          const kept = make(modelOf(), foldPercent);
          kept.writeShape(shape, true);
          row.heldStill = { free: moved(restored), kept: moved(kept) };
          let stretch = 0;
          model.prepared.edgesVertices.forEach(([a, b], edge) => {
            const length = Math.hypot(
              positions[b * 3]! - positions[a * 3]!,
              positions[b * 3 + 1]! - positions[a * 3 + 1]!,
              positions[b * 3 + 2]! - positions[a * 3 + 2]!
            );
            stretch = Math.max(stretch, Math.abs(length / model.edgeRestLength(edge) - 1));
          });
          row.stretch = stretch;
          const after = createSolverShape(vertexCount, creases);
          restored.readShape(after);
          row.sidesKept = shape.theta.every((theta, crease) => Math.sign(after.theta[crease]!) === Math.sign(theta));
        }
      } catch (cause) {
        row.error = cause instanceof Error ? cause.message : String(cause);
      } finally {
        for (const solver of solvers) solver.dispose();
      }
      rows.push(row);
    }
  }
  return rows;
};

// Signal readiness to the driver.
document.title = 'gpu-parity-ready';
