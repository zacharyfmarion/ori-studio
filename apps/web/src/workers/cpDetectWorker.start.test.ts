/**
 * The detect worker's wasm start, over a mocked bridge (ORI-STUDIO-15).
 *
 * The detector's wasm is fetched inside the worker the first time a call needs
 * it. A download cut off on a dropped connection rejects that call without
 * killing the worker, so the runtime keeps it: if the failed start were kept
 * too, every later call on that worker would answer the same failure without
 * asking the network again, and the gate and Detect would stay broken until
 * the page reloaded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpDetectWorkerApi } from './cpDetectWorker';

const worker = vi.hoisted(() => ({
  api: null as unknown,
  inits: 0,
  /** Whether the next start fails, as a download cut off partway does. */
  failNextInit: false,
}));

vi.mock('comlink', () => ({
  expose: (api: unknown) => {
    worker.api = api;
  },
}));

vi.mock('../generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm', () => ({
  default: async () => {
    worker.inits += 1;
    if (worker.failNextInit) {
      worker.failNextInit = false;
      throw new TypeError('WebAssembly compilation aborted: Network error: Response body loading was aborted');
    }
  },
  cp_detect_crease_pattern_likelihood: () => ({ score: 0.2, likely: false }),
  cp_detect_ablate_dense_outputs: vi.fn(),
  cp_detect_auto_rectify_rgba: vi.fn(),
  cp_detect_decode_dense_output_bundle: vi.fn(),
  cp_detect_decode_dense_output_bundle_with_source_image_line_evidence: vi.fn(),
  cp_detect_decode_dense_output_bundle_with_junction_source: vi.fn(),
  cp_detect_manual_rectify_rgba: vi.fn(),
  cp_detect_manual_rectify_pixel_rgba: vi.fn(),
  cp_detect_measure_source_image: vi.fn(),
  cp_detect_decode_pixel_evidence: vi.fn(),
  cp_detect_package_info: () => ({ name: 'synthetic' }),
  cp_detect_parse_model_manifest: vi.fn(),
  cp_detect_solve_exact: vi.fn(),
  cp_detect_solve_exact_to_fold: vi.fn(),
}));

/** A worker module of its own, as each spawned worker has. */
async function freshWorker(): Promise<CpDetectWorkerApi> {
  vi.resetModules();
  worker.api = null;
  await import('./cpDetectWorker');
  return worker.api as CpDetectWorkerApi;
}

const image = { width: 2, height: 2, data: new Uint8ClampedArray(16) } as ImageData;

beforeEach(() => {
  worker.inits = 0;
  worker.failNextInit = false;
});

describe('the detect worker’s wasm start', () => {
  it('fetches the wasm again on the next call after a download that was cut off', async () => {
    worker.failNextInit = true;
    const api = await freshWorker();

    await expect(api.creasePatternLikelihood(image)).rejects.toThrow(
      'WebAssembly compilation aborted: Network error: Response body loading was aborted'
    );
    await expect(api.creasePatternLikelihood(image)).resolves.toEqual({ score: 0.2, likely: false });
    expect(worker.inits).toBe(2);
  });

  it('starts the wasm once while it works', async () => {
    const api = await freshWorker();
    await api.creasePatternLikelihood(image);
    await api.packageInfo();
    expect(worker.inits).toBe(1);
  });
});
