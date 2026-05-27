#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_KEYS = [
  'line_logits',
  'junction_logits',
  'assignment_logits',
  'non_crease_logits',
  'line_style_logits',
  'boundary_contact_logits',
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
  const browser = await chromium.launch({ headless: options.headed !== 'true' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(Number(options.timeoutMs ?? 300000));
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const samples = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const runtime = await import('/src/store/workspaceStore/cpDetectRuntime.ts');
      window.__cpDetectClient = await runtime.getCpDetectClient();
    });

    for (const sample of pack.samples.slice(0, limitOrAll(options.limit))) {
      const sampleStart = performance.now();
      const inputPath = resolve(packRoot, sample.input_png);
      const imageBase64 = await readFile(inputPath, 'base64');
      const dense = await runSample(page, sample, imageBase64, options);
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
    async ({ base64, imageSize, manifestUrl, modelUrl, threshold, outputKeys }) => {
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
      outputKeys: OUTPUT_KEYS,
    }
  );
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
