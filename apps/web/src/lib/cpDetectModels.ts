/**
 * The detector's model as a versioned, downloaded, verified thing.
 *
 * A model is not an asset of the build. It is 45 MB the browser fetches once,
 * checks against the sha256 its manifest states, and keeps — in the Cache API
 * on the web, in the app data directory on desktop — until the user removes
 * it or a newer one replaces it. What is current is decided by a registry,
 * one small JSON the site serves with a short cache, listing every published
 * version of each model family and which one is `current`. Model objects sit
 * at immutable versioned keys; only the registry moves, so publishing is an
 * upload and a pointer, and rolling back is moving the pointer.
 *
 * Nothing here touches React or the store: the worker uses it to install a
 * model before a session, the dialog uses it to say what will download, and
 * the settings panel uses it to list and remove.
 */

import type { CpDetectModelManifest } from '../engine/cpDetectTypes';
import { getRuntimeSurface } from '../platform/runtime';
import { tauriModelStore } from './cpDetectModelsTauri';

export const CP_DETECT_MODEL_REGISTRY_URL = '/models/registry.json';
export const CP_DETECT_MODEL_FAMILY = 'cp-detector';
export const CP_DETECT_MODEL_CACHE_NAME = 'oristudio-cp-detect-models';
export const CP_DETECT_MODEL_REGISTRY_SCHEMA = 'oristudio/cp-detect-model-registry/v1';

/** How often the download progress callback fires, in bytes. */
const PROGRESS_STEP_BYTES = 512 * 1024;

export interface CpDetectModelVersion {
  /** Immutable model id; also the key the model is stored under. */
  id: string;
  /** Monotonic within a family: what "newer" compares. */
  version: number;
  /** ISO date. */
  released: string;
  size_bytes: number;
  sha256: string;
  /** Absolute, or relative to the registry's own URL. */
  manifest_url: string;
  model_url: string;
  note?: string;
}

export interface CpDetectModelFamily {
  current: string;
  versions: CpDetectModelVersion[];
}

export interface CpDetectModelRegistry {
  schema: typeof CP_DETECT_MODEL_REGISTRY_SCHEMA;
  families: Record<string, CpDetectModelFamily>;
}

export type CpDetectModelErrorCode =
  | 'registry_unavailable'
  | 'registry_invalid'
  | 'download_failed'
  | 'integrity';

export class CpDetectModelError extends Error {
  readonly code: CpDetectModelErrorCode;

  constructor(code: CpDetectModelErrorCode, message: string) {
    super(message);
    this.name = 'CpDetectModelError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVersion(value: unknown): CpDetectModelVersion | null {
  if (!isRecord(value)) return null;
  const { id, version, released, size_bytes, sha256, manifest_url, model_url, note } = value;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof version !== 'number' ||
    !Number.isFinite(version) ||
    typeof released !== 'string' ||
    typeof size_bytes !== 'number' ||
    !(size_bytes >= 0) ||
    typeof sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    typeof manifest_url !== 'string' ||
    typeof model_url !== 'string'
  ) {
    return null;
  }
  return {
    id,
    version,
    released,
    size_bytes,
    sha256,
    manifest_url,
    model_url,
    ...(typeof note === 'string' ? { note } : {}),
  };
}

/** Parse a registry document, refusing anything shaped wrong rather than guessing. */
export function parseCpDetectModelRegistry(text: string): CpDetectModelRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CpDetectModelError('registry_invalid', 'The model registry is not JSON');
  }
  if (!isRecord(parsed) || parsed.schema !== CP_DETECT_MODEL_REGISTRY_SCHEMA) {
    throw new CpDetectModelError('registry_invalid', 'The model registry has an unknown schema');
  }
  if (!isRecord(parsed.families)) {
    throw new CpDetectModelError('registry_invalid', 'The model registry lists no families');
  }
  const families: Record<string, CpDetectModelFamily> = {};
  for (const [name, family] of Object.entries(parsed.families)) {
    if (!isRecord(family) || typeof family.current !== 'string' || !Array.isArray(family.versions)) {
      throw new CpDetectModelError('registry_invalid', `Model family "${name}" is malformed`);
    }
    const versions = family.versions.map(readVersion);
    if (versions.some((entry) => entry === null)) {
      throw new CpDetectModelError('registry_invalid', `Model family "${name}" has a malformed version`);
    }
    families[name] = { current: family.current, versions: versions as CpDetectModelVersion[] };
  }
  return { schema: CP_DETECT_MODEL_REGISTRY_SCHEMA, families };
}

/** The version a family points at, or null when the pointer names nothing listed. */
export function currentCpDetectModel(
  registry: CpDetectModelRegistry,
  family: string = CP_DETECT_MODEL_FAMILY
): CpDetectModelVersion | null {
  const entry = registry.families[family];
  if (!entry) return null;
  return entry.versions.find((version) => version.id === entry.current) ?? null;
}

/** A registry's URLs made absolute against the URL the registry came from. */
export function resolveCpDetectModelRegistry(
  registry: CpDetectModelRegistry,
  registryUrl: string
): CpDetectModelRegistry {
  const families: Record<string, CpDetectModelFamily> = {};
  for (const [name, family] of Object.entries(registry.families)) {
    families[name] = {
      current: family.current,
      versions: family.versions.map((version) => ({
        ...version,
        manifest_url: new URL(version.manifest_url, registryUrl).toString(),
        model_url: new URL(version.model_url, registryUrl).toString(),
      })),
    };
  }
  return { schema: registry.schema, families };
}

/**
 * A one-version registry built from a manifest — the shape a dev checkout
 * has, where the model sits under `public/models` and no registry is
 * published — so every caller sees one shape.
 */
export function registryFromManifest(
  manifest: CpDetectModelManifest,
  manifestUrl: string,
  family: string = CP_DETECT_MODEL_FAMILY
): CpDetectModelRegistry {
  return {
    schema: CP_DETECT_MODEL_REGISTRY_SCHEMA,
    families: {
      [family]: {
        current: manifest.id,
        versions: [
          {
            id: manifest.id,
            version: 0,
            released: manifest.created_at ?? '',
            size_bytes: manifest.model.size_bytes ?? 0,
            // A manifest without a digest can only be a local one; the
            // download then goes unverified, which is what "local" means.
            sha256: manifest.model.sha256 ?? '',
            manifest_url: manifestUrl,
            model_url: new URL(manifest.model.url, manifestUrl).toString(),
            note: 'local',
          },
        ],
      },
    },
  };
}

export interface FetchCpDetectModelRegistryOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  /**
   * Where to look when the registry is not served — a dev server, which has
   * the model under `public/models` and nothing else. Null means no fallback.
   */
  fallbackManifestUrl?: string | null;
  /** What relative URLs resolve against; defaults to the page's own location. */
  base?: string;
}

/** The registry, with its URLs absolute, or the dev fallback built from a manifest. */
export async function fetchCpDetectModelRegistry(
  options: FetchCpDetectModelRegistryOptions = {}
): Promise<CpDetectModelRegistry> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.base ?? globalThis.location?.href ?? 'http://localhost/';
  const registryUrl = new URL(options.url ?? CP_DETECT_MODEL_REGISTRY_URL, base).toString();
  let failure: CpDetectModelError;
  try {
    const response = await fetchImpl(registryUrl);
    if (response.ok) {
      return resolveCpDetectModelRegistry(
        parseCpDetectModelRegistry(await response.text()),
        registryUrl
      );
    }
    failure = new CpDetectModelError(
      'registry_unavailable',
      `The model registry answered ${response.status}`
    );
  } catch (error) {
    failure =
      error instanceof CpDetectModelError
        ? error
        : new CpDetectModelError('registry_unavailable', describe(error));
  }
  if (options.fallbackManifestUrl) {
    const manifestUrl = new URL(options.fallbackManifestUrl, base).toString();
    const response = await fetchImpl(manifestUrl);
    if (response.ok) {
      const manifest = JSON.parse(await response.text()) as CpDetectModelManifest;
      return registryFromManifest(manifest, manifestUrl);
    }
  }
  throw failure;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatModelSize(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb >= 100 ? Math.round(mb) : mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface CpDetectModelDownloadProgress {
  loaded: number;
  /** The registry's size, or the response's length, or 0 when neither is known. */
  total: number;
}

export interface DownloadCpDetectModelOptions {
  fetchImpl?: typeof fetch;
  onProgress?: (progress: CpDetectModelDownloadProgress) => void;
}

/**
 * The model's bytes, fetched with progress and refused unless they hash to
 * what the registry promised. A truncated or tampered download is a loud
 * `integrity` error here rather than a cryptic runtime failure later.
 */
export async function downloadCpDetectModel(
  version: CpDetectModelVersion,
  options: DownloadCpDetectModelOptions = {}
): Promise<Uint8Array> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(version.model_url);
  } catch (error) {
    throw new CpDetectModelError('download_failed', describe(error));
  }
  if (!response.ok) {
    throw new CpDetectModelError(
      'download_failed',
      `The model download answered ${response.status} ${response.statusText}`.trim()
    );
  }
  const headerLength = Number(response.headers.get('Content-Length') ?? 0);
  const total = version.size_bytes || headerLength || 0;
  const bytes = await readWithProgress(response, total, options.onProgress);
  if (version.size_bytes && bytes.byteLength !== version.size_bytes) {
    throw new CpDetectModelError(
      'integrity',
      `The model download is ${bytes.byteLength} bytes; the registry expected ${version.size_bytes}`
    );
  }
  if (version.sha256 && (await sha256Hex(bytes)) !== version.sha256) {
    throw new CpDetectModelError('integrity', 'The model download does not match its published sha256');
  }
  return bytes;
}

async function readWithProgress(
  response: Response,
  total: number,
  onProgress: DownloadCpDetectModelOptions['onProgress']
): Promise<Uint8Array> {
  if (!response.body || !onProgress) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: bytes.byteLength, total: total || bytes.byteLength });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let reportedAt = 0;
  onProgress({ loaded: 0, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (loaded - reportedAt >= PROGRESS_STEP_BYTES) {
      reportedAt = loaded;
      onProgress({ loaded, total });
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress({ loaded, total: total || loaded });
  return bytes;
}

export interface CpDetectInstalledModel {
  id: string;
  size_bytes: number;
  sha256: string;
  /** ISO timestamp. */
  installed_at: string;
}

/** Where downloaded models live; one implementation per surface. */
export interface CpDetectModelStore {
  list(): Promise<CpDetectInstalledModel[]>;
  /** The bytes, for a runtime that takes them; null when not installed or when the store only holds files a native runtime opens by path. */
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array, meta: { sha256: string }): Promise<void>;
  /** True when something was removed. */
  remove(id: string): Promise<boolean>;
  /** Whether `id` is installed with exactly this digest. */
  installed(id: string, sha256: string): Promise<boolean>;
}

const MODEL_ID_HEADER = 'X-Model-Id';
const MODEL_SHA_HEADER = 'X-Model-Sha256';
const MODEL_INSTALLED_HEADER = 'X-Model-Installed-At';

function cacheKey(id: string): string {
  // Any absolute http(s) URL serves as a Cache API key; this host is never
  // fetched, it only names the entry.
  return `https://models.oristudio.invalid/cp-detect/${encodeURIComponent(id)}`;
}

/**
 * The web store: the Cache API, which holds tens of megabytes across sessions
 * on desktop browsers, survives reloads, and is shared by the page and its
 * workers — the worker installs, the settings panel lists.
 */
export function cacheApiModelStore(
  storage: CacheStorage = caches,
  cacheName: string = CP_DETECT_MODEL_CACHE_NAME
): CpDetectModelStore {
  async function entry(cache: Cache, request: Request): Promise<CpDetectInstalledModel | null> {
    const response = await cache.match(request);
    if (!response) return null;
    const id = response.headers.get(MODEL_ID_HEADER);
    const sha256 = response.headers.get(MODEL_SHA_HEADER);
    if (!id || !sha256) return null;
    return {
      id,
      sha256,
      size_bytes: Number(response.headers.get('Content-Length') ?? 0),
      installed_at: response.headers.get(MODEL_INSTALLED_HEADER) ?? '',
    };
  }
  return {
    async list() {
      const cache = await storage.open(cacheName);
      const entries = await Promise.all((await cache.keys()).map((request) => entry(cache, request)));
      return entries.filter((found): found is CpDetectInstalledModel => found !== null);
    },
    async get(id) {
      const cache = await storage.open(cacheName);
      const response = await cache.match(cacheKey(id));
      if (!response) return null;
      return new Uint8Array(await response.arrayBuffer());
    },
    async put(id, bytes, meta) {
      const cache = await storage.open(cacheName);
      await cache.put(
        cacheKey(id),
        new Response(bytes as BodyInit, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(bytes.byteLength),
            [MODEL_ID_HEADER]: id,
            [MODEL_SHA_HEADER]: meta.sha256,
            [MODEL_INSTALLED_HEADER]: new Date().toISOString(),
          },
        })
      );
    },
    async remove(id) {
      const cache = await storage.open(cacheName);
      return cache.delete(cacheKey(id));
    },
    async installed(id, sha256) {
      const cache = await storage.open(cacheName);
      const found = await entry(cache, new Request(cacheKey(id)));
      return found !== null && found.sha256 === sha256;
    },
  };
}

/** A store that holds nothing and remembers nothing: jsdom, and a browser without the Cache API. */
export function memoryModelStore(): CpDetectModelStore {
  const entries = new Map<string, { bytes: Uint8Array; meta: CpDetectInstalledModel }>();
  return {
    async list() {
      return [...entries.values()].map((entry) => entry.meta);
    },
    async get(id) {
      return entries.get(id)?.bytes ?? null;
    },
    async put(id, bytes, meta) {
      entries.set(id, {
        bytes,
        meta: { id, sha256: meta.sha256, size_bytes: bytes.byteLength, installed_at: new Date().toISOString() },
      });
    },
    async remove(id) {
      return entries.delete(id);
    },
    async installed(id, sha256) {
      return entries.get(id)?.meta.sha256 === sha256;
    },
  };
}

let sharedStore: CpDetectModelStore | null = null;

/**
 * This surface's store. The desktop shell's page keeps models as files in
 * the app data directory, where the native runtime opens them by path; the
 * web keeps them in the Cache API; a context with neither (jsdom, a worker on
 * desktop, an old browser) keeps them in memory.
 */
export function defaultCpDetectModelStore(): CpDetectModelStore {
  if (!sharedStore) {
    if (typeof window !== 'undefined' && getRuntimeSurface() === 'desktop') {
      sharedStore = tauriModelStore();
    } else if (typeof caches === 'undefined') {
      sharedStore = memoryModelStore();
    } else {
      sharedStore = cacheApiModelStore(caches);
    }
  }
  return sharedStore;
}

/**
 * Make sure `version` is on this device — installed with its digest, or
 * downloaded, verified and stored — without handing its bytes back. What the
 * desktop needs: its runtime opens the file itself.
 */
export async function ensureCpDetectModelOnDevice(
  version: CpDetectModelVersion,
  store: CpDetectModelStore,
  options: DownloadCpDetectModelOptions = {}
): Promise<'installed' | 'downloaded'> {
  if (await store.installed(version.id, version.sha256)) return 'installed';
  const bytes = await downloadCpDetectModel(version, options);
  await store.put(version.id, bytes, { sha256: version.sha256 });
  return 'downloaded';
}

export interface EnsureCpDetectModelOptions extends DownloadCpDetectModelOptions {
  /** Called when a stored model failed its check and is being fetched again. */
  onCorrupt?: (id: string) => void;
}

/**
 * The model's bytes from the store, or downloaded, verified and stored. A
 * stored model is hashed again before use — a hundred milliseconds against
 * feeding a corrupted file to the runtime — and one that fails is dropped and
 * fetched afresh.
 */
export async function ensureCpDetectModelInstalled(
  version: CpDetectModelVersion,
  store: CpDetectModelStore,
  options: EnsureCpDetectModelOptions = {}
): Promise<{ bytes: Uint8Array; source: 'installed' | 'downloaded' }> {
  const stored = await store.get(version.id);
  if (stored) {
    if (!version.sha256 || (await sha256Hex(stored)) === version.sha256) {
      return { bytes: stored, source: 'installed' };
    }
    options.onCorrupt?.(version.id);
    await store.remove(version.id);
  }
  const bytes = await downloadCpDetectModel(version, options);
  await store.put(version.id, bytes, { sha256: version.sha256 });
  return { bytes, source: 'downloaded' };
}

export interface CpDetectModelStatus {
  current: CpDetectModelVersion;
  /** The installed version of this family that is current, or the newest installed, or null. */
  installed: CpDetectModelVersion | null;
  /** Something newer than what is installed is published. */
  updateAvailable: boolean;
  /** Installed versions the registry no longer lists — removable, never used. */
  orphaned: CpDetectInstalledModel[];
}

/** What a surface says about a family: current, installed, and whether an update is on offer. */
export function cpDetectModelStatus(
  registry: CpDetectModelRegistry,
  installed: readonly CpDetectInstalledModel[],
  family: string = CP_DETECT_MODEL_FAMILY
): CpDetectModelStatus | null {
  const current = currentCpDetectModel(registry, family);
  const versions = registry.families[family]?.versions ?? [];
  if (!current) return null;
  const installedIds = new Set(installed.map((model) => model.id));
  const installedVersions = versions
    .filter((version) => installedIds.has(version.id))
    .sort((a, b) => b.version - a.version);
  const known = new Set(versions.map((version) => version.id));
  return {
    current,
    installed: installedVersions[0] ?? null,
    updateAvailable:
      installedVersions.length > 0 && installedVersions[0].version < current.version,
    orphaned: installed.filter((model) => !known.has(model.id)),
  };
}
