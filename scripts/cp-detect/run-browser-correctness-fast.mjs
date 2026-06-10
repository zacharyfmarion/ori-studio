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
    await page.evaluate(async () => {
      const runtime = await import('/src/store/workspaceStore/cpDetectRuntime.ts');
      window.__cpDetectClient = await runtime.getCpDetectClient();
    });
    for (const sample of pack.samples) {
      const inputPath = resolve(packRoot, sample.input_png);
      const imageBase64 = await readFile(inputPath, 'base64');
      const foldPath = resolve(predictionsDir, `${sample.id}.fold`);
      const reportPath = resolve(reportsDir, `${sample.id}.json`);
      const result = await runSample(page, sample, imageBase64, options);
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
    threshold: options.threshold === undefined ? null : Number(options.threshold),
    decoder_backend: options.decoderBackend ?? null,
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

async function runSample(page, sample, imageBase64, options) {
  try {
    const detection = await page.evaluate(
      async ({ base64, imageSize, manifestUrl, modelUrl, threshold, decoderBackend }) => {
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
        return window.__cpDetectClient.detectRectifiedFold(image, options);
      },
      {
        base64: imageBase64,
        imageSize: Number(options.imageSize ?? 1024),
        manifestUrl: options.manifestUrl ?? '/models/cp-detector-v3/manifest.json',
        modelUrl: options.modelUrl ?? null,
        threshold: options.threshold === undefined ? null : Number(options.threshold),
        decoderBackend: options.decoderBackend ?? null,
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
      },
    };
  } catch (error) {
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
