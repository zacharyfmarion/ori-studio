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
    const [command, body, options] = invokeMock.mock.calls[0] as unknown as [string, Uint8Array, { headers: Record<string, string> }];
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
