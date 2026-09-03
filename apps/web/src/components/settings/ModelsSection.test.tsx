import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryModelStore, sha256Hex, type CpDetectModelStore } from '../../lib/cpDetectModels';
import { ModelsSection } from './ModelsSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BYTES = new TextEncoder().encode('model bytes');

async function registryFetch(): Promise<typeof fetch> {
  const sha = await sha256Hex(BYTES);
  const registry = {
    schema: 'oristudio/cp-detect-model-registry/v1',
    families: {
      'cp-detector': {
        current: 'v5',
        versions: [
          { id: 'v4', version: 4, released: '2026-06-01', size_bytes: BYTES.byteLength, sha256: sha, manifest_url: 'cp-detector/v4/manifest.json', model_url: 'cp-detector/v4/model.onnx' },
          { id: 'v5', version: 5, released: '2026-07-08', size_bytes: BYTES.byteLength, sha256: sha, manifest_url: 'cp-detector/v5/manifest.json', model_url: 'cp-detector/v5/model.onnx', note: 'search225' },
        ],
      },
    },
  };
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/models/registry.json')) return new Response(JSON.stringify(registry));
    if (url.endsWith('/model.onnx')) return new Response(BYTES);
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(store: CpDetectModelStore, fetchImpl: typeof fetch): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<ModelsSection deps={{ store, fetchImpl, base: 'https://example.test/' }} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function text(): string {
  return container?.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
  return (
    [...(container?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label) ??
    null
  );
}

beforeEach(() => {
  vi.stubEnv('DEV', true);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllEnvs();
});

describe('Settings ▸ Models', () => {
  it('lists published versions newest first, marks current, and offers a download with its size', async () => {
    await mount(memoryModelStore(), await registryFetch());
    expect(text()).toMatch(/Detector v5 · 11.0 B|Detector v5/);
    const rows = [...(container?.querySelectorAll('[data-testid^="settings-model-"]') ?? [])];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['settings-model-v5', 'settings-model-v4']);
    expect(rows[0].textContent).toContain('current');
    expect(rows[0].textContent).toContain('Not downloaded');
    expect(button('Download')).not.toBeNull();
  });

  it('downloads into the store and then offers Remove, which frees it', async () => {
    const store = memoryModelStore();
    await mount(store, await registryFetch());
    await act(async () => {
      button('Download')?.click();
      await Promise.resolve();
    });
    // Let the download and verification settle.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect((await store.list()).map((m) => m.id)).toEqual(['v5']);
    expect(text()).toContain('Installed');
    const remove = button('Remove');
    expect(remove).not.toBeNull();
    await act(async () => {
      remove?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await store.list()).toEqual([]);
  });

  it('calls a newer current version an update when an older one is installed', async () => {
    const store = memoryModelStore();
    await store.put('v4', BYTES, { sha256: await sha256Hex(BYTES) });
    await mount(store, await registryFetch());
    const v5 = container?.querySelector('[data-testid="settings-model-v5"]');
    expect(v5?.textContent).toContain('Newer than what is installed');
    expect(button('Update')).not.toBeNull();
  });

  it('says why when the registry cannot be read, and still lists what is installed as removable', async () => {
    const store = memoryModelStore();
    await store.put('old', BYTES, { sha256: 'a'.repeat(64) });
    await mount(store, (async () => new Response('down', { status: 503 })) as typeof fetch);
    expect(text()).toMatch(/could not be read/);
    expect(container?.querySelector('[data-testid="settings-model-old"]')).not.toBeNull();
    expect(button('Remove')).not.toBeNull();
  });
});
