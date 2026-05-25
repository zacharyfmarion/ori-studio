import { expose } from 'comlink';
import * as ort from 'onnxruntime-web';
import init, {
  cp_detect_auto_rectify_rgba,
  cp_detect_manual_rectify_rgba,
  cp_detect_package_info,
  cp_detect_parse_model_manifest,
} from '../generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm';
import type {
  CpDetectInferenceResult,
  CpDetectModelManifest,
  CpDetectQuad,
  CpDetectRectifiedImage,
  CpDetectRectificationReport,
  CpDetectWorkerRunOptions,
} from '../engine/cpDetectTypes';
import type { WasmErrorEnvelope } from '../engine/types';
import {
  DEFAULT_CP_DETECT_MODEL_MANIFEST_URL,
  fetchCpDetectModelManifest,
  runCpDetectDenseInference,
  type CpDetectOnnxSession,
} from '../lib/cpDetectInference';

let wasmReady: Promise<void> | null = null;
let sessionPromise: Promise<ort.InferenceSession> | null = null;
let manifestPromise: Promise<CpDetectModelManifest> | null = null;
let sessionKey: string | null = null;

async function ensureWasmReady() {
  wasmReady ??= init().then(() => undefined);
  await wasmReady;
}

async function loadManifest(manifestUrl: string): Promise<CpDetectModelManifest> {
  await ensureWasmReady();
  const text = await fetchCpDetectModelManifest(manifestUrl);
  return cp_detect_parse_model_manifest(text) as CpDetectModelManifest;
}

async function ensureManifest(manifestUrl: string): Promise<CpDetectModelManifest> {
  manifestPromise ??= loadManifest(manifestUrl);
  return manifestPromise;
}

async function ensureSession(
  manifest: CpDetectModelManifest,
  manifestUrl: string,
  modelUrlOverride?: string
): Promise<ort.InferenceSession> {
  const modelUrl = modelUrlOverride ?? resolveModelUrl(manifest.model.url, manifestUrl);
  if (sessionPromise && sessionKey === modelUrl) return sessionPromise;
  sessionKey = modelUrl;
  sessionPromise = ort.InferenceSession.create(modelUrl, sessionOptions());
  return sessionPromise;
}

function resolveModelUrl(modelUrl: string, manifestUrl: string): string {
  const manifestAbsoluteUrl = new URL(manifestUrl, self.location.href);
  return new URL(modelUrl, manifestAbsoluteUrl).toString();
}

function sessionOptions(): ort.InferenceSession.SessionOptions {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    return { executionProviders: ['webgpu', 'wasm'] };
  }
  return { executionProviders: ['wasm'] };
}

function normalizeError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'cp_detect',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function call<T>(fn: () => Promise<T> | T): Promise<T> {
  await ensureWasmReady();
  try {
    return await fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

const api = {
  async packageInfo(): Promise<unknown> {
    return call(() => cp_detect_package_info());
  },
  async loadModel(options: CpDetectWorkerRunOptions = {}): Promise<CpDetectModelManifest> {
    return call(async () => {
      const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
      const manifest = await ensureManifest(manifestUrl);
      await ensureSession(manifest, manifestUrl, options.modelUrl);
      return manifest;
    });
  },
  async autoRectifyImage(image: ImageData, imageSize = 1024): Promise<CpDetectRectifiedImage> {
    return call(() => rectifyFromWasm(cp_detect_auto_rectify_rgba(
      imageDataBytes(image),
      image.width,
      image.height,
      imageSize
    )));
  },
  async manualRectifyImage(
    image: ImageData,
    quad: CpDetectQuad,
    imageSize = 1024
  ): Promise<CpDetectRectifiedImage> {
    return call(() => rectifyFromWasm(cp_detect_manual_rectify_rgba(
      imageDataBytes(image),
      image.width,
      image.height,
      imageSize,
      JSON.stringify(quad)
    )));
  },
  async runDenseInference(
    image: ImageData,
    options: CpDetectWorkerRunOptions = {}
  ): Promise<CpDetectInferenceResult> {
    return call(async () => {
      const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
      const baseManifest = await ensureManifest(manifestUrl);
      const manifest = {
        ...baseManifest,
        inference: {
          ...baseManifest.inference,
          threshold: options.threshold ?? baseManifest.inference.threshold,
        },
      };
      const session = await ensureSession(manifest, manifestUrl, options.modelUrl);
      return runCpDetectDenseInference(
        cpDetectSessionFromOrt(session),
        {
          float32(data, dims) {
            return new ort.Tensor('float32', data, Array.from(dims));
          },
        },
        image,
        manifest
      );
    });
  },
};

type WasmRectifiedImage = {
  readonly width: number;
  readonly height: number;
  reportJson(): string;
  rgba(): Uint8Array;
  free?(): void;
};

function rectifyFromWasm(result: WasmRectifiedImage): CpDetectRectifiedImage {
  try {
    const report = JSON.parse(result.reportJson()) as CpDetectRectificationReport;
    const rgba = result.rgba();
    return {
      image: new ImageData(new Uint8ClampedArray(rgba), result.width, result.height),
      report,
    };
  } finally {
    result.free?.();
  }
}

function imageDataBytes(image: ImageData): Uint8Array {
  return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

function cpDetectSessionFromOrt(session: ort.InferenceSession): CpDetectOnnxSession {
  return {
    inputNames: session.inputNames,
    async run(feeds) {
      return session.run(feeds as Parameters<ort.InferenceSession['run']>[0]) as Promise<
        Record<string, unknown>
      >;
    },
  };
}

export type CpDetectWorkerApi = typeof api;

expose(api);
