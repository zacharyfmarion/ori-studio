// @vitest-environment jsdom
/**
 * The detect worker's runtime start, where ONNX Runtime's threads could fail
 * to load and leave the session it was building pending forever, with an
 * uncaught "[object Event]" as the only sign (ORI-STUDIO-1S).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpDetectWorkerApi } from './cpDetectWorker';

const { exposed, ort } = vi.hoisted(() => ({
  exposed: { api: null as unknown },
  ort: {
    env: { wasm: {} as { numThreads?: number; wasmPaths?: unknown } },
    InferenceSession: { create: vi.fn((): Promise<unknown> => new Promise(() => {})) },
  },
}));

vi.mock('comlink', () => ({
  expose: (api: unknown) => {
    exposed.api = api;
  },
}));
vi.mock('onnxruntime-web/webgpu', () => ort);
vi.mock('../generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm', () => ({
  default: async () => undefined,
  cp_detect_parse_model_manifest: () => ({ id: 'synthetic', outputs: {} }),
  cp_detect_ablate_dense_outputs: vi.fn(),
  cp_detect_auto_rectify_rgba: vi.fn(),
  cp_detect_crease_pattern_likelihood: vi.fn(),
  cp_detect_decode_dense_output_bundle: vi.fn(),
  cp_detect_decode_dense_output_bundle_with_source_image_line_evidence: vi.fn(),
  cp_detect_decode_dense_output_bundle_with_junction_source: vi.fn(),
  cp_detect_manual_rectify_rgba: vi.fn(),
  cp_detect_manual_rectify_pixel_rgba: vi.fn(),
  cp_detect_measure_source_image: vi.fn(),
  cp_detect_decode_pixel_evidence: vi.fn(),
  cp_detect_package_info: vi.fn(),
  cp_detect_solve_exact: vi.fn(),
  cp_detect_solve_exact_to_fold: vi.fn(),
}));
vi.mock('../lib/cpDetectInference', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/cpDetectInference')>()),
  fetchCpDetectModelManifest: async () => '{}',
}));
vi.mock('../lib/cpDetectModels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/cpDetectModels')>()),
  defaultCpDetectModelStore: () => ({}),
  ensureCpDetectModelInstalled: async () => ({ bytes: new Uint8Array(4), source: 'installed' }),
}));

/** Stands in for a nested `Worker`, which jsdom does not have. */
class FakeThread extends EventTarget {}

const MODEL = { id: 'synthetic', model_url: '/synthetic.onnx', sha256: '00' };

async function freshWorker(): Promise<CpDetectWorkerApi> {
  vi.resetModules();
  await import('./cpDetectWorker');
  return exposed.api as CpDetectWorkerApi;
}

/**
 * What the browser does when one of the runtime's threads cannot load: the
 * thread's worker gets a plain `Event`, the runtime's glue rethrows it, and the
 * exception nothing caught is reported at this worker's global scope.
 */
function threadFailsToLoad(): ErrorEvent {
  const thread = new FakeThread();
  const loadFailure = new Event('error');
  thread.dispatchEvent(loadFailure);
  const report = new ErrorEvent('error', { error: loadFailure, message: 'Uncaught [object Event]', cancelable: true });
  self.dispatchEvent(report);
  return report;
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeThread);
  vi.stubGlobal('crossOriginIsolated', true);
  ort.env.wasm = {};
  ort.InferenceSession.create.mockReset().mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cp-detect worker runtime start', () => {
  it('fails the session it was building when a thread cannot load, instead of waiting forever', async () => {
    vi.stubGlobal('navigator', { ...navigator, gpu: {}, hardwareConcurrency: 8 });
    const api = await freshWorker();
    const pending = api.loadModel({ model: MODEL as never, manifestUrl: '/manifest.json' });
    await vi.waitFor(() => expect(ort.InferenceSession.create).toHaveBeenCalled());

    const report = threadFailsToLoad();

    await expect(pending).rejects.toMatchObject({ code: 'cp_detect_threads_unavailable' });
    // Handled here, so it is not a crash of the worker as well.
    expect(report.defaultPrevented).toBe(true);
    // WebGPU failing this way is not a reason to try wasm: the runtime is the stuck part.
    expect(ort.InferenceSession.create).toHaveBeenCalledOnce();
    expect(ort.env.wasm.numThreads).toBe(4);
  });

  it('starts no threads once the page has limited it to one', async () => {
    vi.stubGlobal('navigator', { ...navigator, hardwareConcurrency: 8 });
    const api = await freshWorker();
    await api.limitWasmThreads(1);
    void api.loadModel({ model: MODEL as never, manifestUrl: '/manifest.json' });
    await vi.waitFor(() => expect(ort.InferenceSession.create).toHaveBeenCalled());

    expect(ort.env.wasm.numThreads).toBe(1);
  });
});
