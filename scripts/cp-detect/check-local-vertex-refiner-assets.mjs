#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pointerPath = resolve(import.meta.dirname, 'current-vertex-refiner.json');
const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
const modelDir = resolve(root, pointer.stable_model_asset_dir);
const manifestPath = resolve(modelDir, 'manifest.json');

function fail(message) {
  console.error(`cp-vertex-refiner assets: ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail(`missing ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schema !== 'oristudio/cp-vertex-refiner-model-manifest/v1') {
  fail(`unsupported manifest schema ${JSON.stringify(manifest.schema)}`);
}
if (manifest.id !== pointer.model_id) {
  fail(`wrong model id: expected ${pointer.model_id}, got ${JSON.stringify(manifest.id)}`);
}

const modelUrl = manifest.model?.url;
if (typeof modelUrl !== 'string' || modelUrl.trim() === '') {
  fail('manifest.model.url must name the ONNX model file');
}

const modelPath = resolve(modelDir, modelUrl);
if (!existsSync(modelPath)) {
  fail(`missing ${modelPath}`);
}

const size = statSync(modelPath).size;
if (manifest.model.size_bytes != null && Number(manifest.model.size_bytes) !== size) {
  fail(`model size mismatch: manifest=${manifest.model.size_bytes} actual=${size}`);
}

const expectedModelSha256 = pointer.model_sha256;
if (manifest.model.sha256 && !String(manifest.model.sha256).startsWith('replace-')) {
  const digest = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
  if (digest !== manifest.model.sha256) {
    fail(`model sha256 mismatch: manifest=${manifest.model.sha256} actual=${digest}`);
  }
  if (!String(expectedModelSha256).startsWith('replace-') && digest !== expectedModelSha256) {
    fail(`wrong model sha256: expected current ${expectedModelSha256}, got ${digest}`);
  }
}

const inference = manifest.inference ?? {};
if (inference.model_version !== pointer.inference.model_version) {
  fail(
    `wrong model version: expected ${pointer.inference.model_version}, got ${inference.model_version}`,
  );
}
if (Number(inference.crop_size) !== Number(pointer.inference.crop_size)) {
  fail(`wrong crop size: expected ${pointer.inference.crop_size}, got ${inference.crop_size}`);
}
if (Number(inference.input_channels) !== Number(pointer.inference.input_channels)) {
  fail(
    `wrong input channels: expected ${pointer.inference.input_channels}, got ${inference.input_channels}`,
  );
}

console.log(`cp-vertex-refiner assets ok: ${modelPath} (${size} bytes)`);
