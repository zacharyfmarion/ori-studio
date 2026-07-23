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

interface GpuParityRow {
  fixture: string;
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
  error?: string;
}

declare global {
  interface Window {
    runGpuParity: (foldPercent: number, stepCounts: number[]) => GpuParityRow[];
    runRenderCheck: () => RenderCheckRow[];
  }
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

window.runGpuParity = (foldPercent, stepCounts) => {
  const rows: GpuParityRow[] = [];

  for (const fixture of FIXTURES) {
    if (fixture.degenerate) continue;

    for (const steps of stepCounts) {
      const fold = fixture.build();

      const referenceModel = new OrigamiModel(prepareFoldModel(structuredClone(fold), { triangulate: true }));
      const reference = new ReferenceSolver(referenceModel, { foldPercent });
      reference.step(steps);
      const referencePositions = referenceModel.positions.slice(0, referenceModel.prepared.vertexCount * 3);

      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;

      let row: GpuParityRow = {
        fixture: fixture.name,
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
        const gpu = new WebglSolver(canvas, gpuModel, { foldPercent });
        gpu.step(steps);
        const gpuPositions = new Float32Array(gpuModel.prepared.vertexCount * 3);
        gpu.readPositions(gpuPositions);
        gpu.dispose();

        row = { ...row, ...compare(referencePositions, gpuPositions) };
      } catch (cause) {
        row = { ...row, error: cause instanceof Error ? cause.message : String(cause) };
      }
      rows.push(row);
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
  edgeColor: [0.1, 0.12, 0.14],
  lightDir: [-0.45, 0.58, 0.68],
  background: [0.05, 0.06, 0.07],
  showFaces: true,
  showEdges: true,
  lighting: true,
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
      };
    } catch (cause) {
      row = { ...row, error: cause instanceof Error ? cause.message : String(cause) };
    }
    rows.push(row);
  }

  return rows;
};

// Signal readiness to the driver.
document.title = 'gpu-parity-ready';
