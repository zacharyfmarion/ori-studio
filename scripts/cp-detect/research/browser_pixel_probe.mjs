// Research browser smoke/performance check, loaded through the app's Vite server.
import * as ort from 'onnxruntime-web/webgpu';
import mjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { runPixelInference } from '../../../apps/web/src/lib/cpDetectPixelInference';
import init, { cp_detect_decode_pixel_evidence } from '../../../apps/web/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm';

export async function recognizeWithWorker(manifestUrl, imageUrl) {
  const { getCpDetectClient, releaseCpDetectClient } = await import('../../../apps/web/src/store/workspaceStore/cpDetectRuntime');
  const bitmap = await createImageBitmap(await (await fetch(imageUrl)).blob());
  const canvas = new OffscreenCanvas(bitmap.width,bitmap.height);
  const context = canvas.getContext('2d'); context.drawImage(bitmap,0,0);
  const image = context.getImageData(0,0,bitmap.width,bitmap.height);
  const client = await getCpDetectClient();
  const started = performance.now();
  try {
    const rectified = await client.autoRectifyImage(image,1024);
    const result = await client.recognizeRectifiedFold(rectified.image, {
      manifestUrl:new URL(manifestUrl,location.href).href, executionProvider:'wasm', highResolutionSource:{image,quad:rectified.report.source_quad},
    });
    return {...result,totalMs:performance.now()-started};
  } catch (error) { throw new Error(JSON.stringify(error, Object.getOwnPropertyNames(error))); }
  finally { releaseCpDetectClient(); }
}

export async function recognize(modelUrl, imageUrl, solve = false) {
  ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
  ort.env.wasm.wasmPaths = { mjs, wasm };
  const begin = performance.now();
  await init();
  const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
  const bitmap = await createImageBitmap(await (await fetch(imageUrl)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  try {
    const result = await runPixelInference(session, (data, dims) => new ort.Tensor('float32', data, dims), image);
    const decodeStart = performance.now();
    const decoded = cp_detect_decode_pixel_evidence(image.data, result.crease, result.auxiliary,
      image.width, JSON.stringify(result.vertices), !solve, 20);
    return { ...decoded, vertices: result.vertices, tiles: result.tiles,
      inferenceMs: result.inferenceMs, decodeMs: performance.now() - decodeStart,
      totalMs: performance.now() - begin };
  } finally {
    await session.release();
  }
}

export async function benchmark(modelUrl, imageUrl, provider, repeats = 9) {
  ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
  ort.env.wasm.wasmPaths = { mjs, wasm };
  const adapter = await navigator.gpu?.requestAdapter();
  const begin = performance.now();
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: provider === 'webgpu' ? ['webgpu'] : ['wasm'],
  });
  const loadMs = performance.now() - begin;
  const bitmap = await createImageBitmap(await (await fetch(imageUrl)).blob());
  const canvas = new OffscreenCanvas(512, 512);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  const rgba = context.getImageData(0, 0, 512, 512).data;
  const values = new Float32Array(3 * 512 * 512);
  for (let i = 0; i < 512 * 512; i++) {
    for (let c = 0; c < 3; c++) values[c * 512 * 512 + i] = rgba[4 * i + c] / 255;
  }
  const tensor = new ort.Tensor('float32', values, [1, 3, 512, 512]);
  const times = [];
  let shape, samples;
  for (let i = 0; i < repeats; i++) {
    const started = performance.now();
    const output = await session.run({ [session.inputNames[0]]: tensor });
    const result = output[session.outputNames[0]];
    const data = await result.getData();
    times.push(performance.now() - started);
    shape = result.dims;
    samples = [...data.slice(0, 5)];
    for (const t of Object.values(output)) t.dispose();
  }
  tensor.dispose();
  await session.release();
  return { provider, adapter: adapter?.info, userAgent: navigator.userAgent,
    crossOriginIsolated, loadMs, times, shape, samples };
}
