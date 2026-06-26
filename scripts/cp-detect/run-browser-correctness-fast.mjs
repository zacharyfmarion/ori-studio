#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packPath = resolve(root, options.pack);
  const packRoot = dirname(packPath);
  const pack = JSON.parse(await readFile(packPath, 'utf8'));
  const outDir = resolve(root, options.out);
  const predictionsDir = resolve(outDir, 'predictions');
  const reportsDir = resolve(outDir, 'reports');
  await mkdir(predictionsDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  const url = options.url ?? 'http://127.0.0.1:5175/';
  const browser = await chromium.launch({ headless: options.headed !== 'true' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(Number(options.timeoutMs ?? 240000));
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const rows = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await bootstrapClient(page);
    const samples = limitedSamples(pack.samples, options.limit);
    for (const sample of samples) {
      const inputPath = resolve(packRoot, sample.input_png);
      const imageBase64 = await readFile(inputPath, 'base64');
      const vertexRefinerFrame = await loadVertexRefinerFrame(packRoot, sample);
      const foldPath = resolve(predictionsDir, `${sample.id}.fold`);
      const reportPath = resolve(reportsDir, `${sample.id}.json`);
      const result = await runSample(page, sample, imageBase64, options, vertexRefinerFrame);
      await writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');
      if (result.ok) {
        await writeFile(foldPath, `${JSON.stringify(JSON.parse(result.foldJson), null, 2)}\n`, 'utf8');
      }
      const row = {
        id: sample.id,
        ok: result.ok,
        fold: result.ok ? `predictions/${sample.id}.fold` : null,
        report: `reports/${sample.id}.json`,
        status: result.report.status ?? 'failed',
        vertices: result.report.vertex_count ?? 0,
        edges: result.report.edge_count ?? 0,
        border_edges: result.report.border_edge_count ?? 0,
        junction_source: result.report.junction_source ?? 'dense-model',
        vertex_refiner_merged_vertices:
          result.report.vertex_refiner?.mergedVertexCount ?? undefined,
        error: result.error ?? undefined,
      };
      rows.push(row);
      process.stdout.write(`${JSON.stringify(row)}\n`);
    }
  } finally {
    await browser.close();
  }

  const runManifest = {
    schema: 'oristudio/cp-detect-correctness-run/v1',
    implementation: 'browser-onnx-wasm-fast',
    generated_by: 'scripts/cp-detect/run-browser-correctness-fast.mjs',
    generated_at: new Date().toISOString(),
    pack: packPath,
    browser_url: url,
    manifest_url: options.manifestUrl ?? '/models/cp-detector-v3/manifest.json',
    model_url: options.modelUrl ?? null,
    junction_source: options.junctionSource ?? 'dense-model',
    vertex_refiner_manifest_url:
      options.vertexRefinerManifestUrl ?? '/models/cp-vertex-refiner-v3/manifest.json',
    vertex_refiner_model_url: options.vertexRefinerModelUrl ?? null,
    vertex_refiner_frame_source: 'sample render_metadata v2_boundary.frame when available',
    threshold: options.threshold === undefined ? null : Number(options.threshold),
    decoder_backend: options.decoderBackend ?? null,
    exact_solve_timeout_seconds:
      options.exactSolveTimeoutSeconds === undefined
        ? null
        : Number(options.exactSolveTimeoutSeconds),
    sample_count: rows.length,
    ok_count: rows.filter((row) => row.ok).length,
    samples: rows,
    browser_errors: browserErrors,
  };
  await writeFile(resolve(outDir, 'run_manifest.json'), `${JSON.stringify(runManifest, null, 2)}\n`, 'utf8');
  if (browserErrors.length > 0) {
    process.stderr.write(`browser errors:\n${browserErrors.join('\n')}\n`);
  }
  if (runManifest.ok_count !== runManifest.sample_count) {
    process.exitCode = 1;
  }
}

async function runSample(page, sample, imageBase64, options, vertexRefinerFrame) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await runSampleOnce(page, sample, imageBase64, options, vertexRefinerFrame);
    } catch (error) {
      lastError = error;
      if (!isRecoverablePageReloadError(error) || attempt > 0) break;
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await bootstrapClient(page).catch(() => undefined);
    }
  }
  const error = lastError;
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    report: {
      schema: 'oristudio/cp-detect-correctness-sample-report/v1',
      sample_id: sample.id,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    },
  };
}

async function bootstrapClient(page) {
  await page.evaluate(async () => {
    if (window.__cpDetectClient) return;
    const runtime = await import('/src/store/workspaceStore/cpDetectRuntime.ts');
    window.__cpDetectClient = await runtime.getCpDetectClient();
  });
}

function isRecoverablePageReloadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Execution context was destroyed') ||
    message.includes("Cannot read properties of undefined (reading 'detectRectifiedFold')")
  );
}

async function runSampleOnce(page, sample, imageBase64, options, vertexRefinerFrame) {
  try {
    const detection = await page.evaluate(
      async ({
        base64,
        imageSize,
        manifestUrl,
        modelUrl,
        threshold,
        decoderBackend,
        junctionSource,
        vertexRefinerManifestUrl,
        vertexRefinerModelUrl,
        vertexRefinerFallback,
        vertexRefinerFrame,
        exactSolveTimeoutSeconds,
      }) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);
        if (bitmap.width !== imageSize || bitmap.height !== imageSize) {
          throw new Error(`Expected ${imageSize}x${imageSize}, got ${bitmap.width}x${bitmap.height}`);
        }
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create 2D canvas context');
        context.drawImage(bitmap, 0, 0);
        const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const options = { manifestUrl };
        if (modelUrl) options.modelUrl = modelUrl;
        if (threshold !== null && threshold !== undefined) options.threshold = threshold;
        if (decoderBackend) options.decoderBackend = decoderBackend;
        if (junctionSource) options.junctionSource = junctionSource;
        if (vertexRefinerManifestUrl) options.vertexRefinerManifestUrl = vertexRefinerManifestUrl;
        if (vertexRefinerModelUrl) options.vertexRefinerModelUrl = vertexRefinerModelUrl;
        if (vertexRefinerFallback) options.vertexRefinerFallback = vertexRefinerFallback;
        if (vertexRefinerFrame) options.vertexRefinerFrame = vertexRefinerFrame;
        if (exactSolveTimeoutSeconds !== null && exactSolveTimeoutSeconds !== undefined) {
          options.exactSolveTimeoutSeconds = exactSolveTimeoutSeconds;
        }
        const browserErrorMessage = (caught) => {
          if (caught instanceof Error) return caught.message;
          if (caught && typeof caught === 'object') {
            try {
              return JSON.stringify(caught);
            } catch {
              return Object.prototype.toString.call(caught);
            }
          }
          return String(caught);
        };
        try {
          if (!window.__cpDetectClient) {
            const runtime = await import('/src/store/workspaceStore/cpDetectRuntime.ts');
            window.__cpDetectClient = await runtime.getCpDetectClient();
          }
          return await window.__cpDetectClient.detectRectifiedFold(image, options);
        } catch (caught) {
          throw new Error(browserErrorMessage(caught));
        }
      },
      {
        base64: imageBase64,
        imageSize: Number(options.imageSize ?? 1024),
        manifestUrl: options.manifestUrl ?? '/models/cp-detector-v3/manifest.json',
        modelUrl: options.modelUrl ?? null,
        threshold: options.threshold === undefined ? null : Number(options.threshold),
        decoderBackend: options.decoderBackend ?? null,
        junctionSource: options.junctionSource ?? null,
        vertexRefinerManifestUrl: options.vertexRefinerManifestUrl ?? null,
        vertexRefinerModelUrl: options.vertexRefinerModelUrl ?? null,
        vertexRefinerFallback: options.vertexRefinerFallback ?? null,
        vertexRefinerFrame,
        exactSolveTimeoutSeconds:
          options.exactSolveTimeoutSeconds === undefined
            ? null
            : Number(options.exactSolveTimeoutSeconds),
      }
    );
    return {
      ok: true,
      foldJson: detection.foldJson,
      report: {
        schema: 'oristudio/cp-detect-correctness-sample-report/v1',
        sample_id: sample.id,
        status: detection.status,
        ...detection.detectorReport,
        manifest_id: detection.manifest?.id ?? null,
        junction_source: detection.junctionSource ?? detection.detectorReport?.quality_report?.junction_source ?? null,
        vertex_refiner: detection.vertexRefiner ?? null,
      },
    };
  } catch (error) {
    throw error;
  }
}

async function loadVertexRefinerFrame(packRoot, sample) {
  const metadataPath = sample.render_metadata
    ? resolve(packRoot, sample.render_metadata)
    : resolve(dirname(resolve(packRoot, sample.input_png)), 'render_metadata.json');
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    return paperFrameFromMetadataFrame(metadata?.v2_boundary?.frame);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function paperFrameFromMetadataFrame(frame) {
  if (!frame) return null;
  if (Array.isArray(frame) && frame.length === 4) {
    if (frame.every((value) => typeof value === 'number')) {
      const [xMin, yMin, xMax, yMax] = frame.map(Number);
      return finitePaperFrame(xMin, yMin, xMax, yMax);
    }
    const points = frame.map((point) => ({
      x: Number(point?.[0]),
      y: Number(point?.[1]),
    }));
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return null;
    }
    return finitePaperFrame(
      Math.min(...points.map((point) => point.x)),
      Math.min(...points.map((point) => point.y)),
      Math.max(...points.map((point) => point.x)),
      Math.max(...points.map((point) => point.y)),
    );
  }
  if (typeof frame === 'object') {
    return finitePaperFrame(
      Number(frame.x_min),
      Number(frame.y_min),
      Number(frame.x_max),
      Number(frame.y_max),
    );
  }
  return null;
}

function finitePaperFrame(xMin, yMin, xMax, yMax) {
  if (![xMin, yMin, xMax, yMax].every(Number.isFinite)) return null;
  if (xMax <= xMin || yMax <= yMin) return null;
  return {
    x_min: xMin,
    y_min: yMin,
    x_max: xMax,
    y_max: yMax,
  };
}

function limitedSamples(samples, limit) {
  if (limit === undefined || limit === null) return samples;
  const count = Number(limit);
  if (!Number.isFinite(count) || count <= 0) return samples;
  return samples.slice(0, Math.floor(count));
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${item}`);
    }
    const key = item.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = 'true';
    } else {
      options[key] = next;
      index += 1;
    }
  }
  if (!options.pack) throw new Error('Missing --pack');
  if (!options.out) throw new Error('Missing --out');
  return options;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? error}\n`);
  process.exit(1);
});
