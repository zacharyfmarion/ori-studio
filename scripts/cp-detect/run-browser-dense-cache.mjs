#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_KEYS = [
  'line_logits',
  'junction_logits',
  'angle',
  'junction_offset',
  'assignment_logits',
  'non_crease_logits',
  'line_style_logits',
  'vertex_type_logits',
  'boundary_contact_logits',
  'boundary_side_logits',
  'boundary_offset',
  'boundary_coord',
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = performance.now();
  const packPath = resolve(root, options.pack);
  const packRoot = dirname(packPath);
  const pack = JSON.parse(await readFile(packPath, 'utf8'));
  const outDir = resolve(root, options.out);
  await mkdir(outDir, { recursive: true });

  const url = options.url ?? 'http://127.0.0.1:5175/';
  const manifestUrl = options.manifestUrl ?? '/models/cp-detector-v2/manifest.json';
  // Fail fast on the common fresh-checkout traps instead of hanging inside
  // the page (model assets are gitignored; node_modules may be stale). See
  // scripts/cp-detect/README.md "Fresh checkout prerequisites".
  await preflight(url, manifestUrl);

  const browser = await chromium.launch({ headless: options.headed !== 'true' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(Number(options.timeoutMs ?? 300000));
  const browserErrors = [];
  // Stream browser-side failures immediately: a failed worker or module load
  // otherwise turns into a silent hang awaiting an inference that never runs.
  const recordError = (text) => {
    browserErrors.push(text);
    process.stderr.write(`[browser] ${text}\n`);
  };
  page.on('pageerror', (error) => recordError(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') recordError(message.text());
  });
  page.on('requestfailed', (request) => recordError(`request failed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) recordError(`HTTP ${response.status()}: ${response.url()}`);
  });

  const bootstrap = async () => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const runtime = await import('/src/store/workspaceStore/cpDetectRuntime.ts');
      window.__cpDetectClient = await runtime.getCpDetectClient();
    });
  };

  const samples = [];
  try {
    await bootstrap();

    for (const sample of pack.samples.slice(0, limitOrAll(options.limit))) {
      const sampleStart = performance.now();
      const inputPath = resolve(packRoot, sample.input_png);
      const imageBase64 = await readFile(inputPath, 'base64');
      let dense;
      try {
        dense = await runSample(page, sample, imageBase64, options);
      } catch (error) {
        // Vite dependency re-optimization reloads the page mid-run and
        // destroys the evaluation context; re-bootstrap once and retry.
        if (`${error.message}`.includes('Execution context was destroyed')) {
          process.stderr.write('page reloaded (vite re-optimization?); re-bootstrapping\n');
          await bootstrap();
          dense = await runSample(page, sample, imageBase64, options);
        } else {
          throw error;
        }
      }
      const sampleDirName = safePathSegment(sample.id);
      const sampleDir = resolve(outDir, sampleDirName);
      await mkdir(sampleDir, { recursive: true });

      const tensorPaths = {};
      for (const key of OUTPUT_KEYS) {
        const tensor = dense.outputs[key];
        const relativePath = `${sampleDirName}/${key}.f32`;
        await writeFile(resolve(outDir, relativePath), Buffer.from(tensor.base64, 'base64'));
        tensorPaths[`${key}_f32_path`] = relativePath;
      }
      const row = {
        id: sample.id,
        source_id: sample.source_id ?? null,
        profile: sample.profile ?? null,
        family: sample.family ?? null,
        edge_count: sample.edge_count ?? null,
        image_size: dense.image_size,
        threshold: dense.threshold,
        runtime: dense.runtime ?? null,
        input_png: sample.input_png,
        gt_fold: sample.gt_fold,
        gt_graph: sample.gt_graph,
        dims: Object.fromEntries(OUTPUT_KEYS.map((key) => [key, dense.outputs[key].dims])),
        ...tensorPaths,
      };
      samples.push(row);
      process.stdout.write(
        `${JSON.stringify({
          id: sample.id,
          ok: true,
          seconds: Number(((performance.now() - sampleStart) / 1000).toFixed(3)),
          image_size: dense.image_size,
          runtime: dense.runtime ?? null,
        })}\n`
      );
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    schema: 'oristudio/cp-detect-dense-cache/v1',
    generated_by: 'scripts/cp-detect/run-browser-dense-cache.mjs',
    generated_at: new Date().toISOString(),
    pack: packPath,
    browser_url: url,
    manifest_url: options.manifestUrl ?? '/models/cp-detector-v2/manifest.json',
    model_url: options.modelUrl ?? null,
    sample_count: samples.length,
    output_keys: OUTPUT_KEYS,
    total_seconds: Number(((performance.now() - startedAt) / 1000).toFixed(3)),
    samples,
    browser_errors: browserErrors,
  };
  await writeFile(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (browserErrors.length > 0) {
    process.stderr.write(`browser errors:\n${browserErrors.join('\n')}\n`);
  }
}

async function runSample(page, sample, imageBase64, options) {
  return page.evaluate(
    async ({ base64, imageSize, manifestUrl, modelUrl, threshold, executionProvider, outputKeys }) => {
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
      const runOptions = { manifestUrl };
      if (modelUrl) runOptions.modelUrl = modelUrl;
      if (threshold !== null && threshold !== undefined) runOptions.threshold = threshold;
      if (executionProvider) runOptions.executionProvider = executionProvider;
      const inference = await window.__cpDetectClient.runDenseInference(image, runOptions);
      const outputs = {};
      for (const key of outputKeys) {
        const tensor = inference.outputs[key];
        outputs[key] = {
          dims: Array.from(tensor.dims),
          base64: float32ToBase64(tensor.data),
        };
      }
      return {
        image_size: inference.manifest.inference.image_size,
        threshold: inference.manifest.inference.threshold,
        runtime: inference.runtime ?? null,
        outputs,
      };

      function float32ToBase64(data) {
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const chunk = bytes.subarray(offset, offset + chunkSize);
          binary += String.fromCharCode(...chunk);
        }
        return btoa(binary);
      }
    },
    {
      base64: imageBase64,
      imageSize: Number(options.imageSize ?? 1024),
      manifestUrl: options.manifestUrl ?? '/models/cp-detector-v2/manifest.json',
      modelUrl: options.modelUrl ?? null,
      threshold: options.threshold === undefined ? null : Number(options.threshold),
      executionProvider: options.executionProvider ?? null,
      outputKeys: OUTPUT_KEYS,
    }
  );
}

async function preflight(url, manifestUrl) {
  const checks = [
    [new URL(manifestUrl, url).href, 'model manifest (model assets are gitignored — copy them from a checkout that has them or re-export with scripts/cp-detect/export-cpline-onnx.py)'],
  ];
  let manifest;
  for (const [target, hint] of checks) {
    let response;
    try {
      response = await fetch(target);
    } catch (error) {
      throw new Error(`dev server not reachable at ${target}: ${error.message}. Start it with: cd apps/web && npx vite --host 127.0.0.1 --port 5175`);
    }
    if (!response.ok) {
      throw new Error(`preflight ${response.status} for ${target} — missing ${hint}`);
    }
    // Vite's SPA fallback answers missing files with index.html and a 200.
    const body = await response.text();
    try {
      manifest = JSON.parse(body);
    } catch {
      throw new Error(`preflight got non-JSON (SPA fallback?) for ${target} — missing ${hint}`);
    }
  }
  const modelUrl = new URL(manifest.model.url, new URL(manifestUrl, url)).href;
  const head = await fetch(modelUrl, { method: 'HEAD' });
  if (!head.ok) {
    throw new Error(`preflight ${head.status} for ${modelUrl} — model.onnx missing next to its manifest (gitignored asset)`);
  }
  // The inference worker imports onnxruntime-web; if node_modules are stale
  // the worker 500s inside the page and the run hangs without this check.
  const workerProbe = await fetch(new URL('/src/workers/cpDetectWorker.ts', url).href);
  if (!workerProbe.ok) {
    throw new Error(
      `preflight ${workerProbe.status} for cpDetectWorker.ts — vite cannot serve the inference worker. Usually missing npm dependencies (run: npm install). Check the vite log for the unresolved import.`
    );
  }
}

function safePathSegment(value) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function limitOrAll(value) {
  return value === undefined ? Number.POSITIVE_INFINITY : Number(value);
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
