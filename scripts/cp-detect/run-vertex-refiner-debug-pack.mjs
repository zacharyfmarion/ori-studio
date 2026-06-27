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
  const samplesDir = resolve(outDir, 'samples');
  await mkdir(samplesDir, { recursive: true });

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
      const startedAt = Date.now();
      try {
        const result = await runSample(page, sample, imageBase64, options, vertexRefinerFrame);
        const sampleDebugPath = resolve(samplesDir, `${sample.id}.json`);
        const payload = {
          schema: 'oristudio/cp-vertex-refiner-debug-sample/v1',
          sample_id: sample.id,
          input_png: sample.input_png,
          gt_graph: sample.gt_graph,
          render_metadata: sample.render_metadata ?? null,
          options: debugOptionsPayload(options),
          ...result,
        };
        await writeFile(sampleDebugPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        const row = {
          id: sample.id,
          ok: true,
          debug: `samples/${sample.id}.json`,
          manifest_id: result.manifestId,
          proposal_count: result.proposals.length,
          raw_vertex_count: result.rawVertices.length,
          merged_vertex_count: result.mergedVertices.length,
          frame: result.frame,
          elapsed_ms: Date.now() - startedAt,
        };
        rows.push(row);
        process.stdout.write(`${JSON.stringify(row)}\n`);
      } catch (error) {
        const row = {
          id: sample.id,
          ok: false,
          debug: null,
          error: error instanceof Error ? error.message : String(error),
          elapsed_ms: Date.now() - startedAt,
        };
        rows.push(row);
        process.stdout.write(`${JSON.stringify(row)}\n`);
      }
    }
  } finally {
    await browser.close();
  }

  const runManifest = {
    schema: 'oristudio/cp-vertex-refiner-debug-run/v1',
    implementation: 'browser-onnx-vertex-refiner-debug',
    generated_by: 'scripts/cp-detect/run-vertex-refiner-debug-pack.mjs',
    generated_at: new Date().toISOString(),
    pack: packPath,
    browser_url: url,
    vertex_refiner_manifest_url:
      options.vertexRefinerManifestUrl ?? '/models/cp-vertex-refiner-v3/manifest.json',
    vertex_refiner_model_url: options.vertexRefinerModelUrl ?? null,
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

async function bootstrapClient(page) {
  await page.evaluate(async () => {
    if (window.__cpDetectClient) return;
    const runtime = await import('/src/store/workspaceStore/cpDetectRuntime.ts');
    window.__cpDetectClient = await runtime.getCpDetectClient();
  });
}

async function runSample(page, sample, imageBase64, options, vertexRefinerFrame) {
  return page.evaluate(
    async ({
      base64,
      imageSize,
      vertexRefinerManifestUrl,
      vertexRefinerModelUrl,
      vertexRefinerFrame,
      refinerOptions,
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
      const workerOptions = {
        ...refinerOptions,
        vertexRefinerManifestUrl,
        vertexRefinerModelUrl,
        vertexRefinerFrame,
      };
      if (!window.__cpDetectClient) {
        const runtime = await import('/src/store/workspaceStore/cpDetectRuntime.ts');
        window.__cpDetectClient = await runtime.getCpDetectClient();
      }
      return window.__cpDetectClient.runVertexRefinerDebug(image, workerOptions);
    },
    {
      base64: imageBase64,
      imageSize: Number(options.imageSize ?? 1024),
      vertexRefinerManifestUrl:
        options.vertexRefinerManifestUrl ?? '/models/cp-vertex-refiner-v3/manifest.json',
      vertexRefinerModelUrl: options.vertexRefinerModelUrl ?? null,
      vertexRefinerFrame,
      refinerOptions: refinerOptions(options),
    }
  );
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

function refinerOptions(options) {
  return Object.fromEntries(
    [
      ['vertexRefinerProposalCap', numberOption(options.vertexRefinerProposalCap)],
      ['vertexRefinerGridStridePx', numberOption(options.vertexRefinerGridStridePx)],
      ['vertexRefinerHeatmapThreshold', numberOption(options.vertexRefinerHeatmapThreshold)],
      ['vertexRefinerBoundaryHeatmapThreshold', numberOption(options.vertexRefinerBoundaryHeatmapThreshold)],
      ['vertexRefinerNmsRadiusPx', numberOption(options.vertexRefinerNmsRadiusPx)],
      ['vertexRefinerMergeRadiusPx', numberOption(options.vertexRefinerMergeRadiusPx)],
      ['vertexRefinerBoundaryMergeRadiusPx', numberOption(options.vertexRefinerBoundaryMergeRadiusPx)],
      ['vertexRefinerMinSupport', numberOption(options.vertexRefinerMinSupport)],
      ['executionProvider', options.executionProvider],
    ].filter(([, value]) => value !== undefined && value !== null)
  );
}

function debugOptionsPayload(options) {
  return {
    image_size: Number(options.imageSize ?? 1024),
    ...refinerOptions(options),
  };
}

function numberOption(value) {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
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
