#!/usr/bin/env node
import * as ort from 'onnxruntime-web/wasm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUTS = [
  ['line_logits', 'line_logits_f32_path'],
  ['junction_logits', 'junction_logits_f32_path'],
  ['assignment_logits', 'assignment_logits_f32_path'],
  ['non_crease_logits', 'non_crease_logits_f32_path'],
  ['line_style_logits', 'line_style_logits_f32_path'],
  ['boundary_contact_logits', 'boundary_contact_logits_f32_path'],
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(root, options.manifest);
  const manifestRoot = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const modelBytes = await readFile(resolve(root, options.model));
  const outPath = resolve(root, options.out);
  const exportManifestPath = options.exportManifest ? resolve(root, options.exportManifest) : null;
  const imageSize = Number(manifest.config.image_size);
  const threshold = Number(manifest.config.threshold);

  ort.env.wasm.numThreads = Number(options.numThreads ?? 1);
  if (options.simd !== null && options.simd !== undefined) {
    ort.env.wasm.simd = parseSimd(options.simd);
  }
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
  const inputName = session.inputNames[0] ?? 'image';
  const results = [];
  for (const fixture of manifest.fixtures) {
    if (!fixture.input_tensor_f32_path) {
      throw new Error(
        `Fixture ${fixture.id} is missing input_tensor_f32_path; regenerate oracle artifacts.`,
      );
    }
    const input = await readF32(resolve(manifestRoot, fixture.input_tensor_f32_path));
    const outputs = await session.run({
      [inputName]: new ort.Tensor('float32', input, [1, 3, imageSize, imageSize]),
    });
    const heads = {};
    for (const [head, pathKey] of OUTPUTS) {
      const expected = await readF32(resolve(manifestRoot, fixture[pathKey]));
      const actual = outputs[head]?.data;
      if (!(actual instanceof Float32Array)) {
        throw new Error(`ONNX output ${head} for ${fixture.id} is missing Float32Array data`);
      }
      heads[head] = compareArrays(actual, expected, head === 'line_logits' ? threshold : null);
      if (exportManifestPath) {
        const outputPath = `${fixture.root}/onnx_${head}.f32`;
        await writeFile(
          resolve(manifestRoot, outputPath),
          Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength),
        );
        fixture[pathKey] = outputPath;
      }
    }
    results.push({ id: fixture.id, profile: fixture.profile, heads });
  }

  const report = {
    schema: 'oristudio/cp-detect-onnx-head-parity/v1',
    generated_at: new Date().toISOString(),
    oracle_manifest: manifestPath,
    model_path: resolve(root, options.model),
    wasm: {
      num_threads: ort.env.wasm.numThreads,
      simd: ort.env.wasm.simd ?? null,
    },
    threshold,
    results,
    aggregate: aggregate(results),
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (exportManifestPath) {
    await writeFile(exportManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report.aggregate, null, 2)}\n`);
  process.stdout.write(`wrote ${outPath}\n`);
  if (exportManifestPath) process.stdout.write(`wrote ${exportManifestPath}\n`);
}

async function readF32(path) {
  const bytes = await readFile(path);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function compareArrays(actual, expected, threshold) {
  if (actual.length !== expected.length) {
    return {
      length_match: false,
      actual_length: actual.length,
      expected_length: expected.length,
    };
  }
  let maxAbs = 0;
  let sumAbs = 0;
  let maskDiffs = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const delta = Math.abs(actual[index] - expected[index]);
    maxAbs = Math.max(maxAbs, delta);
    sumAbs += delta;
    if (threshold !== null) {
      const left = sigmoid(actual[index]) >= threshold;
      const right = sigmoid(expected[index]) >= threshold;
      if (left !== right) maskDiffs += 1;
    }
  }
  return {
    length_match: true,
    length: actual.length,
    max_abs_error: maxAbs,
    mean_abs_error: sumAbs / actual.length,
    threshold_mask_diffs: threshold === null ? null : maskDiffs,
  };
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function aggregate(results) {
  const aggregate = { fixture_count: results.length, heads: {} };
  for (const [head] of OUTPUTS) {
    const values = results.map((result) => result.heads[head]).filter(Boolean);
    aggregate.heads[head] = {
      max_abs_error: Math.max(...values.map((value) => value.max_abs_error ?? Infinity)),
      mean_abs_error:
        values.reduce((sum, value) => sum + (value.mean_abs_error ?? 0), 0) / values.length,
      threshold_mask_diffs: values.some((value) => value.threshold_mask_diffs !== null)
        ? values.reduce((sum, value) => sum + (value.threshold_mask_diffs ?? 0), 0)
        : null,
    };
  }
  return aggregate;
}

function parseArgs(args) {
  const options = {
    manifest: null,
    model: 'apps/web/public/models/cp-detector-v3/model.onnx',
    out: 'artifacts/cp-detect-parity/onnx-head-parity.json',
    exportManifest: null,
    numThreads: '1',
    simd: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--manifest') options.manifest = args[++index];
    else if (arg === '--model') options.model = args[++index];
    else if (arg === '--out') options.out = args[++index];
    else if (arg === '--export-manifest') options.exportManifest = args[++index];
    else if (arg === '--num-threads') options.numThreads = args[++index];
    else if (arg === '--simd') options.simd = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.manifest) throw new Error('Missing --manifest');
  return options;
}

function parseSimd(value) {
  if (value === 'false') return false;
  if (value === 'true') return true;
  if (value === 'fixed' || value === 'relaxed') return value;
  throw new Error(`Unsupported --simd value: ${value}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
