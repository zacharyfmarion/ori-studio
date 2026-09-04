import { describe, expect, it, vi } from 'vitest';
import { detectRuntimeProperties, detectorDeviceClass, loadDetectorModel } from './cpDetectModelState';
import { memoryModelStore, type CpDetectModelVersion } from '../lib/cpDetectModels';

function version(id: string, number: number): CpDetectModelVersion {
  return {
    id,
    version: number,
    released: '2026-07-08',
    size_bytes: 10,
    sha256: 'a'.repeat(64),
    manifest_url: `cp-detector/${id}/manifest.json`,
    model_url: `cp-detector/${id}/model.onnx`,
  };
}

function registryFetch(current: string, versions: CpDetectModelVersion[]): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        schema: 'oristudio/cp-detect-model-registry/v1',
        families: { 'cp-detector': { current, versions } },
      })
    )) as typeof fetch;
}

const manifest = { id: 'x', model: {}, inference: {}, outputs: {} } as never;

describe('loadDetectorModel', () => {
  it('runs the installed version and offers the newer current one', async () => {
    const store = memoryModelStore();
    await store.put('v4', new Uint8Array([1]), { sha256: 'a'.repeat(64) });
    const client = { modelStatus: vi.fn(async () => ({ manifest, version: version('v4', 4), installed: true })) };
    const state = await loadDetectorModel(client, {
      fetchImpl: registryFetch('v5', [version('v4', 4), version('v5', 5)]),
      store,
    });
    expect(state.active.id).toBe('v4');
    expect(state.installed).toBe(true);
    expect(state.update?.id).toBe('v5');
    expect(client.modelStatus).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.objectContaining({ id: 'v4' }) })
    );
  });

  it('runs current, not yet installed, when nothing is installed', async () => {
    const client = { modelStatus: vi.fn(async () => ({ manifest, version: version('v5', 5), installed: false })) };
    const state = await loadDetectorModel(client, {
      fetchImpl: registryFetch('v5', [version('v5', 5)]),
      store: memoryModelStore(),
    });
    expect(state.active.id).toBe('v5');
    expect(state.installed).toBe(false);
    expect(state.update).toBeNull();
  });
});

describe('device class and runtime properties', () => {
  it('reads a GPU first, then threads, then a single thread', () => {
    expect(detectorDeviceClass({ gpu: true, isolated: false, cores: 1 })).toBe('gpu');
    expect(detectorDeviceClass({ gpu: false, isolated: true, cores: 8 })).toBe('threads');
    expect(detectorDeviceClass({ gpu: false, isolated: false, cores: 8 })).toBe('single');
    expect(detectorDeviceClass({ gpu: false, isolated: true, cores: 1 })).toBe('single');
  });

  it('turns runtime facts into enums and buckets only', () => {
    expect(
      detectRuntimeProperties({
        active_execution_provider: 'webgpu',
        wasm_threads: 4,
        session_create_ms: 1234,
        total_inference_ms: 800,
        model_source: 'downloaded',
      })
    ).toEqual({
      execution_provider: 'webgpu',
      wasm_threads_bucket: '<=4',
      session_create_ms_bucket: '<=2500',
      inference_ms_bucket: '<=1000',
      model_source: 'downloaded',
    });
    expect(detectRuntimeProperties(undefined)).toEqual({});
  });
});
