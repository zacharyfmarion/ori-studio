/**
 * The model manager's state: what the registry publishes, what this device
 * holds, and the verbs on them. Downloads happen here, on the main thread,
 * through the same fetch-verify-store path the worker uses, so a model
 * installed from Settings is exactly what a Detect would have installed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cpDetectModelStatus,
  CP_DETECT_MODEL_FAMILY,
  defaultCpDetectModelStore,
  ensureCpDetectModelInstalled,
  fetchCpDetectModelRegistry,
  type CpDetectInstalledModel,
  type CpDetectModelDownloadProgress,
  type CpDetectModelRegistry,
  type CpDetectModelStore,
  type CpDetectModelVersion,
} from '../../lib/cpDetectModels';
import { DEFAULT_CP_DETECT_MODEL_MANIFEST_URL } from '../../lib/cpDetectInference';
import { cpDetectModelBaseUrl } from '../../platform/features';
import { getRuntimeSurface } from '../../platform/runtime';

export interface DetectorModelRow {
  version: CpDetectModelVersion;
  installed: boolean;
  current: boolean;
}

export interface DetectorModelsState {
  status: 'loading' | 'ready' | 'unavailable';
  /** Why the registry could not be read, when it could not. */
  reason: string | null;
  rows: DetectorModelRow[];
  /** Installed models the registry no longer lists — removable, never used. */
  orphaned: CpDetectInstalledModel[];
  /** The id being downloaded, and how far along. */
  downloading: { id: string; progress: CpDetectModelDownloadProgress | null } | null;
  error: string | null;
  download: (version: CpDetectModelVersion) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export interface DetectorModelsDeps {
  fetchImpl?: typeof fetch;
  store?: CpDetectModelStore;
  base?: string;
}

function rowsFor(
  registry: CpDetectModelRegistry,
  installed: readonly CpDetectInstalledModel[]
): DetectorModelRow[] {
  const family = registry.families[CP_DETECT_MODEL_FAMILY];
  if (!family) return [];
  const installedIds = new Set(installed.map((model) => model.id));
  return [...family.versions]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      version,
      installed: installedIds.has(version.id),
      current: version.id === family.current,
    }));
}

export function useDetectorModels(deps: DetectorModelsDeps = {}): DetectorModelsState {
  const store = useMemo(() => deps.store ?? defaultCpDetectModelStore(), [deps.store]);
  const base = deps.base ?? cpDetectModelBaseUrl(getRuntimeSurface());
  const fetchImpl = deps.fetchImpl;
  const [registry, setRegistry] = useState<CpDetectModelRegistry | null>(null);
  const [installed, setInstalled] = useState<CpDetectInstalledModel[]>([]);
  const [status, setStatus] = useState<DetectorModelsState['status']>('loading');
  const [reason, setReason] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<DetectorModelsState['downloading']>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setStatus('loading');
    setReason(null);
    try {
      const [next, list] = await Promise.all([
        fetchCpDetectModelRegistry({
          fetchImpl,
          base,
          fallbackManifestUrl: base && !import.meta.env.DEV ? null : DEFAULT_CP_DETECT_MODEL_MANIFEST_URL,
        }),
        store.list(),
      ]);
      if (!alive.current) return;
      setRegistry(next);
      setInstalled(list);
      setStatus('ready');
    } catch (caught) {
      if (!alive.current) return;
      setInstalled(await store.list().catch(() => []));
      setStatus('unavailable');
      setReason(caught instanceof Error ? caught.message : String(caught));
    }
  }, [base, fetchImpl, store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const download = useCallback(
    async (version: CpDetectModelVersion) => {
      setError(null);
      setDownloading({ id: version.id, progress: null });
      try {
        await ensureCpDetectModelInstalled(version, store, {
          fetchImpl,
          onProgress: (progress) => {
            if (alive.current) setDownloading({ id: version.id, progress });
          },
        });
        if (!alive.current) return;
        setInstalled(await store.list());
      } catch (caught) {
        if (alive.current) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (alive.current) setDownloading(null);
      }
    },
    [fetchImpl, store]
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      await store.remove(id);
      if (alive.current) setInstalled(await store.list());
    },
    [store]
  );

  const rows = useMemo(() => (registry ? rowsFor(registry, installed) : []), [installed, registry]);
  const orphaned = useMemo(
    () => (registry ? (cpDetectModelStatus(registry, installed)?.orphaned ?? []) : installed),
    [installed, registry]
  );

  return { status, reason, rows, orphaned, downloading, error, download, remove, refresh };
}
