/**
 * What the detect dialog knows about the model before the first image: which
 * version the registry points at, which is installed, and whether an update
 * is on offer. One function, mockable, so the dialog's tests need neither a
 * network nor a Cache API.
 */
import type { CpDetectModelManifest, CpDetectRuntimeInfo } from '../engine/cpDetectTypes';
import { DEFAULT_CP_DETECT_MODEL_MANIFEST_URL } from '../lib/cpDetectInference';
import {
  cpDetectModelStatus,
  defaultCpDetectModelStore,
  fetchCpDetectModelRegistry,
  type CpDetectModelRegistry,
  type CpDetectModelStore,
  type CpDetectModelVersion,
} from '../lib/cpDetectModels';
import { bucketCount, CP_DETECT_INFERENCE_MS_BUCKETS, DURATION_MS_BUCKETS } from '../analytics/events';

export interface DetectorModelState {
  registry: CpDetectModelRegistry;
  /** The version a detection will run: the installed one, or current when nothing is. */
  active: CpDetectModelVersion;
  manifest: CpDetectModelManifest;
  /** `active`'s bytes are in the store. */
  installed: boolean;
  /** A newer published version than `active`, offered rather than forced. */
  update: CpDetectModelVersion | null;
}

export interface DetectorModelClient {
  modelStatus(options: {
    model: CpDetectModelVersion;
    manifestUrl: string;
  }): Promise<{ manifest: CpDetectModelManifest; version: CpDetectModelVersion; installed: boolean }>;
}

export async function loadDetectorModel(
  client: DetectorModelClient,
  options: { fetchImpl?: typeof fetch; store?: CpDetectModelStore } = {}
): Promise<DetectorModelState> {
  const registry = await fetchCpDetectModelRegistry({
    fetchImpl: options.fetchImpl,
    fallbackManifestUrl: DEFAULT_CP_DETECT_MODEL_MANIFEST_URL,
  });
  const store = options.store ?? defaultCpDetectModelStore();
  const status = cpDetectModelStatus(registry, await store.list());
  if (!status) throw new Error('The model registry names no detector');
  const active = status.installed ?? status.current;
  const { manifest, installed } = await client.modelStatus({ model: active, manifestUrl: active.manifest_url });
  return {
    registry,
    active,
    manifest,
    installed,
    update: status.updateAvailable ? status.current : null,
  };
}

/**
 * What a device can bring to an inference, from what the page can see.
 * Enough for one sentence of expectation, never a promise.
 */
export type DetectorDeviceClass = 'gpu' | 'threads' | 'single';

export function detectorDeviceClass(
  probe: { gpu: boolean; isolated: boolean; cores: number } = {
    gpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
  }
): DetectorDeviceClass {
  if (probe.gpu) return 'gpu';
  if (probe.isolated && probe.cores > 1) return 'threads';
  return 'single';
}

/** The runtime facts of a detection as analytics properties: enums and buckets only. */
export function detectRuntimeProperties(runtime: CpDetectRuntimeInfo | undefined): Record<string, string> {
  if (!runtime) return {};
  const properties: Record<string, string> = {};
  if (runtime.active_execution_provider) properties.execution_provider = runtime.active_execution_provider;
  if (runtime.wasm_threads !== undefined) properties.wasm_threads_bucket = bucketCount(runtime.wasm_threads, [1, 2, 4, 8]);
  if (runtime.session_create_ms !== undefined) properties.session_create_ms_bucket = bucketCount(runtime.session_create_ms, DURATION_MS_BUCKETS);
  if (runtime.total_inference_ms !== undefined) properties.inference_ms_bucket = bucketCount(runtime.total_inference_ms, CP_DETECT_INFERENCE_MS_BUCKETS);
  if (runtime.model_source) properties.model_source = runtime.model_source;
  return properties;
}
