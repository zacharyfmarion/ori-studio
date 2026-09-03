import { describe, expect, it, vi } from 'vitest';
import {
  CpDetectModelError,
  cacheApiModelStore,
  cpDetectModelStatus,
  currentCpDetectModel,
  downloadCpDetectModel,
  ensureCpDetectModelInstalled,
  fetchCpDetectModelRegistry,
  formatModelSize,
  parseCpDetectModelRegistry,
  registryFromManifest,
  sha256Hex,
  type CpDetectModelVersion,
} from './cpDetectModels';

const MODEL_BYTES = new TextEncoder().encode('not really a model, but bytes are bytes');

async function version(patch: Partial<CpDetectModelVersion> = {}): Promise<CpDetectModelVersion> {
  return {
    id: 'detector-v5',
    version: 5,
    released: '2026-07-08',
    size_bytes: MODEL_BYTES.byteLength,
    sha256: await sha256Hex(MODEL_BYTES),
    manifest_url: 'https://example.test/models/cp-detector/detector-v5/manifest.json',
    model_url: 'https://example.test/models/cp-detector/detector-v5/model.onnx',
    ...patch,
  };
}

function registryText(current = 'detector-v5', extra: Partial<CpDetectModelVersion>[] = []) {
  return JSON.stringify({
    schema: 'oristudio/cp-detect-model-registry/v1',
    families: {
      'cp-detector': {
        current,
        versions: [
          {
            id: 'detector-v4',
            version: 4,
            released: '2026-06-01',
            size_bytes: 10,
            sha256: 'a'.repeat(64),
            manifest_url: 'cp-detector/detector-v4/manifest.json',
            model_url: 'cp-detector/detector-v4/model.onnx',
          },
          {
            id: 'detector-v5',
            version: 5,
            released: '2026-07-08',
            size_bytes: 20,
            sha256: 'b'.repeat(64),
            manifest_url: 'cp-detector/detector-v5/manifest.json',
            model_url: 'cp-detector/detector-v5/model.onnx',
            note: 'search225',
          },
          ...extra,
        ],
      },
    },
  });
}

/** An in-memory Cache API: jsdom has none. */
function fakeCaches(): CacheStorage {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string): Promise<Cache> => {
    const entries = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, entries);
    const keyOf = (request: RequestInfo | URL) =>
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    return {
      async match(request: RequestInfo | URL) {
        return entries.get(keyOf(request))?.clone();
      },
      async put(request: RequestInfo | URL, response: Response) {
        entries.set(keyOf(request), response);
      },
      async delete(request: RequestInfo | URL) {
        return entries.delete(keyOf(request));
      },
      async keys() {
        return [...entries.keys()].map((url) => new Request(url));
      },
    } as unknown as Cache;
  };
  return { open } as unknown as CacheStorage;
}

function fetchOf(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    return route ? route() : new Response('nope', { status: 404, statusText: 'Not Found' });
  }) as typeof fetch;
}

describe('the model registry', () => {
  it('parses, resolves relative URLs against its own, and names the current version', async () => {
    const fetchImpl = fetchOf({
      'https://example.test/models/registry.json': () => new Response(registryText()),
    });
    const registry = await fetchCpDetectModelRegistry({
      fetchImpl,
      base: 'https://example.test/app/',
    });
    const current = currentCpDetectModel(registry);
    expect(current?.id).toBe('detector-v5');
    expect(current?.model_url).toBe('https://example.test/models/cp-detector/detector-v5/model.onnx');
    expect(current?.note).toBe('search225');
  });

  it('refuses a registry with the wrong schema or a malformed version', () => {
    expect(() => parseCpDetectModelRegistry('{"schema":"other","families":{}}')).toThrow(
      CpDetectModelError
    );
    expect(() =>
      parseCpDetectModelRegistry(
        JSON.stringify({
          schema: 'oristudio/cp-detect-model-registry/v1',
          families: { 'cp-detector': { current: 'x', versions: [{ id: 'x' }] } },
        })
      )
    ).toThrow(/malformed version/);
  });

  it('falls back to a manifest when no registry is served, the way a dev checkout is', async () => {
    const manifest = {
      schema: 'oristudio/cp-detect-model-manifest/v1',
      id: 'local-model',
      created_at: '2026-07-08',
      model: { url: 'model.onnx', sha256: 'c'.repeat(64), size_bytes: 45, format: 'onnx' },
      inference: { image_size: 1024, threshold: 0.65 },
      outputs: {},
    };
    const fetchImpl = fetchOf({
      'https://example.test/models/cp-detector-v3/manifest.json': () =>
        new Response(JSON.stringify(manifest)),
    });
    const registry = await fetchCpDetectModelRegistry({
      fetchImpl,
      base: 'https://example.test/',
      fallbackManifestUrl: '/models/cp-detector-v3/manifest.json',
    });
    const current = currentCpDetectModel(registry);
    expect(current?.id).toBe('local-model');
    expect(current?.model_url).toBe('https://example.test/models/cp-detector-v3/model.onnx');
    expect(current?.note).toBe('local');
    // The same shape a published registry has, so callers see one thing.
    expect(registryFromManifest(manifest as never, 'https://x/manifest.json').families['cp-detector'].current).toBe('local-model');
  });

  it('says registry_unavailable when neither the registry nor a fallback answers', async () => {
    await expect(
      fetchCpDetectModelRegistry({ fetchImpl: fetchOf({}), base: 'https://example.test/' })
    ).rejects.toMatchObject({ code: 'registry_unavailable' });
  });
});

describe('downloading a model', () => {
  it('streams with progress and accepts bytes that hash to the promise', async () => {
    const v = await version();
    const progress: number[] = [];
    const bytes = await downloadCpDetectModel(v, {
      fetchImpl: fetchOf({ [v.model_url]: () => new Response(MODEL_BYTES) }),
      onProgress: ({ loaded }) => progress.push(loaded),
    });
    expect(Array.from(bytes)).toEqual(Array.from(MODEL_BYTES));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(MODEL_BYTES.byteLength);
  });

  it('refuses bytes whose sha256 is not the registry’s', async () => {
    const v = await version({ sha256: 'd'.repeat(64) });
    await expect(
      downloadCpDetectModel(v, { fetchImpl: fetchOf({ [v.model_url]: () => new Response(MODEL_BYTES) }) })
    ).rejects.toMatchObject({ code: 'integrity' });
  });

  it('refuses a short download before hashing it', async () => {
    const v = await version({ size_bytes: MODEL_BYTES.byteLength + 1 });
    await expect(
      downloadCpDetectModel(v, { fetchImpl: fetchOf({ [v.model_url]: () => new Response(MODEL_BYTES) }) })
    ).rejects.toMatchObject({ code: 'integrity' });
  });

  it('reports a failed fetch as download_failed', async () => {
    const v = await version();
    await expect(downloadCpDetectModel(v, { fetchImpl: fetchOf({}) })).rejects.toMatchObject({
      code: 'download_failed',
    });
  });
});

describe('the Cache API store', () => {
  it('installs once, lists what it holds, and serves it back without a fetch', async () => {
    const v = await version();
    const store = cacheApiModelStore(fakeCaches());
    const fetchImpl = vi.fn(fetchOf({ [v.model_url]: () => new Response(MODEL_BYTES) }));

    const first = await ensureCpDetectModelInstalled(v, store, { fetchImpl });
    expect(first.source).toBe('downloaded');
    const second = await ensureCpDetectModelInstalled(v, store, { fetchImpl });
    expect(second.source).toBe('installed');
    expect(Array.from(second.bytes)).toEqual(Array.from(MODEL_BYTES));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: v.id, sha256: v.sha256, size_bytes: MODEL_BYTES.byteLength });
    expect(listed[0].installed_at).toMatch(/^\d{4}-/);
  });

  it('drops a stored model that no longer hashes and fetches it again', async () => {
    const v = await version();
    const store = cacheApiModelStore(fakeCaches());
    await store.put(v.id, new TextEncoder().encode('corrupted'), { sha256: v.sha256 });
    const onCorrupt = vi.fn();
    const result = await ensureCpDetectModelInstalled(v, store, {
      fetchImpl: fetchOf({ [v.model_url]: () => new Response(MODEL_BYTES) }),
      onCorrupt,
    });
    expect(result.source).toBe('downloaded');
    expect(onCorrupt).toHaveBeenCalledWith(v.id);
    expect(Array.from((await store.get(v.id)) ?? [])).toEqual(Array.from(MODEL_BYTES));
  });

  it('removes, and says whether it did', async () => {
    const store = cacheApiModelStore(fakeCaches());
    await store.put('m', MODEL_BYTES, { sha256: 'e'.repeat(64) });
    expect(await store.remove('m')).toBe(true);
    expect(await store.remove('m')).toBe(false);
    expect(await store.list()).toEqual([]);
  });
});

describe('model status', () => {
  it('offers an update when the installed version is older than current', () => {
    const registry = parseCpDetectModelRegistry(registryText('detector-v5'));
    const status = cpDetectModelStatus(registry, [
      { id: 'detector-v4', size_bytes: 10, sha256: 'a'.repeat(64), installed_at: '' },
    ]);
    expect(status?.installed?.id).toBe('detector-v4');
    expect(status?.updateAvailable).toBe(true);
    expect(status?.current.id).toBe('detector-v5');
  });

  it('offers nothing when current is installed, and flags what the registry no longer lists', () => {
    const registry = parseCpDetectModelRegistry(registryText('detector-v5'));
    const status = cpDetectModelStatus(registry, [
      { id: 'detector-v5', size_bytes: 20, sha256: 'b'.repeat(64), installed_at: '' },
      { id: 'detector-v1', size_bytes: 5, sha256: 'f'.repeat(64), installed_at: '' },
    ]);
    expect(status?.updateAvailable).toBe(false);
    expect(status?.orphaned.map((m) => m.id)).toEqual(['detector-v1']);
  });

  it('formats sizes the way a download notice needs them', () => {
    expect(formatModelSize(45_206_364)).toBe('45 MB');
    expect(formatModelSize(2_500_000)).toBe('2.5 MB');
    expect(formatModelSize(150_000_000)).toBe('150 MB');
  });
});
