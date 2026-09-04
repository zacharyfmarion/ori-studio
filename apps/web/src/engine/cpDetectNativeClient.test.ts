import { describe, expect, it, vi } from 'vitest';
import { nativeCpDetectClient, nativeCpExactSolveSession } from './cpDetectNativeClient';
import { CpExactSolveCancelledError } from './cpExactSolveSession';
import { memoryModelStore, sha256Hex } from '../lib/cpDetectModels';
import { tauriModelStore } from '../lib/cpDetectModelsTauri';
import type { CpDetectClient } from '../store/workspaceStore/cpDetectRuntime';

const MODEL = new TextEncoder().encode('bytes');

/** jsdom has no ImageData; the client only reads width, height and the pixel buffer. */
function image(size: number): ImageData {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4), colorSpace: 'srgb' } as ImageData;
}

async function manifestText(): Promise<string> {
  return JSON.stringify({
    schema: 'oristudio/cp-detect-model-manifest/v1',
    id: 'native-model',
    created_at: '2026-07-08',
    model: { url: 'model.onnx', sha256: await sha256Hex(MODEL), size_bytes: MODEL.byteLength, format: 'onnx' },
    inference: { image_size: 4, threshold: 0.65, junction_offset_radius_px: 3 },
    outputs: {},
  });
}

function fetchOf(text: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('manifest.json')) return new Response(text);
    if (url.endsWith('model.onnx')) return new Response(MODEL);
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
}

function recognizedResponse() {
  const fold = { cp_detector: { source: 'exact_solve_candidate' }, vertices_coords: [], edges_vertices: [] };
  return {
    fold_json: JSON.stringify(fold),
    report: {
      status: 'recognized',
      decoder_backend: 'legacy_candidate_exact_solve_v1',
      quality_report: {
        junction_source: 'dense-model',
        compiler_report: {
          solve: { attempted: false, budget: { total_seconds: 25, spent_seconds: 0, policy: 'x' } },
          exact_solve_input: { schema: 'exact-solve-input-v1' },
          topology_diagnostics: {
            blockers: [],
            combinatorial: {
              odd_degree_vertices: [],
              degree_two_vertices: [],
              maekawa_failures: [],
              degenerate_edges: [],
              unmodeled_crossings: [],
              boundary_failures: [],
            },
          },
        },
      },
    },
    runtime: { active_execution_provider: 'coreml', model_id: 'native-model', total_inference_ms: 420 },
  };
}

describe('the native detect client', () => {
  it('installs the model on the device, then recognizes over a raw RGBA body with the manifest in headers', async () => {
    const invokeMock = vi.fn(async (command: string) =>
      command === 'cp_detect_recognize' ? recognizedResponse() : undefined
    );
    const store = memoryModelStore();
    const worker = { autoRectifyImage: vi.fn() } as unknown as CpDetectClient;
    const client = nativeCpDetectClient(worker, {
      invokeImpl: invokeMock as never,
      store,
      fetchImpl: fetchOf(await manifestText()),
    });

    const pixels = image(4);
    const progress: number[] = [];
    const result = await client.recognizeRectifiedFold(
      pixels,
      { manifestUrl: 'https://example.test/models/native/manifest.json', decoderBackend: 'legacy_candidate_exact_solve_v1' },
      (p) => progress.push(p.loaded)
    );

    // Installed once, through the same verify-and-store path as the web.
    expect((await store.list()).map((m) => m.id)).toEqual(['native-model']);
    expect(progress.at(-1)).toBe(MODEL.byteLength);
    // The command got pixels, not JSON, and the manifest's numbers as headers.
    // Found rather than indexed: the client probes for native inference first.
    const recognizeCall = invokeMock.mock.calls.find(([c]) => c === 'cp_detect_recognize');
    const [command, body, options] = recognizeCall as unknown as [string, Uint8Array, { headers: Record<string, string> }];
    expect(command).toBe('cp_detect_recognize');
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.byteLength).toBe(4 * 4 * 4);
    expect(options.headers['x-width']).toBe('4');
    expect(JSON.parse(options.headers['x-options'])).toMatchObject({
      model_id: 'native-model',
      image_size: 4,
      threshold: 0.65,
      decoder_backend: 'legacy_candidate_exact_solve_v1',
      junction_source: 'dense-model',
      recognize_only: true,
    });
    // Post-processed the way the worker does it.
    expect(result.status).toBe('recognized');
    expect(result.candidateSource).toBe('exact_solve_candidate');
    expect(result.lineEvidenceSource).toBe('source-image');
    expect(result.runtime?.model_source).toBe('downloaded');
    expect(result.runtime?.active_execution_provider).toBe('coreml');

    // A second run finds the model installed and downloads nothing.
    const again = await client.recognizeRectifiedFold(pixels, { manifestUrl: 'https://example.test/models/native/manifest.json' });
    expect(again.runtime?.model_source).toBe('installed');
  });

  it('leaves rectification with the worker', async () => {
    const worker = { autoRectifyImage: vi.fn(async () => 'rectified') } as unknown as CpDetectClient;
    const client = nativeCpDetectClient(worker, { invokeImpl: vi.fn() as never, store: memoryModelStore() });
    expect(await client.autoRectifyImage(image(2))).toBe('rectified');
  });
});

/**
 * Intel macOS and Linux ship without ONNX Runtime linked — no prebuilt for the
 * first, too new a libstdc++ for the second — so those builds answer
 * `cp_detect_native_inference_available` with false. Inference and the model
 * store go to the worker there; the exact solver is pure Rust and does not.
 */
describe('a desktop build with no native inference', () => {
  function unavailable(worker: CpDetectClient, invokeImpl = vi.fn()) {
    return {
      client: nativeCpDetectClient(worker, {
        invokeImpl: invokeImpl as never,
        store: memoryModelStore(),
        nativeInferenceAvailable: async () => false,
      }),
      invokeImpl,
    };
  }

  it('recognizes and detects in the worker rather than over the IPC', async () => {
    const worker = {
      recognizeRectifiedFold: vi.fn(async () => ({ status: 'recognized' })),
      detectRectifiedFold: vi.fn(async () => ({ status: 'detected' })),
    } as unknown as CpDetectClient;
    const { client, invokeImpl } = unavailable(worker);

    const pixels = image(4);
    expect(await client.recognizeRectifiedFold(pixels, {})).toEqual({ status: 'recognized' });
    expect(await client.detectRectifiedFold(pixels, {})).toEqual({ status: 'detected' });

    expect(worker.recognizeRectifiedFold).toHaveBeenCalledWith(pixels, {}, undefined);
    expect(worker.detectRectifiedFold).toHaveBeenCalledWith(pixels, {}, undefined);
    // Never reached the native command, so it never needed a model on disk.
    expect(invokeImpl).not.toHaveBeenCalled();
  });

  it('lets the worker own the model too, so nothing downloads into a store no one reads', async () => {
    const worker = {
      loadModel: vi.fn(async () => 'worker-manifest'),
      modelStatus: vi.fn(async () => ({ installed: false })),
    } as unknown as CpDetectClient;
    const { client } = unavailable(worker);

    expect(await client.loadModel({})).toBe('worker-manifest');
    expect(await client.modelStatus({})).toEqual({ installed: false });
    expect(worker.loadModel).toHaveBeenCalled();
    expect(worker.modelStatus).toHaveBeenCalled();
  });

  it('still solves natively — the solver is pure Rust and links everywhere', async () => {
    const invokeImpl = vi.fn(async () => ({ status: 'solved' }));
    const worker = { solveExact: vi.fn() } as unknown as CpDetectClient;
    const { client } = unavailable(worker, invokeImpl);

    expect(await client.solveExact('{}')).toEqual({ status: 'solved' });
    expect(invokeImpl).toHaveBeenCalledWith('cp_detect_solve_exact', {
      args: { inputJson: '{}', optionsJson: '', runId: 0 },
    });
    expect(worker.solveExact).not.toHaveBeenCalled();
  });

  it('asks the backend once and remembers the answer', async () => {
    const invokeImpl = vi.fn(async (command: string) =>
      command === 'cp_detect_native_inference_available' ? false : undefined
    );
    const worker = {
      recognizeRectifiedFold: vi.fn(async () => ({ status: 'recognized' })),
    } as unknown as CpDetectClient;
    const client = nativeCpDetectClient(worker, { invokeImpl: invokeImpl as never, store: memoryModelStore() });

    await client.recognizeRectifiedFold(image(4), {});
    await client.recognizeRectifiedFold(image(4), {});

    const probes = invokeImpl.mock.calls.filter(([c]) => c === 'cp_detect_native_inference_available');
    expect(probes).toHaveLength(1);
    expect(worker.recognizeRectifiedFold).toHaveBeenCalledTimes(2);
  });

  it('treats a backend that does not know the command as native, so a skew fails loudly', async () => {
    const invokeImpl = vi.fn(async (command: string) => {
      if (command === 'cp_detect_native_inference_available') throw new Error('unknown command');
      return recognizedResponse();
    });
    const worker = { recognizeRectifiedFold: vi.fn() } as unknown as CpDetectClient;
    const client = nativeCpDetectClient(worker, {
      invokeImpl: invokeImpl as never,
      store: memoryModelStore(),
      fetchImpl: fetchOf(await manifestText()),
    });

    await client.recognizeRectifiedFold(image(4), { manifestUrl: 'https://example.test/models/native/manifest.json' });
    expect(invokeImpl.mock.calls.some(([c]) => c === 'cp_detect_recognize')).toBe(true);
    expect(worker.recognizeRectifiedFold).not.toHaveBeenCalled();
  });
});

describe('the native solve session', () => {
  it('runs the solve as a command and resolves a finished result', async () => {
    const invokeImpl = vi.fn(async () => ({ status: 'solved', movement_report: {} })) as never;
    const session = nativeCpExactSolveSession(invokeImpl);
    const solver = await session.solver;
    await expect(solver.solveExact('{}', '')).resolves.toMatchObject({ status: 'solved' });
    expect(invokeImpl).toHaveBeenCalledWith('cp_detect_solve_exact', {
      args: { inputJson: '{}', optionsJson: '', runId: expect.any(Number) },
    });
  });

  it('turns Stop into the cancel command and the cancelled error', async () => {
    let finish: (value: unknown) => void = () => {};
    const invokeImpl = vi.fn((command: string) =>
      command === 'cp_detect_solve_cancel' ? Promise.resolve(true) : new Promise((resolve) => (finish = resolve))
    ) as never;
    const session = nativeCpExactSolveSession(invokeImpl);
    const solver = await session.solver;
    const pending = solver.solveExact('{}', '');
    session.stop?.();
    expect(invokeImpl).toHaveBeenCalledWith('cp_detect_solve_cancel', { runId: expect.any(Number) });
    finish({ status: 'failed', movement_report: { cancelled: true } });
    await expect(pending).rejects.toBeInstanceOf(CpExactSolveCancelledError);
  });

  it('reads a result the solver marked cancelled as a Stop even without a press', async () => {
    const invokeImpl = vi.fn(async () => ({ status: 'failed', movement_report: { cancelled: true } })) as never;
    const session = nativeCpExactSolveSession(invokeImpl);
    const solver = await session.solver;
    await expect(solver.solveExact('{}', '')).rejects.toBeInstanceOf(CpExactSolveCancelledError);
  });
});

describe('the Tauri model store', () => {
  it('hands bytes across as a raw body with the id and digest as headers', async () => {
    const invokeImpl = vi.fn(async (command: string) => (command === 'cp_detect_model_list' ? [] : undefined)) as never;
    const store = tauriModelStore(invokeImpl);
    await store.put('m', MODEL, { sha256: 'a'.repeat(64) });
    expect(invokeImpl).toHaveBeenCalledWith('cp_detect_model_store', MODEL, {
      headers: { 'x-model-id': 'm', 'x-model-sha256': 'a'.repeat(64) },
    });
    expect(await store.get('m')).toBeNull();
  });
});
