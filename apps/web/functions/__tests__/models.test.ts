import { describe, expect, it, vi } from 'vitest';
import {
  cacheControlFor,
  handleModels,
  modelKey,
  parseRange,
  type ModelsContext,
  type ModelsEdgeCache,
  type ModelsR2,
  type ModelsR2Object,
} from '../_lib/models';

const MODEL = new TextEncoder().encode('0123456789abcdef');

function object(bytes: Uint8Array, contentType: string): ModelsR2Object {
  return {
    body: new Response(bytes as unknown as BodyInit).body,
    size: bytes.byteLength,
    httpEtag: '"etag-1"',
    writeHttpMetadata(headers) {
      headers.set('Content-Type', contentType);
    },
  };
}

function bucket(objects: Record<string, [Uint8Array, string]>): ModelsR2 & { gets: number } {
  const store = {
    gets: 0,
    async head(key: string) {
      const found = objects[key];
      return found ? object(found[0], found[1]) : null;
    },
    async get(key: string, options?: { range?: { offset: number; length?: number } }) {
      store.gets += 1;
      const found = objects[key];
      if (!found) return null;
      const [bytes, type] = found;
      const slice = options?.range
        ? bytes.slice(options.range.offset, options.range.offset + (options.range.length ?? bytes.byteLength))
        : bytes;
      return object(slice, type);
    },
  };
  return store;
}

function request(path: string, init: RequestInit = {}): ModelsContext {
  const r2 = bucket({
    'registry.json': [new TextEncoder().encode('{"schema":"x"}'), 'application/json'],
    'cp-detector/v5/model.onnx': [MODEL, 'application/octet-stream'],
    'cp-detector/v5/manifest.json': [new TextEncoder().encode('{}'), 'application/json'],
  });
  return {
    request: new Request(`https://oristudio.dev/models/${path}`, init),
    env: { MODELS_R2: r2 },
    params: { path: path.split('/') },
  };
}

function memoryCache(): ModelsEdgeCache & { entries: Map<string, Response> } {
  const entries = new Map<string, Response>();
  return {
    entries,
    async match(req) {
      return entries.get(req.url)?.clone();
    },
    async put(req, res) {
      entries.set(req.url, res);
    },
  };
}

describe('model keys', () => {
  it('accepts family/id/file for json and onnx, and the registry, and nothing else', () => {
    expect(modelKey(['cp-detector', 'v5', 'model.onnx'])).toBe('cp-detector/v5/model.onnx');
    expect(modelKey('cp-detector/v5/manifest.json')).toBe('cp-detector/v5/manifest.json');
    expect(modelKey(['registry.json'])).toBe('registry.json');
    expect(modelKey(['cp-detector', '..', 'model.onnx'])).toBeNull();
    expect(modelKey(['cp-detector', 'v5', 'model.bin'])).toBeNull();
    expect(modelKey(['cp-detector', 'v5'])).toBeNull();
    expect(modelKey(['.hidden', 'v5', 'model.onnx'])).toBeNull();
    expect(modelKey(undefined)).toBeNull();
  });

  it('caches the registry briefly and everything else forever', () => {
    expect(cacheControlFor('registry.json')).toContain('max-age=300');
    expect(cacheControlFor('cp-detector/v5/model.onnx')).toContain('immutable');
  });

  it('parses the one range form it serves', () => {
    expect(parseRange('bytes=0-0', 16)).toEqual({ offset: 0, length: 1 });
    expect(parseRange('bytes=4-', 16)).toEqual({ offset: 4, length: 12 });
    expect(parseRange('bytes=4-99', 16)).toEqual({ offset: 4, length: 12 });
    expect(parseRange('bytes=16-', 16)).toBeNull();
    expect(parseRange('items=1-2', 16)).toBeNull();
  });
});

describe('serving a model', () => {
  it('streams the object with immutable, CORS and CORP headers, and fills the edge cache', async () => {
    const cache = memoryCache();
    const context = request('cp-detector/v5/model.onnx');
    const response = await handleModels(context, cache);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Content-Length')).toBe(String(MODEL.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(MODEL.byteLength);
    expect(cache.entries.size).toBe(1);

    // The second whole GET is answered from the edge without touching R2.
    const again = await handleModels(context, cache);
    expect(again.status).toBe(200);
    expect((context.env.MODELS_R2 as ModelsR2 & { gets: number }).gets).toBe(1);
  });

  it('answers a first-byte probe with 206 and the total size, uncached', async () => {
    const cache = memoryCache();
    const response = await handleModels(
      request('cp-detector/v5/model.onnx', { headers: { Range: 'bytes=0-0' } }),
      cache
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(`bytes 0-0/${MODEL.byteLength}`);
    expect(response.headers.get('Content-Length')).toBe('1');
    expect(cache.entries.size).toBe(0);
  });

  it('answers HEAD with the size and no body', async () => {
    const response = await handleModels(request('cp-detector/v5/model.onnx', { method: 'HEAD' }), null);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe(String(MODEL.byteLength));
    expect(response.body).toBeNull();
  });

  it('serves the registry fresh, never from the edge cache', async () => {
    const cache = memoryCache();
    const response = await handleModels(request('registry.json'), cache);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('max-age=300');
    expect(cache.entries.size).toBe(0);
  });

  it('404s an absent object and a bad key, and refuses other methods', async () => {
    expect((await handleModels(request('cp-detector/v4/model.onnx'), null)).status).toBe(404);
    expect((await handleModels(request('nope'), null)).status).toBe(404);
    expect((await handleModels(request('registry.json', { method: 'POST' }), null)).status).toBe(405);
  });

  it('416s a range past the end', async () => {
    const response = await handleModels(
      request('cp-detector/v5/model.onnx', { headers: { Range: 'bytes=99-' } }),
      null
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe(`bytes */${MODEL.byteLength}`);
  });

  it('awaits the cache write when the platform gives it no waitUntil, and defers it when it does', async () => {
    const cache = memoryCache();
    const waitUntil = vi.fn();
    const context = { ...request('cp-detector/v5/model.onnx'), waitUntil };
    await handleModels(context, cache);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
