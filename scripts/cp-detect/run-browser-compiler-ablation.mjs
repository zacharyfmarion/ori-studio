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
  const stagesRoot = resolve(outDir, 'stages');
  await mkdir(stagesRoot, { recursive: true });

  const url = options.url ?? 'http://127.0.0.1:5175/';
  const browser = await chromium.launch({ headless: options.headed !== 'true' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(Number(options.timeoutMs ?? 300000));
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const stageRows = new Map();
  const stageIds = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const runtime = await import('/src/store/workspaceStore/cpDetectRuntime.ts');
      window.__cpDetectClient = await runtime.getCpDetectClient();
    });
    for (const sample of pack.samples) {
      const inputPath = resolve(packRoot, sample.input_png);
      const imageBase64 = await readFile(inputPath, 'base64');
      const result = await runSample(page, sample, imageBase64, options);
      if (!result.ok) {
        process.stdout.write(
          `${JSON.stringify({ id: sample.id, ok: false, error: result.error })}\n`,
        );
        continue;
      }
      for (const stage of result.stages) {
        if (!stageRows.has(stage.id)) {
          stageRows.set(stage.id, []);
          stageIds.push(stage.id);
          await mkdir(resolve(stagesRoot, stage.id, 'predictions'), { recursive: true });
          await mkdir(resolve(stagesRoot, stage.id, 'reports'), { recursive: true });
        }
        const stageDir = resolve(stagesRoot, stage.id);
        const foldPath = resolve(stageDir, 'predictions', `${sample.id}.fold`);
        const reportPath = resolve(stageDir, 'reports', `${sample.id}.json`);
        const report = {
          schema: 'oristudio/cp-detect-correctness-sample-report/v1',
          sample_id: sample.id,
          ablation_stage: stage.id,
          ...stage.report,
          manifest_id: result.manifest?.id ?? null,
        };
        await writeFile(
          foldPath,
          `${JSON.stringify(JSON.parse(stage.fold_json), null, 2)}\n`,
          'utf8',
        );
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        const row = {
          id: sample.id,
          ok: true,
          fold: `predictions/${sample.id}.fold`,
          report: `reports/${sample.id}.json`,
          status: report.status ?? 'failed',
          vertices: report.vertex_count ?? 0,
          edges: report.edge_count ?? 0,
          border_edges: report.border_edge_count ?? 0,
        };
        stageRows.get(stage.id).push(row);
      }
      process.stdout.write(
        `${JSON.stringify({
          id: sample.id,
          ok: true,
          stages: result.stages.map((stage) => ({
            id: stage.id,
            status: stage.report?.status,
            vertices: stage.report?.vertex_count,
            edges: stage.report?.edge_count,
            border_edges: stage.report?.border_edge_count,
          })),
        })}\n`,
      );
    }
  } finally {
    await browser.close();
  }

  for (const stageId of stageIds) {
    const rows = stageRows.get(stageId) ?? [];
    const stageDir = resolve(stagesRoot, stageId);
    const runManifest = {
      schema: 'oristudio/cp-detect-correctness-run/v1',
      implementation: `browser-onnx-wasm-ablation-${stageId}`,
      generated_by: 'scripts/cp-detect/run-browser-compiler-ablation.mjs',
      generated_at: new Date().toISOString(),
      pack: packPath,
      browser_url: url,
      manifest_url: options.manifestUrl ?? '/models/cp-detector-v3/manifest.json',
      model_url: options.modelUrl ?? null,
      threshold: options.threshold === undefined ? null : Number(options.threshold),
      decoder_backend: 'compiler-ablation',
      ablation_stage: stageId,
      sample_count: rows.length,
      ok_count: rows.filter((row) => row.ok).length,
      samples: rows,
      browser_errors: browserErrors,
    };
    await writeFile(
      resolve(stageDir, 'run_manifest.json'),
      `${JSON.stringify(runManifest, null, 2)}\n`,
      'utf8',
    );
  }

  await writeFile(
    resolve(outDir, 'ablation_manifest.json'),
    `${JSON.stringify(
      {
        schema: 'oristudio/cp-detect-compiler-ablation-run/v1',
        generated_at: new Date().toISOString(),
        pack: packPath,
        stages: stageIds.map((stageId) => ({
          id: stageId,
          run_manifest: `stages/${stageId}/run_manifest.json`,
        })),
        browser_errors: browserErrors,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  if (browserErrors.length > 0) {
    process.stderr.write(`browser errors:\n${browserErrors.join('\n')}\n`);
  }
}

async function runSample(page, sample, imageBase64, options) {
  try {
    return await page.evaluate(
      async ({ base64, imageSize, manifestUrl, modelUrl, threshold }) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);
        if (bitmap.width !== imageSize || bitmap.height !== imageSize) {
          throw new Error(
            `Expected ${imageSize}x${imageSize}, got ${bitmap.width}x${bitmap.height}`,
          );
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
        const ablation = await window.__cpDetectClient.ablateRectifiedFold(image, runOptions);
        return {
          ok: true,
          stages: ablation.stages,
          manifest: ablation.manifest,
        };
      },
      {
        base64: imageBase64,
        imageSize: Number(options.imageSize ?? 1024),
        manifestUrl: options.manifestUrl ?? '/models/cp-detector-v3/manifest.json',
        modelUrl: options.modelUrl ?? null,
        threshold: options.threshold === undefined ? null : Number(options.threshold),
      },
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
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
