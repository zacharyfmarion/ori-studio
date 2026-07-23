// Runs in a real browser (via the parity bench). Exposes a function that folds
// each fixture with both the GPU solver and the reference solver and returns the
// divergence, so the Playwright driver can assert on it. WebGL2 is unavailable
// in Node, so this is the only place the GPU solver can actually be exercised.
import { prepareFoldModel } from '../../src/prepare.js';
import { OrigamiModel } from '../../src/model.js';
import { ReferenceSolver } from '../../src/referenceSolver.js';
import { WebglSolver } from '../../src/webgl/webglSolver.js';
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

declare global {
  interface Window {
    runGpuParity: (foldPercent: number, stepCounts: number[]) => GpuParityRow[];
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

// Signal readiness to the driver.
document.title = 'gpu-parity-ready';
