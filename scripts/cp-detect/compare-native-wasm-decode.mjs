#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wasmPackagePath = resolve(
  root,
  'apps/web/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm.js'
);
const wasmBinaryPath = resolve(
  root,
  'apps/web/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm_bg.wasm'
);
const DENSE_HEADS = [
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
  const decoderBackend = options.decoderBackend ?? 'constraint_compiler_v1';
  const limit = options.limit === undefined ? null : Number(options.limit);
  const graphTolerance = Number(options.graphTolerance ?? options.tolerance ?? 1e-6);
  const reportTolerance = Number(options.reportTolerance ?? options.tolerance ?? 1e-4);
  const native = await runNative(manifestPath, decoderBackend, limit);
  const wasm = await runWasm(manifestPath, decoderBackend, limit);
  const fixtures = native.fixtures.map((nativeFixture, index) => {
    const wasmFixture = wasm.fixtures[index];
    const foldMatch = stableStringify(nativeFixture.fold) === stableStringify(wasmFixture?.fold);
    const reportMatch = stableStringify(nativeFixture.report) === stableStringify(wasmFixture?.report);
    const graph = compareFoldGraph(nativeFixture.fold, wasmFixture?.fold, graphTolerance);
    const reportToleranceMatch = tolerantJsonEqual(nativeFixture.report, wasmFixture?.report, reportTolerance);
    return {
      id: nativeFixture.id,
      profile: nativeFixture.profile ?? null,
      fold_match: foldMatch,
      graph_match: graph.match,
      report_match: reportMatch,
      report_tolerance_match: reportToleranceMatch,
      native_status: nativeFixture.report.status,
      wasm_status: wasmFixture?.report?.status ?? null,
      native_edges: nativeFixture.fold.edges_vertices?.length ?? 0,
      wasm_edges: wasmFixture?.fold?.edges_vertices?.length ?? 0,
      native_vertices: nativeFixture.fold.vertices_coords?.length ?? 0,
      wasm_vertices: wasmFixture?.fold?.vertices_coords?.length ?? 0,
      max_vertex_delta: graph.maxVertexDelta,
      first_fold_difference: foldMatch ? null : firstDifference(nativeFixture.fold, wasmFixture?.fold),
      first_report_difference: reportMatch ? null : firstDifference(nativeFixture.report, wasmFixture?.report),
    };
  });
  const report = {
    schema: 'oristudio/cp-detect-native-wasm-parity/v1',
    generated_at: new Date().toISOString(),
    manifest: manifestPath,
    decoder_backend: decoderBackend,
    graph_tolerance: graphTolerance,
    report_tolerance: reportTolerance,
    fixture_count: fixtures.length,
    fold_match_count: fixtures.filter((fixture) => fixture.fold_match).length,
    graph_match_count: fixtures.filter((fixture) => fixture.graph_match).length,
    report_match_count: fixtures.filter((fixture) => fixture.report_match).length,
    report_tolerance_match_count: fixtures.filter((fixture) => fixture.report_tolerance_match).length,
    fixtures,
  };
  if (options.out) {
    const outPath = resolve(root, options.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    report.graph_match_count !== report.fixture_count ||
    report.report_tolerance_match_count !== report.fixture_count
  ) {
    process.exitCode = 1;
  }
}

async function runNative(manifestPath, decoderBackend, limit) {
  const args = [
    'run',
    '--quiet',
    '-p',
    'oristudio-cp-detect',
    '--bin',
    'decode_dense_manifest',
    '--',
    '--manifest',
    manifestPath,
    '--decoder-backend',
    decoderBackend,
  ];
  if (limit !== null) args.push('--limit', String(limit));
  const { stdout } = await execFileAsync('cargo', args, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 128,
  });
  return JSON.parse(stdout);
}

async function runWasm(manifestPath, decoderBackend, limit) {
  const manifestRoot = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const wasm = await import(pathToFileURL(wasmPackagePath).href);
  await wasm.default({ module_or_path: await readFile(wasmBinaryPath) });
  const fixtures = [];
  for (const fixture of manifest.fixtures.slice(0, limit ?? manifest.fixtures.length)) {
    const dense = {};
    for (const [head, pathKey] of DENSE_HEADS) {
      dense[head] = await readFloat32(resolvePath(manifestRoot, fixture[pathKey]));
    }
    const decoded = wasm.cp_detect_decode_dense_outputs_with_backend(
      dense.line_logits,
      dense.junction_logits,
      dense.assignment_logits,
      dense.non_crease_logits,
      dense.line_style_logits,
      dense.boundary_contact_logits,
      manifest.config.image_size,
      manifest.config.threshold,
      decoderBackend
    );
    fixtures.push({
      id: fixture.id,
      profile: fixture.profile ?? null,
      fold: JSON.parse(decoded.fold_json),
      report: decoded.report,
    });
  }
  return { fixtures };
}

async function readFloat32(path) {
  const bytes = await readFile(path);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function resolvePath(rootPath, value) {
  return value.startsWith('/') ? value : resolve(rootPath, value);
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

function tolerantJsonEqual(left, right, tolerance) {
  if (Object.is(left, right)) return true;
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) <= tolerance;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => tolerantJsonEqual(value, right[index], tolerance))
    );
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      stableStringify(leftKeys) === stableStringify(rightKeys) &&
      leftKeys.every((key) => tolerantJsonEqual(left[key], right[key], tolerance))
    );
  }
  return false;
}

function compareFoldGraph(left, right, tolerance) {
  if (!right) return { match: false, maxVertexDelta: Number.POSITIVE_INFINITY };
  const leftVertices = left.vertices_coords ?? [];
  const rightVertices = right.vertices_coords ?? [];
  if (leftVertices.length !== rightVertices.length) {
    return { match: false, maxVertexDelta: Number.POSITIVE_INFINITY };
  }
  let maxVertexDelta = 0;
  for (let index = 0; index < leftVertices.length; index += 1) {
    const delta = pointDistance(leftVertices[index], rightVertices[index]);
    maxVertexDelta = Math.max(maxVertexDelta, delta);
    if (delta > tolerance) {
      return { match: false, maxVertexDelta };
    }
  }
  const comparableKeys = [
    'edges_vertices',
    'edges_assignment',
    'edges_foldAngle',
    'cp_detector.edge_ids',
    'cp_detector.edge_source',
    'cp_detector.edge_provenance',
  ];
  for (const key of comparableKeys) {
    if (stableStringify(valueAtPath(left, key)) !== stableStringify(valueAtPath(right, key))) {
      return { match: false, maxVertexDelta };
    }
  }
  return { match: true, maxVertexDelta };
}

function pointDistance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return Number.POSITIVE_INFINITY;
  const dx = (left[0] ?? 0) - (right[0] ?? 0);
  const dy = (left[1] ?? 0) - (right[1] ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function firstDifference(left, right, path = '$') {
  if (Object.is(left, right)) return null;
  if (typeof left === 'number' && typeof right === 'number') {
    return { path, left, right, delta: Math.abs(left - right) };
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return { path, left, right };
    if (left.length !== right.length) return { path: `${path}.length`, left: left.length, right: right.length };
    for (let index = 0; index < left.length; index += 1) {
      const diff = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const diff = firstDifference(left[key], right[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  return { path, left, right };
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
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
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  if (!options.manifest) throw new Error('Missing --manifest');
  return options;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? error}\n`);
  process.exit(1);
});
